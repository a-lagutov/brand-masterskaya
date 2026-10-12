'use client';

import { usePathname } from 'next/navigation';

/** Payload's buttons that delete orders for good: in the trash list and a trashed order. */
const PERMANENT_DELETE_BUTTONS = [
  '.list-header__title-actions .btn',
  '.list-selection .delete-documents__toggle',
  '.doc-controls__controls .btn--style-secondary',
];

/** The "skip the trash" checkbox in the delete dialog of the orders list. */
const SKIP_TRASH_CHECKBOX = '.delete-documents__checkbox, .delete-document__checkbox';

/**
 * Hides the permanent delete buttons of orders: they can be moved to the trash and restored,
 * never deleted (the Orders collection refuses it on the server too).
 */
export function HideTrashDelete() {
  const pathname = usePathname();
  const inTrash = pathname.includes('/collections/orders/trash');
  const hidden = inTrash
    ? [...PERMANENT_DELETE_BUTTONS, SKIP_TRASH_CHECKBOX]
    : [SKIP_TRASH_CHECKBOX];
  return <style>{`${hidden.join(', ')} { display: none !important; }`}</style>;
}
