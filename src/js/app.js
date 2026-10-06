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
function computeTotal(type, count) {
  return (type === 'work' ? 219900 : 89900) + (type === 'work' ? count * 69900 : 0);
}
function updateTotal() {
  const working = plan.value === 'work';
  extras.hidden = !working;
  extras.disabled = !working;
  if (!working) extras.querySelectorAll('input').forEach((x) => (x.checked = false));
  const total = computeTotal(plan.value, extras.querySelectorAll('input:checked').length);
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
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const total = updateTotal();
  const lines = [
    'ЗАЯВКА НА УЧАСТИЕ',
    'Мастерская бренд-стратегии',
    'Антон Аверьянов и Михаил Чернышов',
    '',
    'Имя: ' + data.get('name'),
    'Контакт: ' + data.get('contact'),
    'Формат: ' + (plan.value === 'work' ? 'Смотрю и работаю' : 'Только смотрю'),
  ];
  if (data.has('director')) lines.push('Факультатив: Продвинутый бренд-директор');
  if (data.has('business')) lines.push('Факультатив: Бренд-ориентированный бизнес');
  lines.push(
    'Стоимость: ' + money.format(total) + ' ₽',
    '',
    'Заявка подготовлена для передачи организаторам. Через сайт не отправлена.',
  );
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'masterskaya-application.txt';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.querySelector('#form-status').textContent =
    'Заявка подготовлена для скачивания. Передайте файл организаторам программы.';
});
updateTotal();
