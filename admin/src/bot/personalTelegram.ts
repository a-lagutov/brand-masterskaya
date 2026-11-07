import { Api, TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import bigInteger from 'big-integer';
import { APIError, type Endpoint, type Payload, type PayloadRequest } from 'payload';

import { decryptSession, encryptSession } from './sessionEncryption';
import type { TelegramMessageEntity } from './messaging';

/** Encrypted account credentials and temporary login challenge, never browser-visible. */
type AccountSession = {
  apiId: number;
  apiHash: string;
  session: string;
  phone?: string;
  phoneCodeHash?: string;
  expiresAt?: number;
  adminId?: number | string;
  passwordRequired?: boolean;
};

/** Immutable MTProto recipient identity captured during preview. */
export type PersonalPeer = { userId: string; accessHash: string };
let authenticationBusy = false;

/** Returns a short Telegram error identifier without credentials or request contents. */
export function telegramErrorCode(error: unknown): string {
  const code = (error as { errorMessage?: unknown })?.errorMessage;
  return typeof code === 'string' && /^[A-Z_0-9]+$/.test(code)
    ? code
    : 'TELEGRAM_CONNECTION_FAILED';
}

/** Loads private session data through Payload's internal access boundary. */
async function accountData(payload: Payload) {
  const account = await payload.findGlobal({ slug: 'telegram-account', overrideAccess: true });
  try {
    const credentials = account.encryptedSession
      ? decryptSession<AccountSession>(account.encryptedSession, payload.config.secret)
      : null;
    return { account, credentials, sessionUnreadable: false };
  } catch {
    return { account, credentials: null, sessionUnreadable: true };
  }
}

/** Builds a client with explicit attempt limits and no hidden flood sleeps. */
async function connectClient(
  credentials: AccountSession,
  requestAttempts = 3,
): Promise<TelegramClient> {
  const client = new TelegramClient(
    new StringSession(credentials.session),
    credentials.apiId,
    credentials.apiHash,
    {
      connectionRetries: 2,
      // This option counts total attempts, including the first request.
      requestRetries: requestAttempts,
      floodSleepThreshold: 0,
      deviceModel: 'Brand Masterskaya Admin',
    },
  );
  client.setLogLevel('none' as Parameters<TelegramClient['setLogLevel']>[0]);
  await client.connect();
  return client;
}

/** Ensures custom account endpoints are only available to signed-in administrators. */
function requireAdmin(request: PayloadRequest): void {
  if (!request.user || request.user.collection !== 'users')
    throw new APIError('Нужен вход в админку.', 401);
}

/** Stores the active account only after checking the explicitly requested identity. */
async function finishLogin(
  payload: Payload,
  client: TelegramClient,
  credentials: AccountSession,
): Promise<void> {
  const owner = await client.getMe();
  if (!(owner instanceof Api.User) || owner.username?.toLowerCase() !== 'brandmasterskaya') {
    await client.logOut();
    await payload.updateGlobal({
      slug: 'telegram-account',
      data: { connected: false, encryptedSession: null, ownerId: null, username: null },
    });
    throw new APIError('Подключите именно аккаунт @brandmasterskaya.', 400);
  }
  await payload.updateGlobal({
    slug: 'telegram-account',
    data: {
      connected: true,
      username: owner.username,
      ownerId: owner.id.toString(),
      encryptedSession: encryptSession(
        { apiId: credentials.apiId, apiHash: credentials.apiHash, session: client.session.save() },
        payload.config.secret,
      ),
    },
  });
}

/** Handles one login step, serializing changes to the shared session. */
async function accountAction(
  request: PayloadRequest,
  action: 'code' | 'login' | 'disconnect',
): Promise<Response> {
  requireAdmin(request);
  if (authenticationBusy) throw new APIError('Дождитесь завершения предыдущего запроса.', 409);
  authenticationBusy = true;
  let client: TelegramClient | undefined;
  try {
    const { account, credentials: stored, sessionUnreadable } = await accountData(request.payload);
    if (action === 'disconnect') {
      if (stored && account.connected) {
        client = await connectClient(stored);
        await client.logOut();
      }
      await request.payload.updateGlobal({
        slug: 'telegram-account',
        data: { connected: false, encryptedSession: null, ownerId: null, username: null },
      });
      return Response.json({
        message: sessionUnreadable
          ? 'Локальное подключение удалено. Отзовите старую сессию в Telegram: Настройки → Устройства.'
          : 'Аккаунт отключён, сессия отозвана.',
      });
    }
    const input = (await request.json!()) as Record<string, unknown>;
    if (action === 'code') {
      if (account.connected) throw new APIError('Сначала отключите подключённый аккаунт.', 409);
      if (stored?.expiresAt && stored.expiresAt - 540_000 > Date.now())
        throw new APIError('Повторный код можно запросить через минуту.', 429);
      const apiId = Number(input.apiId);
      const apiHash = String(input.apiHash ?? '');
      const phone = String(input.phone ?? '').replace(/[\s()-]/g, '');
      if (
        !Number.isSafeInteger(apiId) ||
        apiId <= 0 ||
        !/^[a-f0-9]{32}$/i.test(apiHash) ||
        !/^\+[1-9][0-9]{6,14}$/.test(phone)
      ) {
        throw new APIError('Проверьте api_id, api_hash и телефон в международном формате.', 400);
      }
      // Check encryption readiness before Telegram sends a login code.
      if (request.payload.config.secret.length < 32)
        throw new APIError(
          'Для подключения Telegram нужен PAYLOAD_SECRET длиной от 32 символов.',
          400,
        );
      encryptSession({}, request.payload.config.secret);
      const credentials: AccountSession = {
        apiId,
        apiHash,
        session: '',
        phone,
        expiresAt: Date.now() + 600_000,
        adminId: request.user!.id,
      };
      client = await connectClient(credentials);
      const sentCode = await client.sendCode({ apiId, apiHash }, phone);
      credentials.session = String(client.session.save());
      credentials.phoneCodeHash = sentCode.phoneCodeHash;
      await request.payload.updateGlobal({
        slug: 'telegram-account',
        data: { encryptedSession: encryptSession(credentials, request.payload.config.secret) },
      });
      return Response.json({ message: 'Код отправлен Telegram. Введите код ниже.' });
    }
    if (
      !stored?.phone ||
      !stored.phoneCodeHash ||
      !stored.expiresAt ||
      stored.expiresAt < Date.now() ||
      stored.adminId !== request.user!.id
    ) {
      throw new APIError('Запросите новый код входа.', 400);
    }
    client = await connectClient(stored);
    try {
      if (stored.passwordRequired)
        throw Object.assign(new Error('2FA required'), { errorMessage: 'SESSION_PASSWORD_NEEDED' });
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: stored.phone,
          phoneCodeHash: stored.phoneCodeHash,
          phoneCode: String(input.code ?? '').replace(/\s/g, ''),
        }),
      );
    } catch (error) {
      if (telegramErrorCode(error) !== 'SESSION_PASSWORD_NEEDED') throw error;
      if (!input.password) {
        stored.passwordRequired = true;
        await request.payload.updateGlobal({
          slug: 'telegram-account',
          data: { encryptedSession: encryptSession(stored, request.payload.config.secret) },
        });
        return Response.json({
          passwordRequired: true,
          message: 'Введите пароль двухэтапной аутентификации.',
        });
      }
      await client.signInWithPassword(
        { apiId: stored.apiId, apiHash: stored.apiHash },
        {
          password: async () => String(input.password),
          onError: async (passwordError) => {
            throw passwordError;
          },
        },
      );
    }
    await finishLogin(request.payload, client, stored);
    return Response.json({ connected: true, message: 'Аккаунт @brandmasterskaya подключён.' });
  } catch (error) {
    if (error instanceof APIError) throw error;
    throw new APIError(`Telegram: ${telegramErrorCode(error)}`, 400);
  } finally {
    await client?.disconnect().catch(() => undefined);
    authenticationBusy = false;
  }
}

