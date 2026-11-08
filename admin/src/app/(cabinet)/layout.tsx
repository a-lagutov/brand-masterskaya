import type { ReactNode } from 'react';
import 'shaka-player/dist/controls.css';
import './cabinet.css';

export const metadata = {
  title: 'Личный кабинет — Мастерская бренд-стратегии',
  robots: { index: false, follow: false },
};

/** Isolates the student site's document and styles from Payload's admin layout. */
export default function CabinetLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
