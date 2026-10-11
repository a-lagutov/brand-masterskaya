<?php
/**
 * Telegram bot webhook: confirms a paid order and lets the buyer into the program chats.
 *
 * - /start <order id> (the button on the thank-you page and the link in the email) binds
 *   the order to the Telegram account, lists what was bought and sends join links.
 * - The join links create join requests. The bot approves only buyers whose orders include
 *   that chat, so a forwarded link lets nobody else in.
 * - When the bot becomes an admin of a chat, the organizers get the chat id by email,
 *   to put into src/telegram.json.
 *
 * Texts, chats and which purchase opens which chat live in src/telegram.json.
 * Always answers 200 to a correctly signed call, otherwise Telegram keeps retrying it.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

const CONTACT_EMAIL = 'contact@brandmasterskaya.ru';

/**
 * A text from src/telegram.json with {placeholders} filled in.
 * @param string $key Key under "texts".
 * @param array<string, string> $values Placeholder name => value.
 * @return string
 */
function bot_text(string $key, array $values = []): string
{
    $defaults = ['contact' => CONTACT_EMAIL, 'site' => config()['site_url']];
    $replacements = [];
    foreach (array_merge($defaults, $values) as $name => $value) {
        $replacements['{' . $name . '}'] = $value;
    }
    return strtr(TELEGRAM['texts'][$key], $replacements);
}

/**
 * Sends a plain-text message; no parse mode, so names and titles need no escaping.
 * @param int $chatId
 * @param string $text
 * @param array<string, mixed> $extra More sendMessage parameters, e.g. reply_markup.
 */
function send_message(int $chatId, string $text, array $extra = []): void
{
    telegram_request('sendMessage', [
        'chat_id' => $chatId,
        'text' => $text,
        'link_preview_options' => ['is_disabled' => true],
    ] + $extra);
}

/**
 * The bot's own user id, the part of the token before the colon.
 * @return int
 */
function bot_user_id(): int
{
    return (int) strtok((string) config()['telegram_bot_token'], ':');
}

/**
 * Path of the list of orders bound to a Telegram account.
 * @param int $userId
 * @return string
 */
function user_orders_path(int $userId): string
{
    return private_dir() . '/telegram-users/' . $userId . '.json';
}

/**
 * Paid orders bound to a Telegram account.
 * @param int $userId
 * @return array<int, array<string, mixed>>
 */
function user_orders(int $userId): array
{
    $path = user_orders_path($userId);
    $orderIds = is_file($path) ? (json_decode((string) file_get_contents($path), true) ?? []) : [];
    $orders = array_map('load_order', $orderIds);
    return array_values(array_filter($orders, fn($order) => !empty($order['paidAt'])));
}

/**
 * Adds an order to the account's list, so join requests and a bare /start find it.
 * @param int $userId
 * @param string $orderId
 */
function remember_user_order(int $userId, string $orderId): void
{
    $path = user_orders_path($userId);
    if (!is_dir(dirname($path))) {
        mkdir(dirname($path), 0700, true);
    }
    $orderIds = is_file($path) ? (json_decode((string) file_get_contents($path), true) ?? []) : [];
    if (!in_array($orderId, $orderIds, true)) {
        $orderIds[] = $orderId;
        file_put_contents($path, json_encode($orderIds), LOCK_EX);
    }
}

/**
 * Keys of the plan and electives in an order, as in src/prices.json.
 * @param array<string, mixed> $order
 * @return string[]
 */
function order_item_keys(array $order): array
{
    if (isset($order['planKey'])) {
        return array_merge([$order['planKey']], $order['electiveKeys']);
    }
    // Orders made before the keys were stored: find them by title.
    $catalog = array_map(fn($item) => $item['title'], PLANS + ELECTIVES);
    $titles = array_map(fn($item) => $item['title'], array_merge([$order['plan']], $order['electives']));
    return array_values(array_filter(array_keys($catalog), fn($key) => in_array($catalog[$key], $titles, true)));
}

/**
 * Chats an order opens, skipping those without an id in src/telegram.json yet.
 * @param array<string, mixed> $order
 * @return array<string, array{title: string, id: int}> Chat key => chat.
 */
