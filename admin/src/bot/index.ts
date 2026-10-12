/**
 * The Telegram bot, running inside the admin's Node process with long polling: the hosting
 * reaches api.telegram.org but Telegram cannot reach the hosting, so no webhook.
 *
 * - /start <order id> (the button on the thank-you page and the link in the email) binds a
 *   paid order to the account, sends what was bought and the buttons to join the chats.
 * - The join links create join requests; the bot approves only members allowed into that chat.
 * - Commands and buttons run the scenarios built in the panel.
 * - When the bot becomes an admin of a chat, the chat appears in the panel by itself.
 */
import type { Payload } from 'payload';
import { Bot, type Context } from 'grammy';

import { allowedChats } from './access';
import { refreshCommandMenu } from './commands';
import { findOrCreateMember } from './members';
import { loadOrder, syncOrders, syncProducts } from './orders';
import { relationIds } from './relations';
import {
  canRunScenario,
  flaggedScenarios,
  SCENARIO_CALLBACK_PREFIX,
  sendOrderSummary,
  startScenario,
} from './scenarios';
import { settings } from './settings';
import { botUserId } from './telegram';
import { fillText, loadTexts, MESSAGE_FORMAT } from './texts';
import type { Member, Scenario } from '../payload-types';

const ORDER_SYNC_INTERVAL_MS = 60_000;
const POLLING_RETRY_MS = 30_000;

/**
 * Replies in the private chat with a text from "Тексты бота".
 * @param context
 * @param payload
 * @param key Which text.
 */
async function replyWithText(
  context: Context,
  payload: Payload,
  key: 'start' | 'notFound' | 'notPaid' | 'otherAccount' | 'notAllowed' | 'help',
): Promise<void> {
  const texts = await loadTexts(payload);
  await context.reply(fillText(texts[key], texts, { name: context.from?.first_name ?? '' }), {
    ...MESSAGE_FORMAT,
    link_preview_options: { is_disabled: true },
  });
}

/**
 * Runs a scenario if the member may, otherwise says it is not for them.
 * @param context
 * @param payload
 * @param scenario
 * @param member
 */
async function offerScenario(
  context: Context,
  payload: Payload,
  scenario: Scenario,
  member: Member,
): Promise<void> {
  if (await canRunScenario(payload, scenario, member)) {
    startScenario(payload, scenario, member);
  } else {
    await replyWithText(context, payload, 'notAllowed');
  }
}

/**
 * /start with an order id: binds the order to the account on first use, one order per account.
 * @param context
 * @param payload
 * @param member
 * @param orderId Untrusted /start parameter.
 */
async function claimOrder(
  context: Context,
  payload: Payload,
  member: Member,
  orderId: string,
): Promise<void> {
  const order = await loadOrder(payload, orderId);
  if (!order) {
    await replyWithText(context, payload, 'notFound');
    return;
  }
  if (!order.paidAt) {
    await replyWithText(context, payload, 'notPaid');
    return;
  }
  const boundMemberId = relationIds(order.member)[0];
  // A forwarded link must not open the chats to someone else.
  if (boundMemberId && boundMemberId !== member.id) {
    payload.logger.warn(
      { order: order.orderId, member: member.telegramId },
      'bot: order bound to another account',
    );
    await replyWithText(context, payload, 'otherAccount');
    return;
  }
  if (!boundMemberId) {
    await payload.update({
      collection: 'orders',
      id: order.id,
      data: { member: member.id },
      depth: 0,
    });
    payload.logger.info({ order: order.orderId, member: member.telegramId }, 'bot: order bound');
  }
  await sendOrderSummary(payload, member);
  for (const scenario of await flaggedScenarios(payload, 'runAfterPurchase')) {
    await offerScenario(context, payload, scenario, member);
  }
}

/**
 * A bare /start: the member's orders and chats again, or the greeting for newcomers.
 * @param context
 * @param payload
 * @param member
 */
async function greet(context: Context, payload: Payload, member: Member): Promise<void> {
  const orders = await payload.count({
    collection: 'orders',
    where: { member: { equals: member.id }, paidAt: { exists: true } },
  });
  if (orders.totalDocs > 0) {
    await sendOrderSummary(payload, member);
    return;
  }
  const startScenarios = await flaggedScenarios(payload, 'runOnStart');
  if (!startScenarios.length) {
    await replyWithText(context, payload, 'start');
  }
  for (const scenario of startScenarios) {
    await offerScenario(context, payload, scenario, member);
  }
}

/**
 * Keeps a chat in the panel in line with the bot's status there; adds new chats.
 * @param payload
 * @param chat Telegram chat.
 * @param status The bot's new status.
 * @param canInvite Whether the bot may create invite links.
 */
async function recordChat(
  payload: Payload,
  chat: { id: number; title?: string },
  status: string,
  canInvite: boolean,
): Promise<void> {
  const botStatus =
    status === 'administrator' ? 'administrator' : status === 'member' ? 'member' : 'left';
  const telegramId = String(chat.id);
  const existing = await payload.find({
    collection: 'chats',
    where: { telegramId: { equals: telegramId } },
    limit: 1,
    depth: 0,
  });
  const data = { telegramTitle: chat.title ?? '', botStatus, canInvite } as const;
  if (existing.docs[0]) {
    await payload.update({ collection: 'chats', id: existing.docs[0].id, data, depth: 0 });
  } else if (botStatus !== 'left') {
    await payload.create({
      collection: 'chats',
      data: { ...data, telegramId, title: chat.title || telegramId },
      depth: 0,
    });
  }
  payload.logger.info({ chat: telegramId, status: botStatus, canInvite }, 'bot: chat status');
}

