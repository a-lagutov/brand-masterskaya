'use client';

import { useEffect, useRef, useState } from 'react';

// Shaka's public distribution includes its own TypeScript declarations.
import type shakaType from 'shaka-player';

type LectureItem = { id: number; title: string; speaker: string; description: string };
type PlaybackGrant = { token: string; manifest: string; license: string };

/** Plays encrypted DASH with renewable grants, live revocation checks and a visible viewer label. */
function LecturePlayer({ lecture, telegramId }: { lecture: LectureItem; telegramId: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    let player: shakaType.Player | undefined;
    let renewal: ReturnType<typeof setInterval> | undefined;
    let grant: PlaybackGrant;
    let refreshing: Promise<void> | null = null;
    let grantRefreshAt = 0;
    const controller = new AbortController();
    /** Fetches one grant at a time and fails closed when a group or publication is revoked. */
    async function refreshGrant() {
      if (!refreshing)
        refreshing = (async () => {
          const response = await fetch(`/cabinet/api/lectures/${lecture.id}/playback`, {
            method: 'POST',
            signal: controller.signal,
            cache: 'no-store',
          });
          if (!response.ok)
            throw new Error(
              response.status === 401
                ? 'Войдите через Telegram заново.'
                : 'Доступ к лекции закрыт. Обратитесь к организаторам.',
            );
          grant = await response.json();
          grantRefreshAt = Date.now() + 240_000;
        })().finally(() => {
          refreshing = null;
        });
      return refreshing;
    }
    /** Destroys playback immediately after a failed renewal instead of leaving cached playback active. */
    async function fail(message: string) {
      if (cancelled || failed) return;
      failed = true;
      if (renewal) clearInterval(renewal);
      setError(message);
      setLoading(false);
      video.current?.pause();
      await player?.unload();
    }
    /** Loads the player only in the browser; no unencrypted fallback is offered. */
    async function start() {
      try {
        const { default: shaka } = await import('shaka-player');
        shaka.polyfill.installAll();
        if (!shaka.Player.isBrowserSupported())
          throw new Error(
            'Браузер не поддерживает защищённое видео. Откройте кабинет в актуальном Chrome или Firefox.',
          );
        await refreshGrant();
        if (cancelled || !video.current) return;
        player = new shaka.Player();
        await player.attach(video.current);
        if (cancelled) return;
        player.configure({
          drm: {
            servers: { 'org.w3.clearkey': new URL(grant.license, window.location.origin).href },
          },
        });
        player.getNetworkingEngine()!.registerRequestFilter(async (_type, request) => {
          if (Date.now() >= grantRefreshAt) await refreshGrant();
          // Never send a playback credential to external URLs, including redirects in manifests.
          const expectedMedia = `/cabinet/media/${lecture.id}/`;
          for (const uri of request.uris) {
            const target = new URL(uri, window.location.href);
            if (
              target.origin !== window.location.origin ||
              !(target.pathname.startsWith(expectedMedia) || target.pathname === grant.license)
            )
              throw new Error('Unexpected media URL');
          }
          request.headers['x-playback-token'] = grant.token;
        });
        player.addEventListener('error', () => {
          void fail(
            'Не удалось воспроизвести видео. Проверьте соединение и откройте лекцию заново.',
          );
        });
        await player.load(grant.manifest);
        if (cancelled) return;
        setLoading(false);
        renewal = setInterval(() => {
          void refreshGrant().catch((failure) => fail(failure.message));
        }, 240_000);
      } catch (failure) {
        if (!cancelled)
          await fail(failure instanceof Error ? failure.message : 'Не удалось открыть видео.');
      }
    }
    void start();
    return () => {
      cancelled = true;
      controller.abort();
      if (renewal) clearInterval(renewal);
      void player?.destroy();
    };
  }, [lecture.id]);

  return (
    <section className="cabinet__viewer" aria-label={`Просмотр: ${lecture.title}`}>
      <div className="cabinet__screen">
        <video
          ref={video}
          controls
          playsInline
          controlsList="nodownload"
          aria-label={lecture.title}
        />
        {!error && (
          <span className="cabinet__watermark" aria-hidden="true">
            Для участника {telegramId}
          </span>
        )}
        {loading && (
          <p className="cabinet__player-message" role="status">
            Открываем запись…
          </p>
        )}
      </div>
      {error && (
        <p className="cabinet__error" role="alert">
          {error}
        </p>
      )}
      <div className="cabinet__lecture-copy">
        <p className="cabinet__speaker">{lecture.speaker}</p>
        <h2>{lecture.title}</h2>
        <p>{lecture.description}</p>
      </div>
    </section>
  );
}

