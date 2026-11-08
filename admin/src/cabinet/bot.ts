import type { Context } from 'grammy';
import { cabinetLink } from './config';

/** Adds a cabinet entry point after /start without changing purchases or learning-group membership. */
export async function sendCabinetButton(context: Pick<Context, 'reply'>): Promise<void> {
  const url = cabinetLink();
  if (url)
    await context.reply('Лекции вашей программы — в личном кабинете.', {
      reply_markup: { inline_keyboard: [[{ text: 'Перейти в личный кабинет', url }]] },
    });
}
