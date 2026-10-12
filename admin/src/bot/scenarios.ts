import type { Payload } from 'payload';
import { InlineKeyboard } from 'grammy';

import { MAX_PAUSE_SECONDS } from '../collections/Scenarios';
import type { Member, Scenario } from '../payload-types';
import { inviteButtons } from './access';
import { paidOrders } from './members';
import { relationIds } from './relations';
import { telegramApi } from './telegram';
import { fillText, formatPrice, loadTexts } from './texts';

/** Prefix of callback data for buttons that start a scenario. */
export const SCENARIO_CALLBACK_PREFIX = 'scenario:';

/**
 * Whether the member may run the scenario, by its "Кому доступен" setting.
 * @param payload
 * @param scenario
 * @param member
 */
export async function canRunScenario(
  payload: Payload,
  scenario: Scenario,
  member: Member,
): Promise<boolean> {
  if (scenario.audience === 'all') {
    return true;
  }
  const orders = await paidOrders(payload, member.id);
  if (scenario.audience === 'buyers') {
    return orders.length > 0;
  }
  const allowedProducts = new Set(relationIds(scenario.products));
  return orders.some((order) =>
    relationIds(order.products).some((productId) => allowedProducts.has(productId)),
  );
}

/**
 * Sends what each paid order contains, then the buttons to join the chats.
 * @param payload
 * @param member
 */
export async function sendOrderSummary(payload: Payload, member: Member): Promise<void> {
  const api = telegramApi();
  if (!api) {
    return;
  }
  const texts = await loadTexts(payload);
  for (const order of await paidOrders(payload, member.id)) {
    const items = (order.items ?? []).map(
      (item) => `— ${item.title}: ${formatPrice(item.price ?? 0)}`,
    );
    await api.sendMessage(
      member.telegramId,
      fillText(texts.paid, texts, {
        name: order.name ?? member.displayName ?? '',
        items: items.join('\n'),
        total: formatPrice(order.total ?? 0),
      }),
      { link_preview_options: { is_disabled: true } },
    );
  }
  await sendChatButtons(payload, member, texts.chats);
}

/**
 * Sends the join buttons for the member's chats, or the "chats later" text when there are none.
 * @param payload
 * @param member
 * @param text Text above the buttons.
 */
async function sendChatButtons(payload: Payload, member: Member, text: string): Promise<void> {
  const api = telegramApi();
  if (!api) {
    return;
  }
  const texts = await loadTexts(payload);
  const buttons = await inviteButtons(payload, member);
  if (!buttons.length) {
    await api.sendMessage(member.telegramId, fillText(texts.chatsLater, texts));
    return;
  }
  const keyboard = new InlineKeyboard();
  for (const button of buttons) {
    keyboard.url(button.title, button.url).row();
  }
  await api.sendMessage(
    member.telegramId,
    fillText(text, texts, { name: member.displayName ?? '' }),
    {
      reply_markup: keyboard,
    },
  );
}

/**
 * Runs the scenario's steps one by one in the member's private chat.
 * @param payload
 * @param scenario
 * @param member
 */
export async function runScenario(
  payload: Payload,
  scenario: Scenario,
  member: Member,
): Promise<void> {
  const api = telegramApi();
  if (!api) {
    return;
  }
  const texts = await loadTexts(payload);
  const values = { name: member.displayName ?? '' };
  for (const step of scenario.steps ?? []) {
    if (step.blockType === 'message') {
      const keyboard = new InlineKeyboard();
      for (const button of step.buttons ?? []) {
        if (button.action === 'url' && button.url) {
          keyboard.url(button.label, button.url).row();
        }
        const targetId = relationIds(button.scenario)[0];
        if (button.action === 'scenario' && targetId) {
          keyboard.text(button.label, `${SCENARIO_CALLBACK_PREFIX}${targetId}`).row();
        }
      }
      await api.sendMessage(member.telegramId, fillText(step.text, texts, values), {
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard.inline_keyboard.length ? keyboard : undefined,
      });
    } else if (step.blockType === 'chatButtons') {
      await sendChatButtons(payload, member, step.text);
    } else if (step.blockType === 'orderSummary') {
      await sendOrderSummary(payload, member);
    } else if (step.blockType === 'pause') {
      const seconds = Math.min(Math.max(step.seconds, 1), MAX_PAUSE_SECONDS);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
}

/**
 * Runs a scenario without holding up the bot: a pause in one chat must not delay replies to
 * everyone else. Errors are logged.
 * @param payload
 * @param scenario
 * @param member
 */
export function startScenario(payload: Payload, scenario: Scenario, member: Member): void {
  runScenario(payload, scenario, member).catch((error: unknown) =>
    payload.logger.error({ err: error, scenario: scenario.id }, 'bot: scenario failed'),
  );
}

/**
 * Scenarios marked to run on a bare /start or after a confirmed purchase.
 * @param payload
 * @param flag Which checkbox to look for.
 */
export async function flaggedScenarios(
  payload: Payload,
  flag: 'runOnStart' | 'runAfterPurchase',
): Promise<Scenario[]> {
  const result = await payload.find({
    collection: 'scenarios',
    where: { [flag]: { equals: true } },
    sort: 'createdAt',
    limit: 20,
    depth: 0,
  });
  return result.docs;
}