/** Presents recordings using the landing page's paper palette, Helvetica and red graphic circle. */
export function Cabinet({
  member,
  lectures,
  loginConfigured,
}: {
  member: { name: string; telegramId: string } | null;
  lectures: LectureItem[];
  loginConfigured: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const selected = lectures.find((lecture) => lecture.id === selectedId);
  const visible = lectures.filter((lecture) =>
    `${lecture.title} ${lecture.speaker}`
      .toLocaleLowerCase('ru')
      .includes(search.toLocaleLowerCase('ru')),
  );
  return (
    <main className="cabinet">
      <header className="cabinet__header">
        <a className="cabinet__brand" href="https://brandmasterskaya.ru">
          Мастерская
          <br />
          бренд-стратегии
          <span className="cabinet__brand-dot" />
        </a>
        <nav aria-label="Личный кабинет">
          {member ? (
            <>
              <span>{member.name}</span>
              <form action="/cabinet/auth/logout" method="post">
                <button className="cabinet__text-button">Выйти</button>
              </form>
            </>
          ) : (
            <span>Личный кабинет</span>
          )}
        </nav>
      </header>
      {!member ? (
        <section className="cabinet__welcome">
          <div>
            <p className="cabinet__caption">Продолжаем работать с брендом</p>
            <h1>
              Мастерская
              <br />в записи
            </h1>
            <p className="cabinet__intro">
              Лекции вашей программы — в одном месте.
              <br />
              Войдите через Telegram, чтобы продолжить обучение.
            </p>
            {loginConfigured ? (
              <a className="cabinet__button" href="/cabinet/auth/start">
                Войти через Telegram <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <p className="cabinet__notice">
                Кабинет готовится к открытию. Организаторы сообщат, когда можно будет войти.
              </p>
            )}
          </div>
          <div className="cabinet__art" aria-hidden="true">
            <span>
              Бренд начинается
              <br />с ясной мысли.
            </span>
            <div className="cabinet__disc" />
            <p>Смотреть. Думать. Применять.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="cabinet__heading">
            <div>
              <p className="cabinet__caption">Ваше пространство обучения</p>
              <h1>Мои лекции</h1>
            </div>
            <p>
              Возвращайтесь к важному.
              <br />
              Смотрите в своём темпе.
            </p>
          </section>
          {selected && (
            <>
              <button
                className="cabinet__text-button cabinet__back"
                onClick={() => setSelectedId(null)}
              >
                Закрыть запись
              </button>
              <LecturePlayer key={selected.id} lecture={selected} telegramId={member.telegramId} />
            </>
          )}
          <section className="cabinet__library" aria-label="Доступные записи">
            <div className="cabinet__library-header">
              <h2>
                Записи программы <span>{lectures.length}</span>
              </h2>
              {lectures.length > 0 && (
                <label className="cabinet__search">
                  Найти лекцию
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Название или преподаватель"
                  />
                </label>
              )}
            </div>
            {!lectures.length ? (
              <div className="cabinet__empty">
                <h3>Здесь появятся ваши лекции</h3>
                <p>
                  Записи станут доступны после публикации и добавления вас в учебную группу.
                  <br />
                  Если доступ уже должен быть открыт, напишите организаторам в боте.
                </p>
              </div>
            ) : !visible.length ? (
              <p className="cabinet__empty" role="status">
                Лекции не найдены. Попробуйте другое название.
              </p>
            ) : (
              <div className="cabinet__list">
                {visible.map((lecture) => (
                  <button
                    key={lecture.id}
                    className={`cabinet__lesson${selectedId === lecture.id ? ' cabinet__lesson--active' : ''}`}
                    onClick={() => setSelectedId(lecture.id)}
                    aria-pressed={selectedId === lecture.id}
                  >
                    <span className="cabinet__play" aria-hidden="true">
                      ▶
                    </span>
                    <span>
                      <span className="cabinet__speaker">
                        {lecture.speaker || 'Мастерская бренд-стратегии'}
                      </span>
                      <strong>{lecture.title}</strong>
                      <span className="cabinet__description">{lecture.description}</span>
                    </span>
                    <span className="cabinet__watch">Смотреть</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
      <footer className="cabinet__footer">
        <span>
          Мастерская Антона Аверьянова
          <br />и Михаила Чернышева
        </span>
        <span>Знания становятся опытом.</span>
        <a href="https://brandmasterskaya.ru/privacy.html">Конфиденциальность</a>
      </footer>
    </main>
  );
}