function order_chats(array $order): array
{
    $chats = [];
    foreach (order_item_keys($order) as $itemKey) {
        foreach (TELEGRAM['access'][$itemKey] ?? [] as $chatKey) {
            if (!empty(TELEGRAM['chats'][$chatKey]['id'])) {
                $chats[$chatKey] = TELEGRAM['chats'][$chatKey];
            }
        }
    }
    return $chats;
}

/**
 * Join links for the order's chats, created once per chat and kept in the order.
 * @param string $orderId A paid order.
 * @return array<int, array{title: string, url: string}>
 */
function order_invite_links(string $orderId): array
{
    return with_order_lock($orderId, function () use ($orderId) {
        $order = load_order($orderId);
        $invites = $order['telegramInvites'] ?? [];
        $links = [];
        foreach (order_chats($order) as $chat) {
            // Keyed by chat id, so a chat replaced in src/telegram.json gets a fresh link.
            $chatId = (string) $chat['id'];
            if (!isset($invites[$chatId])) {
                try {
                    $invite = telegram_request('createChatInviteLink', [
                        'chat_id' => $chat['id'],
                        'name' => 'Заказ ' . substr($orderId, 0, 8),
                        'creates_join_request' => true,
                    ]);
                    $invites[$chatId] = $invite['invite_link'];
                } catch (RuntimeException $exception) {
                    // Usually the bot is not an admin there or may not invite users.
                    log_event("bot invite failed order=$orderId chat=$chatId " . $exception->getMessage());
                    continue;
                }
            }
            $links[] = ['title' => $chat['title'], 'url' => $invites[$chatId]];
        }
        if ($invites !== ($order['telegramInvites'] ?? [])) {
            $order['telegramInvites'] = $invites;
            save_order($order);
        }
        return $links;
    });
}

/**
 * Sends what was bought and the buttons to join the chats.
 * @param array<string, mixed> $order A paid order bound to the user.
 * @param int $userId
 */
function send_order_summary(array $order, int $userId): void
{
    $formatPrice = fn($price) => number_format($price, 0, ',', ' ') . ' ₽';
    $items = array_map(
        fn($item) => "— {$item['title']}: " . $formatPrice($item['price']),
        array_merge([$order['plan']], $order['electives'])
    );
    $text = bot_text('paid', [
        'name' => $order['name'],
        'items' => implode("\n", $items),
        'total' => $formatPrice($order['total']),
    ]);
    $links = order_invite_links($order['id']);
    if (!$links) {
        send_message($userId, $text . "\n\n" . bot_text('chatsLater'));
        return;
    }
    $buttons = array_map(fn($link) => [['text' => $link['title'], 'url' => $link['url']]], $links);
    send_message($userId, $text . "\n\n" . bot_text('chats'), [
        'reply_markup' => ['inline_keyboard' => $buttons],
    ]);
}

/**
 * Handles /start with an order id: binds the order to the account on first use.
 * @param string $orderId Untrusted /start parameter.
 * @param int $userId
 */
function claim_order(string $orderId, int $userId): void
{
    $order = load_order($orderId);
    if ($order === null) {
        send_message($userId, bot_text('notFound'));
        return;
    }
    if (empty($order['paidAt'])) {
        send_message($userId, bot_text('notPaid'));
        return;
    }
    $order = with_order_lock($orderId, function () use ($orderId, $userId) {
        $order = load_order($orderId);
        $boundUserId = $order['telegramUserId'] ?? null;
        // One order, one account: a forwarded link must not open the chats to someone else.
        if ($boundUserId !== null && $boundUserId !== $userId) {
            return null;
        }
        if ($boundUserId === null) {
            $order['telegramUserId'] = $userId;
            $order['telegramBoundAt'] = date('c');
            save_order($order);
            log_event("bot bound order=$orderId user=$userId");
        }
        return $order;
    });
    if ($order === null) {
        log_event("bot rejected order=$orderId user=$userId: bound to another account");
        send_message($userId, bot_text('otherAccount'));
        return;
    }
    remember_user_order($userId, $orderId);
    send_order_summary($order, $userId);
}

/**
 * Handles a message: /start in a private chat, chat id changes in groups.
 * @param array<string, mixed> $message
 */
