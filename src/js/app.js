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
// Checks a promo code before payment; see src/api/promo.php.
const PROMO_ENDPOINT = 'api/promo.php';
const PROMO_ERROR = 'Не удалось проверить промокод. Попробуйте ещё раз.';
const promoInput = document.querySelector('#app-promo');
const promoButton = document.querySelector('#apply-promo');
const promoStatus = document.querySelector('#promo-status');
// The code the server confirmed: {code, percent, plans}; null until one is applied.
let appliedPromo = null;
const submitButton = form.querySelector('button[type="submit"]');
const emailInput = document.querySelector('#app-email');
const phoneInput = document.querySelector('#app-phone');
const telegramInput = document.querySelector('#app-telegram');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Countries offered in the phone field: {isoCode, name, dialCode}. Russia comes first and is the default.
const PHONE_COUNTRIES = [
  { isoCode: 'RU', name: 'Россия', dialCode: '7' },
  { isoCode: 'KZ', name: 'Казахстан', dialCode: '7' },
  { isoCode: 'BY', name: 'Беларусь', dialCode: '375' },
  { isoCode: 'UA', name: 'Украина', dialCode: '380' },
  { isoCode: 'AM', name: 'Армения', dialCode: '374' },
  { isoCode: 'AZ', name: 'Азербайджан', dialCode: '994' },
  { isoCode: 'GE', name: 'Грузия', dialCode: '995' },
  { isoCode: 'KG', name: 'Киргизия', dialCode: '996' },
  { isoCode: 'MD', name: 'Молдова', dialCode: '373' },
  { isoCode: 'TJ', name: 'Таджикистан', dialCode: '992' },
  { isoCode: 'TM', name: 'Туркменистан', dialCode: '993' },
  { isoCode: 'UZ', name: 'Узбекистан', dialCode: '998' },
  { isoCode: 'AE', name: 'ОАЭ', dialCode: '971' },
  { isoCode: 'AT', name: 'Австрия', dialCode: '43' },
  { isoCode: 'AU', name: 'Австралия', dialCode: '61' },
  { isoCode: 'BE', name: 'Бельгия', dialCode: '32' },
  { isoCode: 'BG', name: 'Болгария', dialCode: '359' },
  { isoCode: 'BR', name: 'Бразилия', dialCode: '55' },
  { isoCode: 'CA', name: 'Канада', dialCode: '1' },
  { isoCode: 'CH', name: 'Швейцария', dialCode: '41' },
  { isoCode: 'CN', name: 'Китай', dialCode: '86' },
  { isoCode: 'CY', name: 'Кипр', dialCode: '357' },
  { isoCode: 'CZ', name: 'Чехия', dialCode: '420' },
  { isoCode: 'DE', name: 'Германия', dialCode: '49' },
  { isoCode: 'DK', name: 'Дания', dialCode: '45' },
  { isoCode: 'EE', name: 'Эстония', dialCode: '372' },
  { isoCode: 'EG', name: 'Египет', dialCode: '20' },
  { isoCode: 'ES', name: 'Испания', dialCode: '34' },
  { isoCode: 'FI', name: 'Финляндия', dialCode: '358' },
  { isoCode: 'FR', name: 'Франция', dialCode: '33' },
  { isoCode: 'GB', name: 'Великобритания', dialCode: '44' },
  { isoCode: 'GR', name: 'Греция', dialCode: '30' },
  { isoCode: 'HK', name: 'Гонконг', dialCode: '852' },
  { isoCode: 'HR', name: 'Хорватия', dialCode: '385' },
  { isoCode: 'HU', name: 'Венгрия', dialCode: '36' },
  { isoCode: 'ID', name: 'Индонезия', dialCode: '62' },
  { isoCode: 'IE', name: 'Ирландия', dialCode: '353' },
  { isoCode: 'IL', name: 'Израиль', dialCode: '972' },
  { isoCode: 'IN', name: 'Индия', dialCode: '91' },
  { isoCode: 'IT', name: 'Италия', dialCode: '39' },
  { isoCode: 'JP', name: 'Япония', dialCode: '81' },
  { isoCode: 'KR', name: 'Южная Корея', dialCode: '82' },
  { isoCode: 'LT', name: 'Литва', dialCode: '370' },
  { isoCode: 'LV', name: 'Латвия', dialCode: '371' },
  { isoCode: 'ME', name: 'Черногория', dialCode: '382' },
  { isoCode: 'MX', name: 'Мексика', dialCode: '52' },
  { isoCode: 'NL', name: 'Нидерланды', dialCode: '31' },
  { isoCode: 'NO', name: 'Норвегия', dialCode: '47' },
  { isoCode: 'NZ', name: 'Новая Зеландия', dialCode: '64' },
  { isoCode: 'PL', name: 'Польша', dialCode: '48' },
  { isoCode: 'PT', name: 'Португалия', dialCode: '351' },
  { isoCode: 'RO', name: 'Румыния', dialCode: '40' },
  { isoCode: 'RS', name: 'Сербия', dialCode: '381' },
  { isoCode: 'SA', name: 'Саудовская Аравия', dialCode: '966' },
  { isoCode: 'SE', name: 'Швеция', dialCode: '46' },
  { isoCode: 'SG', name: 'Сингапур', dialCode: '65' },
  { isoCode: 'SI', name: 'Словения', dialCode: '386' },
  { isoCode: 'SK', name: 'Словакия', dialCode: '421' },
  { isoCode: 'TH', name: 'Таиланд', dialCode: '66' },
  { isoCode: 'TR', name: 'Турция', dialCode: '90' },
  { isoCode: 'US', name: 'США', dialCode: '1' },
  { isoCode: 'VN', name: 'Вьетнам', dialCode: '84' },
];
const DEFAULT_COUNTRY = 'RU';
// Dial code 7 (Russia, Kazakhstan) has a fixed 10-digit local number.
const RUSSIAN_DIAL_CODE = '7';
const RUSSIAN_LOCAL_DIGITS = 10;
// International numbers are at most 15 digits including the country code (E.164).
const PHONE_MAX_DIGITS = 15;
const PHONE_MIN_LOCAL_DIGITS = 6;
const countrySelect = document.querySelector('#app-country');
const dialCodeInput = document.querySelector('#app-dial-code');
// Select value for a code that is not in the list.
const OTHER_COUNTRY = 'OTHER';
const MAX_DIAL_CODE_DIGITS = 4;
const EMAIL_ERROR = 'Укажите email в формате you@example.com';
const PHONE_ERROR = 'Укажите телефон: выберите страну и введите номер полностью';
// Telegram usernames: 5–32 Latin letters, digits and underscores.
const TELEGRAM_PATTERN = /^[A-Za-z0-9_]{5,32}$/;
const TELEGRAM_ERROR = 'Укажите ник в Telegram, например @username';

