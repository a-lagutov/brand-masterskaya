import { createHash } from 'node:crypto';
import { GrammyError } from 'grammy';
import { APIError, type Endpoint, type Payload, type PayloadRequest } from 'payload';
import type { TelegramClient } from 'teleproto';

import type { Broadcast, Member, Order } from '../payload-types';
import {
  botStartLink,
  renderLinkedMessage,
  selectRecipients,
  MessageValidationError,
  type TelegramMessageEntity,
} from './messaging';
import { loadBotUsername } from './botLinks';
import {
  openPersonalAccount,
  resolvePersonalPeer,
  sendPersonalMessage,
  telegramErrorCode,
  type PersonalPeer,
} from './personalTelegram';
import { settings } from './settings';
import { nextBroadcastOccurrence, validateBroadcastSchedule } from './broadcastSchedule';
import { telegramApi } from './telegram';

/** Frozen message and identity approved by the administrator before queueing. */
export type Delivery = {
  name: string;
  telegramId: string;
  text: string;
  entities?: TelegramMessageEntity[];
  peer?: PersonalPeer;
  state: 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain';
  error?: string;
};

type Preview = {
  deliveries: Delivery[];
  skipped: { name: string; reason: string }[];
  hash: string;
};
const queueLocks = new Set<number>();
let dispatching = false;

/** Resolves populated Payload relationships for explicit order selection. */
function selectedId(value: number | { id: number }): number {
  return typeof value === 'number' ? value : value.id;
}

/** Selects contacts in addition to bot members so invitations can precede bot activation. */
function audienceContacts(broadcast: Broadcast, members: Member[], orders: Order[]) {
  const recipients: { member?: Member; order?: Order }[] = selectRecipients(
    members,
    orders,
    broadcast,
  );
  const selectedOrders = new Set((broadcast.orders ?? []).map(selectedId));
  const selectedProducts = new Set((broadcast.products ?? []).map(selectedId));
  for (const order of orders) {
    if (order.member || order.deletedAt) continue;
    if (broadcast.audience === 'selected' && !selectedOrders.has(order.id)) continue;
    if (broadcast.payment === 'paid' && !order.paidAt) continue;
    if (broadcast.payment === 'unpaid' && order.paidAt) continue;
    if (
      selectedProducts.size &&
      !(order.products ?? []).some((product) => selectedProducts.has(selectedId(product)))
    )
      continue;
    recipients.push({ order });
  }
  // Explicitly selected bound orders also identify their members, preserving all filters.
  if (broadcast.audience === 'selected' && selectedOrders.size) {
    const chosenOrders = orders.filter((order) => selectedOrders.has(order.id) && order.member);
    const orderMembers = chosenOrders.map((order) => selectedId(order.member!));
    for (const recipient of selectRecipients(members, chosenOrders, {
      ...broadcast,
      members: orderMembers,
    })) {
      if (!recipients.some((existing) => existing.member?.id === recipient.member.id))
        recipients.push(recipient);
    }
  }
  return recipients;
}

