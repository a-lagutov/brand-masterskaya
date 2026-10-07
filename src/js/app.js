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
// Titles must match the catalog in send.php, which recomputes prices server-side.
const PLANS = {
  watch: { title: 'Только смотрю', price: 89900 },
  work: { title: 'Смотрю и работаю', price: 219900 },
};
const ELECTIVES = {
  director: { title: 'Продвинутый бренд-директор', price: 69900 },
  business: { title: 'Бренд-ориентированный бизнес', price: 69900 },
};
const APPLICATION_ENDPOINT = 'send.php';

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
/**
 * Sends the application to send.php and reports the result in the form.
 * @param {SubmitEvent} event
 */
async function submitApplication(event) {
  event.preventDefault();
  const status = document.querySelector('#form-status');
  const submitButton = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const selection = collectSelection();
  // Flat form POST: Salebot reads plain variables, not nested JSON.
  const application = new URLSearchParams({
    name: data.get('name').trim(),
    contact: data.get('contact').trim(),
    plan: selection.plan.title,
    plan_price: selection.plan.price,
    electives: selection.electives.map((elective) => elective.title).join(', '),
    electives_price: selection.total - selection.plan.price,
    total: selection.total,
    currency: 'RUB',
  });
  // Honeypot is sent only when filled, so real requests keep the documented shape.
  if (data.get('website')) application.set('website', data.get('website'));

  submitButton.disabled = true;
  status.textContent = 'Отправляем заявку…';
  try {
    const response = await fetch(APPLICATION_ENDPOINT, {
      method: 'POST',
      body: application,
    });
    if (response.status === 429) {
      status.textContent = 'Слишком много попыток. Попробуйте через 10 минут.';
      return;
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    form.reset();
    updateTotal();
    status.textContent = 'Заявка отправлена. Мы свяжемся с вами в ближайшее время.';
  } catch {
    status.textContent = 'Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.';
  } finally {
    submitButton.disabled = false;
  }
}
form.addEventListener('submit', submitApplication);
updateTotal();
