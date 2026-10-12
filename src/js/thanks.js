// Thank-you page: waits until the bank confirms the payment, then shows the Telegram link.
const statusText = document.querySelector('#payment-status');
const telegramButton = document.querySelector('#telegram-link');
const orderId = new URLSearchParams(window.location.search).get('order') || '';
// The bank usually confirms within seconds; give up after about two minutes.
const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 40;
const CONTACT = 'contact@brandmasterskaya.ru';

/**
 * Asks the server for the order status and updates the page; schedules the next check.
 * @param {number} attempt Number of checks made so far.
 */
async function checkPayment(attempt) {
  let result = { status: 'pending' };
  try {
    const response = await fetch('api/order.php?id=' + encodeURIComponent(orderId), {
      cache: 'no-store',
    });
    result = await response.json();
  } catch {
    // A network hiccup is retried like a pending payment.
  }
  if (result.status === 'paid') {
    statusText.textContent =
      'Оплата получена. Завершите регистрацию в Telegram-боте — ссылку мы также отправили на ' +
      result.email +
      '.';
    telegramButton.href = result.telegramLink;
    telegramButton.hidden = false;
    return;
  }
  if (result.status === 'not_found' || result.status === 'expired') {
    statusText.textContent =
      'Не нашли оплаченный заказ. Если деньги списались, напишите нам: ' + CONTACT + '.';
    return;
  }
  if (attempt + 1 >= MAX_ATTEMPTS) {
    statusText.textContent =
      'Банк ещё не подтвердил оплату. Как только подтвердит, пришлём ссылку на почту. ' +
      'Если письма нет дольше часа, напишите нам: ' +
      CONTACT +
      '.';
    return;
  }
  setTimeout(() => checkPayment(attempt + 1), POLL_INTERVAL_MS);
}

checkPayment(0);
