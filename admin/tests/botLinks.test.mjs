import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settings } from '../src/bot/settings.ts';
import { loadBotUsername, profileBotLink } from '../src/bot/botLinks.ts';

// Local preview must generate purchase links without contacting a running Telegram bot.
settings.botToken = '';
settings.botUsername = '@masterskaya_brand_test_bot';

test('configured bot username generates saved order links without a bot token', async () => {
  assert.equal(await loadBotUsername(), 'masterskaya_brand_test_bot');
  const link = await profileBotLink({
    siblingData: { orderId: 'a'.repeat(32) },
    collection: { slug: 'orders' },
    req: {},
  });
  assert.equal(link, `https://t.me/masterskaya_brand_test_bot?start=${'a'.repeat(32)}`);
});
