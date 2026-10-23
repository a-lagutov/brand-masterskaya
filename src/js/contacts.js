// Replaces the contacts and legal details baked into the page with those set in the admin
// panel; see src/api/contacts.php. The baked values stay if the request fails.
const CONTACTS_ENDPOINT = 'api/contacts.php';

/**
 * Writes one contact into every link marked with its data-contact name.
 * @param {string} name phone, telegram or email.
 * @param {string} href Link target.
 * @param {string} text Link text.
 */
function showContact(name, href, text) {
  document.querySelectorAll('[data-contact="' + name + '"]').forEach((link) => {
    link.href = href;
    link.textContent = text;
  });
}

/**
 * Writes the legal details into the elements marked with data-var, e.g. <span data-var="inn">.
 * @param {Record<string, string>} legal Details by name.
 */
function showLegal(legal) {
  document.querySelectorAll('[data-var]').forEach((element) => {
    const value = legal[element.dataset.var];
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

refreshContacts().catch(() => {});
