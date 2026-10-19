const menuButton = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('#mobile-nav');
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  mobileNav.hidden = !open;
});
mobileNav.querySelectorAll('a').forEach((a) =>
  a.addEventListener('click', () => {
    mobileNav.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Открыть меню');
  }),
);
const tabs = [...document.querySelectorAll('[role=tab]')];
function selectTab(tab) {
  tabs.forEach((t) => {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    let next;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    }
  });
});
const dialog = document.querySelector('#enroll');
const form = document.querySelector('#application');
const plan = document.querySelector('#plan');
const extras = document.querySelector('#extra-options');
const money = new Intl.NumberFormat('ru-RU');
// Plans and prices from src/prices.json, substituted by the build (scripts/build.mjs).
const PLANS = __PRICES__.plans;
const ELECTIVES = __PRICES__.electives;
// Electives can only be added to this plan.
const ELECTIVES_PLAN = __PRICES__.electivesPlan;
// Prices set in the admin panel; see src/api/prices.php.
const PRICES_ENDPOINT = 'api/prices.php';
// Creates the order and returns the bank's payment page; see src/api/pay.php.
const PAYMENT_ENDPOINT = 'api/pay.php';
const PAYMENT_ERROR = 'Не удалось перейти к оплате. Попробуйте ещё раз или напишите нам.';
const submitButton = form.querySelector('button[type="submit"]');
const emailInput = document.querySelector('#app-email');
const phoneInput = document.querySelector('#app-phone');
const telegramInput = document.querySelector('#app-telegram');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Only Russian numbers: +7 and 10 local digits.
const PHONE_PREFIX = '+7';
const PHONE_LOCAL_DIGITS = 10;
const EMAIL_ERROR = 'Укажите email в формате you@example.com';
const PHONE_ERROR = 'Укажите телефон в формате +7 (900) 000-00-00';
// Telegram usernames: 5–32 Latin letters, digits and underscores.
const TELEGRAM_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const TELEGRAM_ERROR = 'Укажите ник в Telegram, например @username';

/**
 * Extracts the 10 local digits of a Russian phone, dropping the country code.
 * @param {string} phone Raw field value.
 * @returns {string} Up to 10 digits after +7, e.g. 9001234567.
 */
function phoneLocalDigits(phone) {
  const value = phone.trim();
  // Our own formatting or a pasted +7 number: the 7 is the country code.
  const hasPrefix = value.startsWith(PHONE_PREFIX);
  const digits = (hasPrefix ? value.slice(PHONE_PREFIX.length) : value).replace(/\D/g, '');
  // A full number with 8 or 7 in front (typed without the plus, or pasted after the
  // +7 prefill) carries the country code; after +7 a single 8 may start a city code like 812.
  const withCountryCode =
    /^[78]/.test(digits) && (!hasPrefix || digits.length > PHONE_LOCAL_DIGITS);
  return (withCountryCode ? digits.slice(1) : digits).slice(0, PHONE_LOCAL_DIGITS);
}

/**
 * Detects a number with a country code other than +7.
 * @param {string} phone Raw field value.
 * @returns {boolean} True for values like +44 20 7946 0958.
 */
function isForeignPhone(phone) {
  const value = phone.trim();
  // A lone plus is the start of +7 being typed.
  return value.startsWith('+') && value.length > 1 && !value.startsWith(PHONE_PREFIX);
}

/**
 * Formats a phone as the user types: +7 (900) 123-45-67.
 * @param {string} phone Raw field value.
 * @returns {string} Formatted value, the input as is for a foreign code, or an empty string
 *   when there are no local digits.
 */
function formatPhone(phone) {
  // Another country code is left as typed, so validation can reject it instead of rewriting it.
  if (isForeignPhone(phone)) return phone.trim();
  const local = phoneLocalDigits(phone);
  if (!local) return '';
  // Groups of the local part: (900) 123-45-67.
  const groups = [local.slice(0, 3), local.slice(3, 6), local.slice(6, 8), local.slice(8, 10)];
  let formatted = PHONE_PREFIX + ' (' + groups[0];
  if (groups[1]) formatted += ') ' + groups[1];
  if (groups[2]) formatted += '-' + groups[2];
  if (groups[3]) formatted += '-' + groups[3];
  return formatted;
}

/**
 * Checks that the phone is a full Russian number and brings it to one format.
 * @param {string} phone Raw field value.
 * @returns {string|null} Phone as +79001234567, or null for a foreign or incomplete number.
 */
function normalizePhone(phone) {
  if (isForeignPhone(phone)) return null;
  const local = phoneLocalDigits(phone);
  return local.length === PHONE_LOCAL_DIGITS ? PHONE_PREFIX + local : null;
}

/**
 * Brings a Telegram username to a bare form: strips @ and a t.me link.
 * @param {string} telegram Raw field value.
 * @returns {string|null} Username without @, or null when blank or invalid.
 */
function normalizeTelegram(telegram) {
  const username = telegram
    .trim()
    .replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '');
  return TELEGRAM_PATTERN.test(username) ? username : null;
}

/**
 * Shows the field's error in the browser bubble and focuses it.
 * @param {HTMLInputElement} input Field to report.
 * @param {string} message Error text.
 */
function reportFieldError(input, message) {
  input.setCustomValidity(message);
  input.reportValidity();
}

/**
 * Builds the application from the current form state.
 * @returns {{plan: {title: string, price: number}, electives: {title: string, price: number}[], total: number}}
 */
function collectSelection() {
  const selectedPlan = PLANS[plan.value];
  const electives = [...extras.querySelectorAll('input:checked')].map(
    (checkbox) => ELECTIVES[checkbox.name],
  );
  const total = electives.reduce((sum, elective) => sum + elective.price, selectedPlan.price);
  return { plan: selectedPlan, electives, total };
}

