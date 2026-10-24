// Replaces the form's native selects with a styled list that looks like the email suggestions.
// The native select stays in the page, hidden, as the source of truth: app.js reads and sets
// its value, and the browser validates it on submit.
const SELECT_TYPEAHEAD_RESET_MS = 800;
const SELECT_LIST_ANIMATION_MS = 160;
const SELECT_LIST_HIDDEN_FRAME = { opacity: 0, transform: 'translateY(-6px)' };
const SELECT_LIST_SHOWN_FRAME = { opacity: 1, transform: 'translateY(0)' };
const SELECT_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * Option text without a leading flag emoji, lower case, for finding an option by typing.
 * @param {HTMLOptionElement} option
 * @returns {string}
 */
function plainOptionText(option) {
  return option.text.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase();
}

/**
 * Tells whether an option fits the search text: a word of its name starts with it, or, for a
 * code like +49, its text contains it.
 * @param {HTMLOptionElement} option
 * @param {string} needle Lower case search text; empty matches everything.
 * @returns {boolean}
 */
function matchesSearch(option, needle) {
  if (!needle) return true;
  const text = plainOptionText(option);
  if (/^[+\d]/.test(needle)) return text.includes(needle);
  return text.split(/\s+/).some((word) => word.startsWith(needle));
}

/**
 * Builds a button and a list for one select and keeps them in step with it.
 * @param {HTMLSelectElement} select Select inside a .field.
 */
