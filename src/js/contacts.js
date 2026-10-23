// Replaces the contacts baked into the page with those set in the admin panel;
// see src/api/contacts.php. The baked contacts stay if the request fails.
const CONTACTS_ENDPOINT = 'api/contacts.php';

/**
 * Writes one contact into every element marked with its data-contact name.
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

/** Loads the current contacts and puts them on the page. */
async function refreshContacts() {
  const response = await fetch(CONTACTS_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) return;
  const contacts = await response.json();
  showContact('phone', 'tel:' + contacts.phone, contacts.phoneText);
  showContact('telegram', 'https://t.me/' + contacts.telegram, '@' + contacts.telegram);
  showContact('email', 'mailto:' + contacts.email, contacts.email);
}

refreshContacts().catch(() => {});