/** Builds immutable text and link entities for deliveries and shows every skipped recipient. */
export async function prepareBroadcast(payload: Payload, broadcast: Broadcast): Promise<Preview> {
  const [members, orders, botUsername] = await Promise.all([
    payload.find({ collection: 'members', pagination: false, depth: 0, sort: 'id' }),
    payload.find({ collection: 'orders', pagination: false, depth: 0, sort: '-createdOnSite' }),
    loadBotUsername(),
  ]);
  const deliveries: Delivery[] = [];
  const skipped: Preview['skipped'] = [];
  const seen = new Set<string>();
  let client: TelegramClient | undefined;
  try {
    if (broadcast.sender === 'account') {
      client = await openPersonalAccount(payload);
      // Existing dialogs populate the session's entity cache, including ID/access-hash pairs.
      for await (const dialog of client.iterDialogs({})) {
        if (dialog.isUser) await client.getInputEntity(dialog.inputEntity!);
      }
    } else if (!telegramApi()) throw new APIError('Не настроен Telegram-бот.', 400);
    for (const { member, order } of audienceContacts(broadcast, members.docs, orders.docs)) {
      const name = order?.name || member?.displayName || 'Без имени';
      if (broadcast.sender === 'bot' && (!member || member.botStarted === false)) {
        skipped.push({ name, reason: 'Пользователь ещё не запускал бота.' });
        continue;
      }
      let peer: PersonalPeer | undefined;
      let telegramId = member?.telegramId ?? '';
      if (client) {
        const target =
          member?.username ||
          order?.telegram?.replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '') ||
          order?.phone;
        try {
          // Resolve cached numeric IDs for known members; otherwise resolve the explicit contact.
          peer = await resolvePersonalPeer(
            client,
            member?.telegramId || target || '',
            member?.telegramId,
          );
        } catch (error) {
          if (target && member) {
            try {
              peer = await resolvePersonalPeer(client, target, member.telegramId);
            } catch {
              /* The original error remains the useful diagnostic. */
            }
          }
          if (!peer) {
            skipped.push({
              name,
              reason: `Нет доступного личного диалога: ${telegramErrorCode(error)}`,
            });
            continue;
          }
        }
        telegramId = peer.userId;
      }
      if (seen.has(telegramId)) continue;
      seen.add(telegramId);
      const { text, entities } = renderLinkedMessage(broadcast.message, {
        name,
        first_name: name.trim().split(/\s+/)[0] ?? '',
        username: member?.username || order?.telegram || '',
        email: order?.email || '',
        phone: order?.phone || '',
        order_id: order?.orderId || '',
        bot_link: botStartLink(botUsername, order?.orderId),
        site: settings.siteUrl,
      });
      deliveries.push({
        name,
        telegramId,
        text,
        entities,
        ...(peer ? { peer } : {}),
        state: 'pending',
      });
    }
  } finally {
    await client?.disconnect();
  }
  if (!deliveries.length) {
    // Future recipients may not exist yet; validate syntax and links with safe sample values now.
    renderLinkedMessage(broadcast.message, {
      name: 'Имя',
      first_name: 'Имя',
      username: 'username',
      email: 'user@example.com',
      phone: '+70000000000',
      order_id: 'preview',
      bot_link: botStartLink(botUsername),
      site: settings.siteUrl,
    });
  }
  const hash = createHash('sha256')
    .update(JSON.stringify([broadcast.updatedAt, broadcast.sender, deliveries]))
    .digest('hex');
  return { deliveries, skipped, hash };
}

/** Requires authentication before custom endpoints use Payload's privileged Local API. */
function requireAdmin(request: PayloadRequest): void {
  if (!request.user || request.user.collection !== 'users')
    throw new APIError('Нужен вход в админку.', 401);
}

