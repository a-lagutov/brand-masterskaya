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
const contactInput = document.querySelector('#app-contact');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s()-]+$/;
// International numbers have 10 to 15 digits.
const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const CONTACT_ERROR = 'Укажите email (you@example.com) или телефон (+7 900 000-00-00)';

/**
 * Checks that the contact is an email or a phone and brings it to one format.
 * @param {string} contact Raw field value.
 * @returns {string|null} Email as typed or phone as +79001234567, or null when it is neither.
 */
function normalizeContact(contact) {
  const value = contact.trim();
  if (EMAIL_PATTERN.test(value)) return value;
  if (!PHONE_PATTERN.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  // Russian numbers are often typed with a leading 8 instead of +7.
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) return null;
  return '+' + digits;
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
// Drop the error as soon as the user edits the field, so the next submit re-checks it.
contactInput.addEventListener('input', () => contactInput.setCustomValidity(''));
/**
 * Opens the Salebot link with the application passed as query parameters.
 * @param {SubmitEvent} event
 */
function submitApplication(event) {
  event.preventDefault();
  const contact = normalizeContact(contactInput.value);
  if (!contact) {
    contactInput.setCustomValidity(CONTACT_ERROR);
    contactInput.reportValidity();
    return;
  }
  const data = new FormData(form);
  const selection = collectSelection();
  const application = new URLSearchParams({
    name: data.get('name').trim(),
    contact,
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
