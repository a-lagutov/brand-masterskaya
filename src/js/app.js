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
const PLANS = {
  watch: { title: 'Только смотрю', price: 89900 },
  work: { title: 'Смотрю и работаю', price: 219900 },
};
const ELECTIVES = {
  director: { title: 'Продвинутый бренд-директор', price: 69900 },
  business: { title: 'Бренд-ориентированный бизнес', price: 69900 },
};
// Salebot link to the Telegram bot; the application travels in the query string.
const APPLICATION_LINK = 'https://link.brandmasterskaya.ru/r/zayavka_1';
const emailInput = document.querySelector('#app-email');
const phoneInput = document.querySelector('#app-phone');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// International numbers have 10 to 15 digits; Russian ones are exactly 11 with the leading 7.
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const RUSSIAN_PHONE_DIGITS = 11;
const EMAIL_ERROR = 'Укажите email в формате you@example.com';
const PHONE_ERROR = 'Укажите телефон в формате +7 (900) 000-00-00';

/**
 * Extracts phone digits, treating a leading 8 or a bare 9 as a Russian number.
 * @param {string} phone Raw field value.
 * @returns {string} Digits with the country code, e.g. 79001234567.
 */
function phoneDigits(phone) {
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+')) return digits;
  if (digits.startsWith('8')) return '7' + digits.slice(1);
  if (digits.startsWith('9')) return '7' + digits;
  return digits;
}

/**
 * Formats a phone as the user types: +7 (900) 123-45-67 for Russia, +<digits> otherwise.
 * @param {string} phone Raw field value.
 * @returns {string} Formatted value; without digits only a lone plus survives.
 */
function formatPhone(phone) {
  const digits = phoneDigits(phone).slice(0, PHONE_MAX_DIGITS);
  // Keep a lone plus so an international number can be started.
  if (!digits) return phone.trim() === '+' ? '+' : '';
  if (!digits.startsWith('7')) return '+' + digits;
  const local = digits.slice(1, RUSSIAN_PHONE_DIGITS);
  // Groups of the local part: (900) 123-45-67.
  const groups = [local.slice(0, 3), local.slice(3, 6), local.slice(6, 8), local.slice(8, 10)];
  let formatted = '+7';
  if (groups[0]) formatted += ' (' + groups[0];
  if (groups[1]) formatted += ') ' + groups[1];
  if (groups[2]) formatted += '-' + groups[2];
  if (groups[3]) formatted += '-' + groups[3];
  return formatted;
}

/**
 * Checks the phone length and brings it to one format.
 * @param {string} phone Raw field value.
 * @returns {string|null} Phone as +79001234567, or null when it is too short or too long.
 */
function normalizePhone(phone) {
  const digits = phoneDigits(phone);
  const valid = digits.startsWith('7')
    ? digits.length === RUSSIAN_PHONE_DIGITS
    : digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
  return valid ? '+' + digits : null;
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
  const working = plan.value === 'work';
  extras.hidden = !working;
  extras.disabled = !working;
  if (!working) extras.querySelectorAll('input').forEach((x) => (x.checked = false));
  const total = collectSelection().total;
  document.querySelector('#total').value = money.format(total) + ' ₽';
  return total;
}
document.querySelectorAll('.choose-plan').forEach((button) =>
  button.addEventListener('click', (e) => {
    e.preventDefault();
    plan.value = button.dataset.plan;
    document.querySelector('#form-status').textContent = '';
    updateTotal();
    dialog.showModal();
  }),
);
document.querySelectorAll('.add-elective').forEach((button) =>
  button.addEventListener('click', () => {
    plan.value = 'work';
    const activeTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    const elective = activeTab?.id === 'tab-business' ? 'business' : 'director';
    const checkbox = extras.querySelector('input[name="' + elective + '"]');
    checkbox.checked = true;
    document.querySelector('#form-status').textContent = '';
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
phoneInput.addEventListener('input', () => {
  phoneInput.setCustomValidity('');
  // Reformat only while typing at the end, so edits in the middle keep the caret in place.
  if (phoneInput.selectionStart === phoneInput.value.length) {
    phoneInput.value = formatPhone(phoneInput.value);
  }
});
// Autofill and paste can leave the caret elsewhere; tidy the value when the field is left.
phoneInput.addEventListener('blur', () => (phoneInput.value = formatPhone(phoneInput.value)));
/**
 * Opens the Salebot link with the application passed as query parameters.
 * @param {SubmitEvent} event
 */
function submitApplication(event) {
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
  const data = new FormData(form);
  const selection = collectSelection();
  const application = new URLSearchParams({
    name: data.get('name').trim(),
    email,
    phone,
    plan: selection.plan.title,
    plan_price: selection.plan.price,
    electives: selection.electives.map((elective) => elective.title).join(', '),
    electives_price: selection.total - selection.plan.price,
    total: selection.total,
    currency: 'RUB',
  });
  window.location.assign(APPLICATION_LINK + '?' + application);
}
form.addEventListener('submit', submitApplication);
updateTotal();