/**
 * Turns an ISO country code into its flag emoji.
 * @param {string} isoCode Two uppercase letters, e.g. RU.
 * @returns {string} Flag made of regional indicator symbols.
 */
function flagOf(isoCode) {
  return String.fromCodePoint(...[...isoCode].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
}

/**
 * Reads the country code typed after the plus.
 * @returns {string} Digits only, possibly empty while the user is still typing.
 */
function currentDialCode() {
  return dialCodeInput.value.replace(/\D/g, '');
}

/**
 * Points the select at the country that owns the typed code.
 * Keeps the chosen country when it shares the code (Russia and Kazakhstan both use 7).
 */
function syncCountryWithDialCode() {
  const dialCode = currentDialCode();
  const chosen = PHONE_COUNTRIES.find((country) => country.isoCode === countrySelect.value);
  if (chosen && chosen.dialCode === dialCode) return;
  const match = PHONE_COUNTRIES.find((country) => country.dialCode === dialCode);
  countrySelect.value = match ? match.isoCode : OTHER_COUNTRY;
}

/**
 * Longest number of local digits for a dial code.
 * @param {string} dialCode Country code without the plus.
 * @returns {number}
 */
function maxLocalDigits(dialCode) {
  return dialCode === RUSSIAN_DIAL_CODE ? RUSSIAN_LOCAL_DIGITS : PHONE_MAX_DIGITS - dialCode.length;
}

/**
 * Switches the select to the country whose dial code starts a pasted +… number.
 * @param {string} value Raw field value starting with a plus.
 * @returns {string} The value without the plus and country code, or as is if nothing matched.
 */
function applyPastedDialCode(value) {
  const digits = value.replace(/\D/g, '');
  // The longest code wins, so +375 is Belarus and not a +37… one.
  const match = PHONE_COUNTRIES.filter((country) => digits.startsWith(country.dialCode)).sort(
    (first, second) => second.dialCode.length - first.dialCode.length,
  )[0];
  if (!match) return digits;
  dialCodeInput.value = match.dialCode;
  syncCountryWithDialCode();
  return digits.slice(match.dialCode.length);
}

/**
 * Extracts the local digits of the phone for the chosen country.
 * @param {string} phone Raw field value.
 * @returns {string} Digits without the country code, trimmed to the maximum length.
 */
function phoneLocalDigits(phone) {
  const value = phone.trim();
  let digits = value.startsWith('+') ? applyPastedDialCode(value) : value.replace(/\D/g, '');
  // Russian numbers are often typed as 8 900… or 7 900…
  if (
    currentDialCode() === RUSSIAN_DIAL_CODE &&
    digits.length > RUSSIAN_LOCAL_DIGITS &&
    /^[78]/.test(digits)
  ) {
    digits = digits.slice(1);
  }
  return digits.slice(0, maxLocalDigits(currentDialCode()));
}

/**
 * Formats the local digits as the user types: 900 123-45-67 for +7, groups of three otherwise.
 * @param {string} phone Raw field value.
 * @returns {string} Formatted local part without the country code.
 */
function formatPhone(phone) {
  const local = phoneLocalDigits(phone);
  if (currentDialCode() !== RUSSIAN_DIAL_CODE) {
    // 202 555 0123: two groups of three, the rest in the last one.
    return [local.slice(0, 3), local.slice(3, 6), local.slice(6)].filter(Boolean).join(' ');
  }
  const area = local.slice(0, 3);
  const rest = [local.slice(3, 6), local.slice(6, 8), local.slice(8, 10)].filter(Boolean);
  return [area, rest.join('-')].filter(Boolean).join(' ');
}

/**
 * Checks that the phone is complete and brings it to the international form.
 * @param {string} phone Raw field value.
 * @returns {string|null} Phone as +79001234567, or null for an incomplete number.
 */
function normalizePhone(phone) {
  const dialCode = currentDialCode();
  if (!dialCode) return null;
  const local = phoneLocalDigits(phone);
  const minDigits = dialCode === RUSSIAN_DIAL_CODE ? RUSSIAN_LOCAL_DIGITS : PHONE_MIN_LOCAL_DIGITS;
  return local.length >= minDigits ? '+' + dialCode + local : null;
}

/** Puts the dial code of the chosen country into the code field. */
function showDialCode() {
  const chosen = PHONE_COUNTRIES.find((country) => country.isoCode === countrySelect.value);
  // "Other" leaves the typed code alone.
  if (chosen) dialCodeInput.value = chosen.dialCode;
}

/** Fills the country select with flags, names and codes. */
function fillCountrySelect() {
  for (const country of PHONE_COUNTRIES) {
    const label = `${flagOf(country.isoCode)}  ${country.name} +${country.dialCode}`;
    countrySelect.append(new Option(label, country.isoCode));
  }
  countrySelect.append(new Option('Другая страна', OTHER_COUNTRY));
  countrySelect.value = DEFAULT_COUNTRY;
  showDialCode();
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
 * Discount a promo code gives on one price. Same formula as promo_discount() in
 * src/api/lib.php: rounded to whole rubles, at least 1 ruble, and the price never drops below
 * 1 ruble.
 * @param {number} price Full price in rubles.
 * @param {number} percent 1–99.
 * @returns {number} Rubles off the price.
 */
function promoDiscount(price, percent) {
  const discount = Math.max(1, Math.round((price * percent) / 100));
  return Math.max(0, Math.min(price - 1, discount));
}

/**
 * Selected plan and electives, each with its key and price after the applied promo code.
 * @returns {{key: string, title: string, price: number, percent: number, discount: number}[]}
 */
function selectedItems() {
  const keys = [
    plan.value,
    ...[...extras.querySelectorAll('input:checked')].map((checkbox) => checkbox.name),
  ];
  return keys.map((key) => {
    const item = PLANS[key] ?? ELECTIVES[key];
    const percent = appliedPromo?.discounts[key] ?? 0;
    const discount = percent ? promoDiscount(item.price, percent) : 0;
    return { key, title: item.title, price: item.price - discount, percent, discount };
  });
}

/**
 * Builds the application from the current form state.
 * @returns {{discount: number, total: number}} Rubles off and the total to pay.
 */
function collectSelection() {
  const items = selectedItems();
  return {
    discount: items.reduce((sum, item) => sum + item.discount, 0),
    total: items.reduce((sum, item) => sum + item.price, 0),
  };
}

/**
 * Shows what the applied promo code takes off the selected plan and electives, or an error.
 * @param {string} [error] Error text; without it the status follows appliedPromo.
 */
function showPromoStatus(error) {
  promoStatus.classList.toggle('error', Boolean(error));
  if (error) {
    promoStatus.textContent = error;
    return;
  }
  if (!appliedPromo) {
    promoStatus.textContent = '';
    return;
  }
  const discounted = selectedItems().filter((item) => item.percent);
  if (!discounted.length) {
    // Name what the code is for, so the buyer can pick it.
    const covered = Object.keys(appliedPromo.discounts)
      .map((key) => '«' + (PLANS[key] ?? ELECTIVES[key]).title + '»')
      .join(', ');
    promoStatus.textContent = 'Промокод действует только на ' + covered;
    promoStatus.classList.add('error');
    return;
  }
  const parts = discounted.map((item) => '«' + item.title + '» −' + item.percent + '%');
  promoStatus.textContent =
    'Скидка: ' + parts.join(', ') + '. Итого −' + money.format(collectSelection().discount) + ' ₽';
}

/**
 * Checks the typed promo code on the server and applies it to the total.
 */
async function applyPromo() {
  const code = promoInput.value.trim();
  appliedPromo = null;
  if (!code) {
    showPromoStatus();
    updateTotal();
    return;
  }
  promoButton.disabled = true;
  try {
    const response = await fetch(PROMO_ENDPOINT + '?code=' + encodeURIComponent(code), {
      cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || PROMO_ERROR);
    appliedPromo = result;
    showPromoStatus();
  } catch (error) {
    // A failed fetch or broken JSON has a technical message; show ours instead.
    showPromoStatus(
      error instanceof SyntaxError || error instanceof TypeError ? PROMO_ERROR : error.message,
    );
  } finally {
    promoButton.disabled = false;
    updateTotal();
  }
}

/**
 * Shows electives only for the full plan and refreshes the total and the promo code's discount.
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
  // The plan or its price may have changed: say whether the code still applies.
  if (appliedPromo) showPromoStatus();
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
promoButton.addEventListener('click', applyPromo);
promoInput.addEventListener('keydown', (event) => {
  // Enter applies the code instead of submitting the whole form.
  if (event.key === 'Enter') {
    event.preventDefault();
    applyPromo();
  }
});
// An edited code is no longer the one checked.
promoInput.addEventListener('input', () => {
  if (!appliedPromo) return;
  appliedPromo = null;
  showPromoStatus();
  updateTotal();
});
// Drop the error as soon as the user edits a field, so the next submit re-checks it.
emailInput.addEventListener('input', () => emailInput.setCustomValidity(''));
telegramInput.addEventListener('input', () => telegramInput.setCustomValidity(''));
fillCountrySelect();
phoneInput.addEventListener('input', () => {
  phoneInput.setCustomValidity('');
  // Reformat only while typing at the end, so edits in the middle keep the caret in place.
  if (phoneInput.selectionStart === phoneInput.value.length) {
    phoneInput.value = formatPhone(phoneInput.value);
  }
});
// Autofill and paste can leave the caret elsewhere; tidy the value when the field is left.
phoneInput.addEventListener('blur', () => (phoneInput.value = formatPhone(phoneInput.value)));
// A typed code picks its country, or "other" when the list has none.
dialCodeInput.addEventListener('input', () => {
  phoneInput.setCustomValidity('');
  dialCodeInput.value = currentDialCode().slice(0, MAX_DIAL_CODE_DIGITS);
  syncCountryWithDialCode();
  phoneInput.value = formatPhone(phoneInput.value);
});
// Another country changes the code and the digit limit, so the number is formatted again.
countrySelect.addEventListener('change', () => {
  phoneInput.setCustomValidity('');
  showDialCode();
  phoneInput.value = formatPhone(phoneInput.value);
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
    // A typed but unapplied code goes too: the server checks it and says if it is wrong.
    promoCode: promoInput.value.trim(),
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