/**
 * Builds the bot with all its handlers.
 * @param payload
 */
function createBot(payload: Payload): Bot {
  const bot = new Bot(settings.botToken, { client: { apiRoot: settings.telegramApiUrl } });

  // A group became a supergroup and got a new id; the old one stops working.
  bot.on('message:migrate_to_chat_id', async (context) => {
    const oldId = String(context.chat.id);
    await payload.update({
      collection: 'chats',
      where: { telegramId: { equals: oldId } },
      data: { telegramId: String(context.message.migrate_to_chat_id) },
      depth: 0,
    });
  });

  // In groups the bot stays silent; it talks to people in private only.
  const privateChat = bot.chatType('private');

  privateChat.command('start', async (context) => {
    const member = await findOrCreateMember(payload, context.from);
    const orderId = context.match.trim();
    await (orderId
      ? claimOrder(context, payload, member, orderId)
      : greet(context, payload, member));
  });

  privateChat.on('message:text', async (context) => {
    const member = await findOrCreateMember(payload, context.from);
    const command = context.message.text.match(/^\/([a-z0-9_]+)(?:@\w+)?(?:\s|$)/)?.[1];
    const scenario = command
      ? (
          await payload.find({
            collection: 'scenarios',
            where: { command: { equals: command } },
            limit: 1,
            depth: 0,
          })
        ).docs[0]
      : undefined;
    await (scenario
      ? offerScenario(context, payload, scenario, member)
      : replyWithText(context, payload, 'help'));
  });

  privateChat.on('callback_query:data', async (context) => {
    await context.answerCallbackQuery();
    const data = context.callbackQuery.data;
    if (!data.startsWith(SCENARIO_CALLBACK_PREFIX)) {
      return;
    }
    const member = await findOrCreateMember(payload, context.from);
    const scenarioId = Number(data.slice(SCENARIO_CALLBACK_PREFIX.length));
    const scenario = await payload
      .findByID({ collection: 'scenarios', id: scenarioId, depth: 0 })
      .catch(() => null);
    if (scenario) {
      await offerScenario(context, payload, scenario, member);
    }
  });

  bot.on('chat_join_request', async (context) => {
    const request = context.chatJoinRequest;
    // Requests through links made by people are left for the chat admins.
    if (request.invite_link?.creator.id !== botUserId()) {
      return;
    }
    const member = await findOrCreateMember(payload, request.from);
    const chats = await allowedChats(payload, member);
    const allowed = chats.some((chat) => chat.telegramId === String(request.chat.id));
    await (allowed
      ? context.approveChatJoinRequest(request.from.id)
      : context.declineChatJoinRequest(request.from.id));
    payload.logger.info(
      { chat: request.chat.id, member: member.telegramId, allowed },
      'bot: join request',
    );
  });

  bot.on('my_chat_member', async (context) => {
    const update = context.myChatMember;
    if (update.chat.type === 'private') {
      return;
    }
    const member = update.new_chat_member;
    const canInvite = member.status === 'administrator' && Boolean(member.can_invite_users);
    await recordChat(payload, update.chat, member.status, canInvite);
  });

  bot.catch((error) => payload.logger.error({ err: error.error }, 'bot: update failed'));
  return bot;
}

/**
 * Copies orders and products from the site, logging instead of throwing.
 * @param payload
 */
async function syncFromSite(payload: Payload): Promise<void> {
  try {
    await syncProducts(payload);
    await syncOrders(payload);
  } catch (error) {
    payload.logger.error({ err: error }, 'sync from site failed');
  }
}

/**
 * Starts the bot and the order sync once per process; does nothing unless the launcher on the
 * hosting asked for it (RUN_BOT=1).
 * @param payload
 */
export function startBackgroundWork(payload: Payload): void {
  const processState = globalThis as typeof globalThis & { brandMasterskayaBotStarted?: boolean };
  if (!settings.runBot) {
    payload.logger.info('background work off: RUN_BOT is not 1');
    return;
  }
  if (processState.brandMasterskayaBotStarted) {
    return;
  }
  processState.brandMasterskayaBotStarted = true;
  payload.logger.info('background work: starting order sync and bot');

  void syncFromSite(payload);
  setInterval(() => void syncFromSite(payload), ORDER_SYNC_INTERVAL_MS);

  if (!settings.botToken) {
    payload.logger.warn('bot: no TELEGRAM_BOT_TOKEN, the bot is off');
    return;
  }
  const bot = createBot(payload);
  void refreshCommandMenu(payload);
  void keepPolling(payload, bot);
}

/**
 * Polls Telegram for updates and starts again after a failure, e.g. a network error or a
 * 409 while the previous process of a deploy still polls.
 * @param payload
 * @param bot
 */
async function keepPolling(payload: Payload, bot: Bot): Promise<void> {
  for (;;) {
    try {
      // start() also removes the webhook, so updates come here instead of the old PHP bot.
      await bot.start({
        allowed_updates: ['message', 'callback_query', 'chat_join_request', 'my_chat_member'],
        onStart: (info) => payload.logger.info(`bot: @${info.username} polling`),
      });
    } catch (error) {
      payload.logger.error({ err: error }, 'bot: polling stopped, restarting');
    }
    await new Promise((resolve) => setTimeout(resolve, POLLING_RETRY_MS));
  }
}