/** Login endpoints use JSON POST bodies so Telegram secrets never enter URLs. */
export const accountEndpoints: Endpoint[] = (['code', 'login', 'disconnect'] as const).map(
  (action) => ({
    path: `/${action}`,
    method: 'post',
    handler: (request) => accountAction(request, action),
  }),
);

/** Opens the authenticated account, checking that it still belongs to the configured owner. */
export async function openPersonalAccount(payload: Payload): Promise<TelegramClient> {
  const { account, credentials } = await accountData(payload);
  if (!account.connected || !credentials)
    throw new APIError('Подключите @brandmasterskaya в настройках Telegram.', 400);
  // Message clients use one attempt; authentication may retry DC migrations.
  const client = await connectClient(credentials, 1);
  try {
    const owner = await client.getMe();
    if (
      !(owner instanceof Api.User) ||
      owner.id.toString() !== account.ownerId ||
      owner.username?.toLowerCase() !== 'brandmasterskaya'
    ) {
      throw new APIError(
        'Сессия @brandmasterskaya недействительна. Подключите аккаунт заново.',
        400,
      );
    }
    return client;
  } catch (error) {
    await client.disconnect();
    throw error;
  }
}

/** Resolves a private user only, verifying known Telegram IDs against username changes. */
export async function resolvePersonalPeer(
  client: TelegramClient,
  target: string,
  expectedId?: string,
): Promise<PersonalPeer> {
  const peer = await client.getInputEntity(/^[0-9]+$/.test(target) ? bigInteger(target) : target);
  if (
    !(peer instanceof Api.InputPeerUser) ||
    (expectedId && peer.userId.toString() !== expectedId)
  ) {
    throw new APIError('Telegram username больше не соответствует участнику.', 400);
  }
  return { userId: peer.userId.toString(), accessHash: peer.accessHash.toString() };
}

/** Maps the common delivery entities to MTProto constructors without parsing message text. */
function personalFormattingEntity(entity: TelegramMessageEntity): Api.TypeMessageEntity {
  const span = { offset: entity.offset, length: entity.length };
  switch (entity.type) {
    case 'text_link':
      return new Api.MessageEntityTextUrl({ ...span, url: entity.url });
    case 'bold':
      return new Api.MessageEntityBold(span);
    case 'italic':
      return new Api.MessageEntityItalic(span);
    case 'underline':
      return new Api.MessageEntityUnderline(span);
    case 'strikethrough':
      return new Api.MessageEntityStrike(span);
    case 'spoiler':
      return new Api.MessageEntitySpoiler(span);
    case 'code':
      return new Api.MessageEntityCode(span);
    case 'blockquote':
      return new Api.MessageEntityBlockquote(span);
    case 'date_time':
      return new Api.MessageEntityFormattedDate({
        ...span,
        date: entity.unix_time,
        shortDate: true,
        shortTime: true,
      });
  }
}

/** Sends the approved visible text and formatting to the immutable private peer. */
export async function sendPersonalMessage(
  client: TelegramClient,
  peer: PersonalPeer,
  text: string,
  entities: TelegramMessageEntity[] = [],
): Promise<void> {
  await client.sendMessage(
    new Api.InputPeerUser({
      userId: bigInteger(peer.userId),
      accessHash: bigInteger(peer.accessHash),
    }),
    {
      message: text,
      parseMode: false,
      linkPreview: false,
      formattingEntities: entities.map(personalFormattingEntity),
    },
  );
}