/**
 * Shows electives only for the full plan and refreshes the total.
 * @returns {number} Current total in rubles.
 */
function updateTotal() {
  const working = plan.value === ELECTIVES_PLAN;
  extras.hidden = !working;
  extras.disabled = !working;
  if (!working) extras.querySelectorAll('input').forEach((x) => (x.checked = false));
  const total = collectSelection().total;
  // Markup, not text, so the ruble sign keeps its own font; the amount is a formatted number.
  document.querySelector('#total').innerHTML =
    money.format(total) + ' <span class="ruble">₽</span>';
  return total;
}
/**
 * Replaces the prices baked in by the build with those set in the admin panel: on the page,
 * in the plan list and in the form total. The baked prices stay if the request fails.
 */
async function refreshPrices() {
  const response = await fetch(PRICES_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) return;
  const prices = await response.json();
  document.querySelector('#pay-dolyame').hidden = prices.dolyame !== true;
  Object.keys(prices).forEach((key) => {
    const item = PLANS[key] ?? ELECTIVES[key];
    const price = prices[key];
    if (item && Number.isInteger(price) && price > 0) item.price = price;
  });
  document.querySelectorAll('[data-price]').forEach((element) => {
    const item = PLANS[element.dataset.price] ?? ELECTIVES[element.dataset.price];
    if (item) element.textContent = money.format(item.price);
  });
  plan.querySelectorAll('option').forEach((option) => {
    const item = PLANS[option.value];
    if (item) option.textContent = item.title + ' — ' + money.format(item.price) + ' ₽';
  });
  updateTotal();
}
refreshPrices()
  .catch(() => {})
  .finally(() => document.documentElement.classList.remove('prices-loading'));
document.querySelectorAll('.choose-plan').forEach((button) =>
  button.addEventListener('click', (e) => {
    e.preventDefault();
    plan.value = button.dataset.plan;
    showFormStatus('');
    updateTotal();
    dialog.showModal();
  }),
);
document.querySelectorAll('.add-elective').forEach((button) =>
  button.addEventListener('click', () => {
    plan.value = ELECTIVES_PLAN;
    const activeTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    const elective = activeTab?.id === 'tab-business' ? 'business' : 'director';
    const checkbox = extras.querySelector('input[name="' + elective + '"]');
    checkbox.checked = true;
    showFormStatus('');
    updateTotal();
    dialog.showModal();
    checkbox.focus();
  }),
);
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      dialog.close();
  }
});
form.addEventListener('change', updateTotal);
// Drop the error as soon as the user edits a field, so the next submit re-checks it.
emailInput.addEventListener('input', () => emailInput.setCustomValidity(''));
telegramInput.addEventListener('input', () => telegramInput.setCustomValidity(''));
phoneInput.addEventListener('input', () => {
  phoneInput.setCustomValidity('');
  // Reformat only while typing at the end, so edits in the middle keep the caret in place.
  if (phoneInput.selectionStart === phoneInput.value.length) {
    phoneInput.value = formatPhone(phoneInput.value);
  }
});
// Autofill and paste can leave the caret elsewhere; tidy the value when the field is left.
phoneInput.addEventListener('blur', () => (phoneInput.value = formatPhone(phoneInput.value)));
// Start an empty field with +7 so only the local number is left to type.
phoneInput.addEventListener('focus', () => {
  if (!phoneInput.value) phoneInput.value = PHONE_PREFIX + ' ';
});
/**
 * Shows a message under the submit button.
 * @param {string} message Empty string clears it.
 */
function showFormStatus(message) {
  document.querySelector('#form-status').textContent = message;
}

/**
 * Sends the application to the server, which creates a Tochka payment link,
 * and takes the user to the bank's payment page.
 * @param {SubmitEvent} event
 */
async function submitApplication(event) {
  event.preventDefault();
  const email = emailInput.value.trim();
  if (!EMAIL_PATTERN.test(email)) {
    reportFieldError(emailInput, EMAIL_ERROR);
    return;
  }
  const phone = normalizePhone(phoneInput.value);
  if (!phone) {
    reportFieldError(phoneInput, PHONE_ERROR);
    return;
  }
  const telegram = normalizeTelegram(telegramInput.value);
  if (!telegram) {
    reportFieldError(telegramInput, TELEGRAM_ERROR);
    return;
  }
  const data = new FormData(form);
  // The server recalculates prices from these keys; amounts from the browser are not trusted.
  const application = {
    name: data.get('name').trim(),
    email,
    phone,
    telegram,
    plan: plan.value,
    electives: [...extras.querySelectorAll('input:checked')].map((checkbox) => checkbox.name),
    // The Dolyame button submits the same form with its own value.
    method: event.submitter?.value === 'dolyame' ? 'dolyame' : 'card',
  };
  submitButton.disabled = true;
  showFormStatus(application.method === 'dolyame' ? 'Оформляем рассрочку…' : 'Создаём платёж…');
  try {
    const response = await fetch(PAYMENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(application),
    });
    const result = await response.json();
    if (!response.ok || !result.paymentLink) throw new Error(result.error || PAYMENT_ERROR);
    window.location.assign(result.paymentLink);
  } catch (error) {
    // A failed fetch or broken JSON has a technical message; show ours instead.
    showFormStatus(
      error instanceof SyntaxError || error instanceof TypeError ? PAYMENT_ERROR : error.message,
    );
    submitButton.disabled = false;
  }
}
form.addEventListener('submit', submitApplication);
updateTotal();
// The bank sends the user back here with ?payment=failed when the payment did not go through.
if (new URLSearchParams(window.location.search).get('payment') === 'failed') {
  dialog.showModal();
  showFormStatus('Оплата не прошла. Проверьте данные и попробуйте ещё раз.');
}
