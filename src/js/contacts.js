// Replaces the contacts and legal details baked into the page with those set in the admin
// panel; see src/api/contacts.php. On the offer and the privacy policy (<main data-legal>) also
// loads the text, which the panel can edit; see src/api/legal.php. The baked values stay if a
// request fails.
const CONTACTS_ENDPOINT = 'api/contacts.php';
const LEGAL_ENDPOINT = 'api/legal.php?doc=';
// Saved HTML can predate the BEM stylesheet. Keep this mapping aligned with both Markdown renderers.
/** @type {Record<string, string>} */
const LEGAL_CLASSES = {
  h1: 'legal__title',
  h2: 'legal__heading',
  p: 'legal__text',
  ul: 'legal__list',
  ol: 'legal__list',
  li: 'legal__item',
  table: 'legal__table',
  td: 'legal__cell',
  a: 'text-link',
};

/**
 * Writes one contact into every link marked with its data-contact name.
 * @param {string} name phone, telegram or email.
 * @param {string} href Link target.
 * @param {string} text Link text.
 */
function showContact(name, href, text) {
  const links = /** @type {NodeListOf<HTMLAnchorElement>} */ (
    document.querySelectorAll('[data-contact="' + name + '"]')
  );
  links.forEach((link) => {
    link.href = href;
    link.textContent = text;
  });
}

/**
 * Writes the legal details into the elements marked with data-var, e.g. <span data-var="inn">.
 * @param {Record<string, string>} legal Details by name.
 */
function showLegal(legal) {
  const elements = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-var]'));
  elements.forEach((element) => {
    const value = legal[element.dataset.var ?? ''];
    if (typeof value === 'string' && value) element.textContent = value;
  });
}

/** Loads the current contacts and legal details and puts them on the page. */
async function refreshContacts() {
  const response = await fetch(CONTACTS_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) return;
  const data = await response.json();
  const contacts = data.contacts;
  showContact('phone', 'tel:' + contacts.phone, contacts.phoneText);
  showContact('telegram', 'https://t.me/' + contacts.telegram, '@' + contacts.telegram);
  showContact('email', 'mailto:' + contacts.email, contacts.email);
  showLegal(data.legal);
}

/** Replaces the text of the offer or the policy with the one the panel serves. */
async function refreshLegalText() {
  const main = /** @type {HTMLElement | null} */ (document.querySelector('main[data-legal]'));
  if (!main) return;
  const response = await fetch(LEGAL_ENDPOINT + encodeURIComponent(main.dataset.legal ?? ''), {
    cache: 'no-store',
  });
  if (!response.ok) return;
  const text = await response.text();
  // The text is the owners' own HTML from the panel; the server drops one with scripts.
  if (text.trim()) main.innerHTML = text;
  // Preserve explicit classes while styling older saved documents without changing their content.
  for (const tagName of Object.keys(LEGAL_CLASSES)) {
    for (const element of main.querySelectorAll(`${tagName}:not([class])`)) {
      element.classList.add(LEGAL_CLASSES[tagName]);
    }
  }
  // A link to a part of the text (#consent) was not there when the browser looked for it.
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

refreshContacts().catch(() => {});
refreshLegalText().catch(() => {});
