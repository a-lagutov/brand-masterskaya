'use client';

import { useState } from 'react';

/** Login secrets exist only in this form until submitted over an authenticated JSON request. */
export function TelegramAccountConnect() {
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [codeRequested, setCodeRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  /** Sends one login step and clears credentials after their last required use. */
  async function act(action: 'code' | 'login' | 'disconnect') {
    setBusy(true);
    try {
      const response = await fetch(`/api/globals/telegram-account/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'code'
            ? { apiId, apiHash, phone }
            : action === 'login'
              ? { code, password }
              : {},
        ),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.errors?.[0]?.message || 'Ошибка подключения.');
      setMessage(result.message);
      setPasswordRequired(Boolean(result.passwordRequired));
      if (action === 'code') {
        setCodeRequested(true);
        setApiHash('');
      }
      if (result.connected || action === 'disconnect') {
        setCode('');
        setPassword('');
        setPhone('');
        setApiId('');
        setApiHash('');
        setCodeRequested(false);
        if (result.connected) window.location.reload();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ошибка подключения.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'grid', gap: '0.75rem', maxWidth: '36rem', marginBlock: '1rem' }}>
      <p>
        Данные приложения:{' '}
        <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">
          my.telegram.org/apps
        </a>
        . Телефон — аккаунта @brandmasterskaya.
      </p>
      <label>
        api_id{' '}
        <input
          autoComplete="off"
          inputMode="numeric"
          value={apiId}
          onChange={(event) => setApiId(event.target.value)}
        />
      </label>
      <label>
        api_hash{' '}
        <input
          type="password"
          autoComplete="off"
          value={apiHash}
          onChange={(event) => setApiHash(event.target.value)}
        />
      </label>
      <label>
        Телефон{' '}
        <input
          type="tel"
          autoComplete="off"
          placeholder="+79001234567"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>
      <button
        className="btn btn--style-secondary"
        type="button"
        disabled={busy || !apiId || !apiHash || !phone}
        onClick={() => void act('code')}
      >
        Получить код входа
      </button>
      {codeRequested && (
        <>
          <label>
            Код из Telegram{' '}
            <input
              autoComplete="off"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          {passwordRequired && (
            <label>
              Пароль двухэтапной аутентификации{' '}
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          <button
            className="btn btn--style-primary"
            type="button"
            disabled={busy || !code || (passwordRequired && !password)}
            onClick={() => void act('login')}
          >
            Подключить @brandmasterskaya
          </button>
        </>
      )}
      <button
        className="btn btn--style-secondary"
        type="button"
        disabled={busy}
        onClick={() => void act('disconnect')}
      >
        Отключить аккаунт и отозвать сессию
      </button>
      <p role="status">{busy ? 'Подключение…' : message}</p>
    </section>
  );
}
