import type { Payload } from 'payload';

import { telegramApi } from './telegram';

/**
 * Updates the command menu in Telegram: /start plus every scenario with a command.
 * Called on bot start and whenever scenarios change; errors are only logged.
 * @param payload
 */
export async function refreshCommandMenu(payload: Payload): Promise<void> {
  const api = telegramApi();
  if (!api) {
    return;
  }
  try {
    const scenarios = await payload.find({
      collection: 'scenarios',
      where: { command: { exists: true } },
      sort: 'createdAt',
      limit: 50,
      depth: 0,
    });
    const commands = scenarios.docs
      .filter((scenario) => scenario.command)
      .map((scenario) => ({
        command: scenario.command as string,
        // Telegram requires a description of 1–256 characters.
        description: (scenario.commandDescription || scenario.title).slice(0, 256),
      }));
    await api.setMyCommands([{ command: 'start', description: 'Мои заказы и чаты' }, ...commands]);
  } catch (error) {
    payload.logger.error({ err: error }, 'bot: command menu update failed');
  }
}