/** Previews or queues a saved draft; a changed audience requires a fresh preview. */
async function broadcastAction(request: PayloadRequest, send: boolean): Promise<Response> {
  requireAdmin(request);
  const id = Number(request.routeParams?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new APIError('Некорректная рассылка.', 400);
  if (queueLocks.has(id)) throw new APIError('Рассылка уже обрабатывается.', 409);
  queueLocks.add(id);
  try {
    const broadcast = await request.payload.findByID({ collection: 'broadcasts', id, depth: 0 });
    if (broadcast.status !== 'draft') throw new APIError('Рассылка уже запущена.', 409);
    const preview = await prepareBroadcast(request.payload, broadcast);
    if (!send) return Response.json(preview);
    const input = (await request.json!()) as { hash?: string };
    const scheduled = Boolean(broadcast.scheduleMode && broadcast.scheduleMode !== 'now');
    if (!scheduled && !preview.deliveries.length)
      throw new APIError('Нет доступных получателей.', 400);
    if (input.hash !== preview.hash)
      throw new APIError('Текст или получатели изменились. Обновите предпросмотр.', 409);
    if (!settings.runBot)
      throw new APIError('Обработчик выключен: нужен RUN_BOT=1 на сервере.', 503);
    const scheduleError = validateBroadcastSchedule(broadcast);
    if (scheduleError) throw new APIError(scheduleError, 400);
    await request.payload.update({
      collection: 'broadcasts',
      id,
      data: scheduled
        ? { status: 'scheduled', nextRunAt: broadcast.scheduledAt, scheduleError: null }
        : { status: 'queued', deliveries: preview.deliveries },
      context: { broadcastInternal: true, broadcastRevision: broadcast.updatedAt },
    });
    return Response.json({
      message: scheduled
        ? 'Расписание включено. Получатели и переменные будут обновляться перед каждым запуском.'
        : `Рассылка поставлена в очередь. Получателей: ${preview.deliveries.length}.`,
    });
  } catch (error) {
    if (error instanceof APIError) throw error;
    if (error instanceof MessageValidationError) throw new APIError(error.message, 400);
    // Never expose Telegram request contents or session material in errors.
    throw new APIError(`Не удалось подготовить рассылку: ${telegramErrorCode(error)}`, 400);
  } finally {
    queueLocks.delete(id);
  }
}

/** Stops future occurrences without interrupting an already queued child delivery. */
async function cancelBroadcastSchedule(request: PayloadRequest): Promise<Response> {
  requireAdmin(request);
  const id = Number(request.routeParams?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new APIError('Некорректная рассылка.', 400);
  if (queueLocks.has(id))
    throw new APIError('Расписание обрабатывается. Повторите остановку.', 409);
  queueLocks.add(id);
  try {
    const broadcast = await request.payload.findByID({ collection: 'broadcasts', id, depth: 0 });
    if (broadcast.status !== 'scheduled') throw new APIError('Расписание не включено.', 409);
    await request.payload.update({
      collection: 'broadcasts',
      id,
      data: { status: 'cancelled', nextRunAt: null },
      context: { broadcastInternal: true },
    });
    return Response.json({
      message: 'Будущие запуски остановлены. Уже начатая отправка завершится.',
    });
  } finally {
    queueLocks.delete(id);
  }
}

/** Explicit endpoints keep saving a draft separate from sending messages. */
export const broadcastEndpoints: Endpoint[] = [
  { path: '/:id/preview', method: 'post', handler: (request) => broadcastAction(request, false) },
  { path: '/:id/send', method: 'post', handler: (request) => broadcastAction(request, true) },
  { path: '/:id/cancel', method: 'post', handler: cancelBroadcastSchedule },
];

/** Creates one durable child per occurrence and repairs advancement after a process restart. */
export async function dispatchScheduledBroadcasts(
  payload: Payload,
  now = new Date(),
): Promise<void> {
  const schedules = await payload.find({
    collection: 'broadcasts',
    where: { status: { equals: 'scheduled' } },
    pagination: false,
    depth: 0,
    sort: 'nextRunAt',
  });
  for (const candidate of schedules.docs) {
    if (candidate.status !== 'scheduled' || queueLocks.has(candidate.id)) continue;
    queueLocks.add(candidate.id);
    try {
      // Another action may have stopped this schedule after the initial list was read.
      const schedule = await payload.findByID({
        collection: 'broadcasts',
        id: candidate.id,
        depth: 0,
      });
      if (schedule.status !== 'scheduled') continue;
      if (schedule.nextRunAt && Date.parse(schedule.nextRunAt) > now.getTime()) continue;
      const activeRuns = await payload.find({
        collection: 'broadcasts',
        depth: 0,
        limit: 1,
        where: {
          and: [
            { parentBroadcast: { equals: schedule.id } },
            { status: { in: ['queued', 'sending'] } },
          ],
        },
      });
      if (!schedule.nextRunAt) {
        if (!activeRuns.docs.length)
          await payload.update({
            collection: 'broadcasts',
            id: schedule.id,
            data: { status: 'completed' },
            context: { broadcastInternal: true },
          });
        continue;
      }
      const occurrenceKey = `${schedule.id}:${schedule.nextRunAt}`;
      const existing = await payload.find({
        collection: 'broadcasts',
        depth: 0,
        limit: 1,
        where: { occurrenceKey: { equals: occurrenceKey } },
      });
      if (!existing.docs.length) {
        // Earlier runs finish first; a delayed schedule never creates overlapping deliveries.
        if (activeRuns.docs.length) continue;
        let preview: Preview;
        try {
          preview = await prepareBroadcast(payload, schedule);
        } catch (error) {
          await payload.update({
            collection: 'broadcasts',
            id: schedule.id,
            data: {
              status: 'cancelled',
              nextRunAt: null,
              scheduleError: `Не удалось подготовить запуск: ${
                error instanceof APIError || error instanceof MessageValidationError
                  ? error.message
                  : telegramErrorCode(error)
              }`,
            },
            context: { broadcastInternal: true },
          });
          continue;
        }
        await payload.create({
          collection: 'broadcasts',
          data: {
            title: `${schedule.title} · ${new Date(schedule.nextRunAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
            sender: schedule.sender,
            audience: schedule.audience,
            payment: schedule.payment,
            members: (schedule.members ?? []).map(selectedId),
            orders: (schedule.orders ?? []).map(selectedId),
            products: (schedule.products ?? []).map(selectedId),
            message: schedule.message,
            scheduleMode: 'now',
            parentBroadcast: schedule.id,
            occurrenceKey,
            scheduledFor: schedule.nextRunAt,
            status: preview.deliveries.length ? 'queued' : 'completed',
            deliveries: preview.deliveries,
          },
          context: { broadcastInternal: true },
        });
      }
      // The child is committed first. A restart finds its unique key and only advances the parent.
      await payload.update({
        collection: 'broadcasts',
        id: schedule.id,
        data: { nextRunAt: nextBroadcastOccurrence(schedule, now.toISOString()) },
        context: { broadcastInternal: true },
      });
    } catch (error) {
      // Persistence failures retain the due slot for recovery instead of creating a second run.
      payload.logger.error({ code: telegramErrorCode(error) }, 'broadcast: schedule tick failed');
    } finally {
      queueLocks.delete(candidate.id);
    }
  }
}

/** Persists progress before and after every network send for restart-safe delivery accounting. */
async function saveProgress(
  payload: Payload,
  id: number,
  deliveries: Delivery[],
  status: 'sending' | 'completed',
): Promise<void> {
  await payload.update({
    collection: 'broadcasts',
    id,
    data: { status, deliveries, retryAt: null },
    context: { broadcastInternal: true },
  });
}

/** Processes one campaign at a time in the hosting's single background process. */
export async function dispatchBroadcasts(payload: Payload): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  let client: TelegramClient | undefined;
  let broadcast: Broadcast | undefined;
  let deliveries: Delivery[] | undefined;
  try {
    await dispatchScheduledBroadcasts(payload);
    broadcast = (
      await payload.find({
        collection: 'broadcasts',
        where: {
          and: [
            { status: { in: ['queued', 'sending'] } },
            {
              or: [
                { retryAt: { exists: false } },
                { retryAt: { less_than_equal: new Date().toISOString() } },
              ],
            },
          ],
        },
        sort: 'createdAt',
        limit: 1,
        depth: 0,
      })
    ).docs[0];
    if (!broadcast || (broadcast.retryAt && Date.parse(broadcast.retryAt) > Date.now())) return;
    deliveries = broadcast.deliveries as unknown as Delivery[];
    // A crash can occur after Telegram accepts a message but before the success is saved.
    // Never replay these ambiguous sends automatically.
    for (const delivery of deliveries) {
      if (delivery.state === 'sending') {
        delivery.state = 'uncertain';
        delivery.error = 'Отправка прервана. Проверьте диалог перед повтором.';
      }
    }
    await saveProgress(payload, broadcast.id, deliveries, 'sending');
    if (broadcast.sender === 'account') client = await openPersonalAccount(payload);
    for (const delivery of deliveries) {
      if (delivery.state !== 'pending') continue;
      if (client) {
        const account = await payload.findGlobal({ slug: 'telegram-account' });
        if (!account.connected) throw new APIError('Личный аккаунт отключён.', 400);
      }
      delivery.state = 'sending';
      await saveProgress(payload, broadcast.id, deliveries, 'sending');
      let pauseMs = broadcast.sender === 'account' ? 3000 : 75;
      try {
        if (client && delivery.peer)
          await sendPersonalMessage(client, delivery.peer, delivery.text, delivery.entities);
        else {
          const api = telegramApi();
          if (!api || broadcast.sender !== 'bot')
            throw new APIError('Отправитель недоступен.', 400);
          await api.sendMessage(delivery.telegramId, delivery.text, {
            entities: delivery.entities,
            link_preview_options: { is_disabled: true },
          });
        }
        delivery.state = 'sent';
        delete delivery.error;
      } catch (error) {
        const code = telegramErrorCode(error);
        delivery.state =
          error instanceof GrammyError || code !== 'TELEGRAM_CONNECTION_FAILED'
            ? 'failed'
            : 'uncertain';
        delivery.error = error instanceof GrammyError ? error.description : code;
        const retryAfter =
          error instanceof GrammyError
            ? error.parameters.retry_after
            : (error as { seconds?: number })?.seconds;
        if (retryAfter) pauseMs = Math.max(pauseMs, retryAfter * 1000);
        if (retryAfter && retryAfter > 0) {
          // Telegram explicitly rejected this send; retry after the durable cooldown.
          delivery.state = 'pending';
          await payload.update({
            collection: 'broadcasts',
            id: broadcast.id,
            data: {
              status: 'sending',
              deliveries,
              retryAt: new Date(Date.now() + pauseMs).toISOString(),
            },
            context: { broadcastInternal: true },
          });
          return;
        }
      }
      await saveProgress(payload, broadcast.id, deliveries, 'sending');
      if (pauseMs <= 60_000) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
    await saveProgress(payload, broadcast.id, deliveries, 'completed');
  } catch (error) {
    payload.logger.error({ code: telegramErrorCode(error) }, 'broadcast: dispatch failed');
    if (broadcast && deliveries) {
      for (const delivery of deliveries) {
        if (delivery.state === 'pending' || delivery.state === 'sending') {
          delivery.state = delivery.state === 'sending' ? 'uncertain' : 'failed';
          delivery.error = error instanceof APIError ? error.message : telegramErrorCode(error);
        }
      }
      await saveProgress(payload, broadcast.id, deliveries, 'completed').catch(() => undefined);
    }
  } finally {
    await client?.disconnect().catch(() => undefined);
    dispatching = false;
  }
}