function enhanceSelect(select) {
  const field = select.closest('.field');
  const label = field.querySelector('label');
  const trigger = document.createElement('button');
  const list = document.createElement('ul');
  // Countries and the like get a search box at the top of the list.
  const searchRow = select.dataset.search ? document.createElement('li') : null;
  const searchInput = searchRow ? document.createElement('input') : null;
  // Index into the list items of the highlighted option; -1 when none is.
  let activeIndex = -1;
  let typedText = '';
  let typedTimer = 0;
  // The list fading out; kept so that opening again can cancel it.
  let closingAnimation = null;

  /** Shows the selected option's text on the button. */
  function showCurrent() {
    const option = select.options[select.selectedIndex];
    trigger.textContent = option ? option.text : '';
    trigger.classList.toggle('placeholder', !select.value);
  }

  /** @returns {HTMLLIElement[]} The options currently in the list, without the search row. */
  function items() {
    return [...list.querySelectorAll('[role="option"]')];
  }

  /**
   * Highlights one list item and scrolls it into view.
   * @param {number} index Position in the list.
   */
  function highlight(index) {
    const all = items();
    if (!all.length) return;
    activeIndex = (index + all.length) % all.length;
    all.forEach((item, position) => item.classList.toggle('active', position === activeIndex));
    all[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  /** @returns {boolean} Whether the list is open; a list fading out already counts as closed. */
  function isOpen() {
    return trigger.getAttribute('aria-expanded') === 'true';
  }

  /** Closes the list, fading it out. */
  function close() {
    trigger.setAttribute('aria-expanded', 'false');
    if (list.hidden || closingAnimation) return;
    if (SELECT_REDUCED_MOTION.matches) {
      list.hidden = true;
      return;
    }
    const fadeOut = list.animate([SELECT_LIST_SHOWN_FRAME, SELECT_LIST_HIDDEN_FRAME], {
      duration: SELECT_LIST_ANIMATION_MS,
      easing: 'ease-in',
      fill: 'forwards',
    });
    closingAnimation = fadeOut;
    fadeOut.addEventListener('finish', () => {
      closingAnimation = null;
      list.hidden = true;
      fadeOut.cancel();
    });
  }

  /**
   * Fills the list with the options that contain the search text.
   * @param {string} query Search text; empty shows every option.
   */
  function renderOptions(query) {
    const needle = query.trim().toLowerCase();
    const choices = [...select.options].filter(
      (option) => !option.disabled && matchesSearch(option, needle),
    );
    const rows = choices.map((option) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.dataset.value = option.value;
      item.textContent = option.text;
      item.classList.toggle('selected', option.value === select.value);
      // mousedown, not click: the focused field would lose focus and close the list first.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        choose(option.value);
      });
      return item;
    });
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'suggestion-hint';
      empty.setAttribute('role', 'presentation');
      empty.textContent = 'Ничего не найдено';
      rows.push(empty);
    }
    // The search row stays in place: removing the focused input would close the list.
    list.querySelectorAll('li:not(.dropdown-search)').forEach((row) => row.remove());
    if (searchRow && !searchRow.isConnected) list.prepend(searchRow);
    list.append(...rows);
    // Searching starts from the first match; opening starts from the current option.
    highlight(needle ? 0 : choices.findIndex((option) => option.value === select.value));
  }

  /** Opens the list; a searchable one starts empty and takes the focus. */
  function open() {
    if (searchInput) searchInput.value = '';
    renderOptions('');
    // Opening while the list is still fading out: drop that fade and fade in from here.
    if (closingAnimation) {
      closingAnimation.cancel();
      closingAnimation = null;
    }
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (!SELECT_REDUCED_MOTION.matches) {
      list.animate([SELECT_LIST_HIDDEN_FRAME, SELECT_LIST_SHOWN_FRAME], {
        duration: SELECT_LIST_ANIMATION_MS,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
    }
    // Scrolling to the highlight needs the list on screen, so highlight again now.
    highlight(activeIndex);
    if (searchInput) searchInput.focus({ preventScroll: true });
  }

  /**
   * Selects a value the way a click on the native select would, so app.js reacts to it.
   * @param {string} value Option value.
   */
  function choose(value) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    // The search box that had the focus is hidden now.
    trigger.focus();
  }

  /**
   * Jumps to the first option starting with the typed letters.
   * @param {string} key One typed character.
   */
  function typeAhead(key) {
    typedText += key.toLowerCase();
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => (typedText = ''), SELECT_TYPEAHEAD_RESET_MS);
    if (!isOpen()) open();
    const options = [...select.options].filter((option) => !option.disabled);
    const found = options.findIndex((option) => plainOptionText(option).startsWith(typedText));
    if (found >= 0) highlight(found);
  }

  /**
   * Handles the keys of an open list.
   * @param {KeyboardEvent} event
   */
  function handleOpenKey(event) {
    const moves = {
      ArrowDown: () => highlight(activeIndex + 1),
      ArrowUp: () => highlight(activeIndex - 1),
    };
    if (moves[event.key]) {
      event.preventDefault();
      moves[event.key]();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      highlight(event.key === 'Home' ? 0 : items().length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeIndex >= 0) choose(items()[activeIndex].dataset.value);
    } else if (event.key === 'Escape') {
      // Closes only the list, not the whole dialog.
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close();
    } else if (event.key.length === 1) {
      typeAhead(event.key);
    }
  }

  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  label.id = label.id || select.id + '-label';
  trigger.setAttribute('aria-labelledby', label.id);
  list.className = 'dropdown-list select-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  if (searchRow) {
    searchRow.className = 'dropdown-search';
    searchRow.setAttribute('role', 'presentation');
    searchInput.type = 'search';
    searchInput.placeholder = select.dataset.search;
    searchInput.setAttribute('aria-label', select.dataset.search);
    searchInput.autocomplete = 'off';
    searchRow.append(searchInput);
    searchInput.addEventListener('input', () => renderOptions(searchInput.value));
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        highlight(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIndex >= 0 && items()[activeIndex]) choose(items()[activeIndex].dataset.value);
      } else if (event.key === 'Escape') {
        // Closes only the list, not the whole dialog.
        event.stopPropagation();
        close();
        trigger.focus();
      }
    });
  }
  select.classList.add('native-select');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.after(trigger);
  field.append(list);

  trigger.addEventListener('click', () => (isOpen() ? close() : open()));
  // Leaving the field, trigger and list together, closes the list; moving inside it does not.
  field.addEventListener('focusout', (event) => {
    if (!field.contains(event.relatedTarget)) close();
  });
  trigger.addEventListener('keydown', (event) => {
    if (isOpen()) {
      handleOpenKey(event);
    } else if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      typeAhead(event.key);
    }
  });
  // The browser focuses the hidden select when it reports a missing value or a label is clicked.
  select.addEventListener('focus', () => trigger.focus());

  // app.js sets select.value in code, which fires no event: refresh the button on every set.
  const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(select, 'value', {
    configurable: true,
    get() {
      return valueDescriptor.get.call(this);
    },
    set(newValue) {
      valueDescriptor.set.call(this, newValue);
      showCurrent();
    },
  });
  // Option texts change too, e.g. when prices arrive from the server.
  new MutationObserver(showCurrent).observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  showCurrent();
}

document.querySelectorAll('.field > select').forEach(enhanceSelect);