function handle_message(array $message): void
{
    // A group became a supergroup and got a new id; the old one stops working.
    if (isset($message['migrate_to_chat_id'])) {
        notify_organizers(
            'Чат «' . ($message['chat']['title'] ?? '') . '» сменил id',
            "Чат «{$message['chat']['title']}» стал супергруппой.\n\n"
                . "Старый id: {$message['chat']['id']}\nНовый id: {$message['migrate_to_chat_id']}\n\n"
                . 'Замените id в src/telegram.json, иначе бот не сможет пускать в этот чат.'
        );
        return;
    }
    // In groups the bot stays silent; it talks to buyers in private only.
    if (($message['chat']['type'] ?? '') !== 'private') {
        return;
    }
    $userId = (int) $message['from']['id'];
    $text = trim((string) ($message['text'] ?? ''));
    if (!preg_match('~^/start(?:\s+(\S+))?$~', $text, $match)) {
        send_message($userId, bot_text('help'));
        return;
    }
    if (isset($match[1])) {
        claim_order($match[1], $userId);
        return;
    }
    // A bare /start shows the user's orders again, e.g. once the chats are added.
    $orders = user_orders($userId);
    if (!$orders) {
        send_message($userId, bot_text('start'));
    }
    foreach ($orders as $order) {
        send_order_summary($order, $userId);
    }
}

/**
 * Approves a join request from a buyer of that chat and declines anyone else.
 * @param array<string, mixed> $request chat_join_request update.
 */
function handle_join_request(array $request): void
{
    // Requests through links made by people are left for the chat admins.
    if ((int) ($request['invite_link']['creator']['id'] ?? 0) !== bot_user_id()) {
        return;
    }
    $chatId = (int) $request['chat']['id'];
    $userId = (int) $request['from']['id'];
    $allowed = false;
    foreach (user_orders($userId) as $order) {
        foreach (order_chats($order) as $chat) {
            $allowed = $allowed || $chat['id'] === $chatId;
        }
    }
    telegram_request($allowed ? 'approveChatJoinRequest' : 'declineChatJoinRequest', [
        'chat_id' => $chatId,
        'user_id' => $userId,
    ]);
    log_event('bot ' . ($allowed ? 'approved' : 'declined') . " join chat=$chatId user=$userId");
}

/**
 * Tells the organizers the id of a chat where the bot was made an admin.
 * @param array<string, mixed> $update my_chat_member update.
 */
function handle_bot_membership(array $update): void
{
    $member = $update['new_chat_member'];
    if ($member['status'] !== 'administrator' || $update['chat']['type'] === 'private') {
        return;
    }
    $chat = $update['chat'];
    $text = "Бот стал администратором чата «{$chat['title']}».\n\nid чата: {$chat['id']}\n\n"
        . 'Чтобы бот пускал в этот чат участников, впишите id в src/telegram.json.';
    if (empty($member['can_invite_users'])) {
        $text .= "\n\nВнимание: у бота нет права «Пригласительные ссылки», без него он не выдаст ссылки на вступление.";
    }
    notify_organizers("Бот добавлен в чат «{$chat['title']}»", $text);
}

/**
 * Logs a message for the organizers and emails it to notify_email.
 * @param string $subject
 * @param string $text
 */
function notify_organizers(string $subject, string $text): void
{
    log_event('bot notice: ' . str_replace("\n", ' ', $text));
    $notifyEmail = (string) config()['notify_email'];
    if ($notifyEmail !== '') {
        send_mail($notifyEmail, 'Telegram-бот: ' . $subject, $text);
    }
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respond_json(405, ['error' => 'Method not allowed']);
}
$secret = (string) ($_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '');
if (config()['telegram_bot_token'] === '' || !hash_equals(telegram_webhook_secret(), $secret)) {
    respond_json(403, ['error' => 'Forbidden']);
}

$update = json_decode((string) file_get_contents('php://input'), true);
try {
    if (isset($update['message'])) {
        handle_message($update['message']);
    } elseif (isset($update['chat_join_request'])) {
        handle_join_request($update['chat_join_request']);
    } elseif (isset($update['my_chat_member'])) {
        handle_bot_membership($update['my_chat_member']);
    }
} catch (Throwable $exception) {
    // A retry would repeat the same failure; log it and let Telegram move on.
    log_event('bot error ' . $exception->getMessage());
}
respond_json(200, ['ok' => true]);
