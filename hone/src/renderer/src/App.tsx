// App — orchestrator с auth-гейтом, deep-link listener'ом и pomodoro-
// persist'ом. Структура:
//   - bootstrap session из keychain (через preload IPC) на mount
//   - подписка на authChanged (deep-link OAuth callback) и deepLink
//     (focus/start, custom routes)
//   - pomodoro snapshot восстанавливается из main-process store, новые
//     значения пушатся в save с rate-limit'ом 1 раз/сек
//   - guest → LoginScreen, иначе обычные страницы
//
// Focus refactor (apr 2026, bible §3): standalone FocusPage снят;
// pomodoro-таймер теперь живёт в Dock (тихо) + HomePage (subtle pinned-
// task + post-finish reflection). Backend StartFocusSession /
// EndFocusSession теперь оркестрируется отсюда, не из удалённой страницы,
// чтобы streak-механика продолжала наполняться (bible §6 sync).
import { useCallback, useEffect, useRef, useState } from 'react';

import { CanvasBg, type CanvasMode, type ThemeId } from './components/CanvasBg';
import { Wordmark, Versionmark } from './components/Chrome';
import { TrafficLightsHover } from './components/TrafficLightsHover';
import { Dock } from './components/Dock';
import { LoginScreen } from './components/LoginScreen';
import { OnboardingModal } from './components/OnboardingModal';
import { Palette, type PageId, type PaletteAction } from './components/Palette';
import { Copilot } from './components/Copilot';
import { DailyBriefPanel } from './components/DailyBriefPanel';
// StandupOverlay удалён — standup переехал в morning banner на Today page
// (см. components/TodayStandupBanner.tsx).
import { UpdateToast } from './components/UpdateToast';
import { HomePage } from './pages/Home';
import { TodayPage, type StartFocusArgs } from './pages/Today';
import { NotesPage } from './pages/Notes';
import { VaultUnlockGate } from './components/VaultUnlockGate';
import { UpgradePrompt } from './components/UpgradePrompt';
import { useQuotaStore } from './stores/quota';
import { StatsOverlay } from './components/StatsOverlay';
import { PodcastsPage } from './pages/Podcasts';
import { SharedBoardsPage } from './pages/SharedBoards';
import { EditorPage } from './pages/Editor';
import { BoardsTabsChrome } from './components/BoardsTabsChrome';
import { EventsPage } from './pages/Events';
import { SettingsPage, readStoredTheme } from './pages/Settings';
import { useSessionStore } from './stores/session';
import { startFocusSession, endFocusSession } from './api/hone';
import { notify } from './api/notifications';

const POMODORO_SECONDS = 25 * 60;
const ONBOARDING_KEY = 'hone:onboarded:v2';

// ReflectionPrompt — что показывает Home после завершения сессии. Не
// модалка-блокер (как было в FocusPage), просто inline-инпут в углу.
interface ReflectionPrompt {
  sessionId: string;
  secondsFocused: number;
  pomodorosCompleted: number;
}

export default function App() {
  const status = useSessionStore((s) => s.status);
  const bootstrap = useSessionStore((s) => s.bootstrap);
  const hydrate = useSessionStore((s) => s.hydrate);
  const clear = useSessionStore((s) => s.clear);

  const [page, setPage] = useState<PageId>('home');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  // Theme — initial значение читаем из localStorage. Settings page пишет
  // в тот же ключ + дёргает onThemeChange (нам), так что CanvasBg
  // обновляется без full-reload.
  const [theme, setTheme] = useState<ThemeId>(() => readStoredTheme());

  const [remain, setRemain] = useState(POMODORO_SECONDS);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'countdown' | 'stopwatch'>('countdown');
  const [vol, setVol] = useState(40);

  const [pinnedTitle, setPinnedTitle] = useState<string | null>(null);
  const [pinnedPlanItemId, setPinnedPlanItemId] = useState<string | null>(null);
  // initialRoomId: при переходе из Events на event со ссылкой на комнату
  // App ставит сюда room-id; целевая страница (editor / shared_boards)
  // подхватывает это на mount и сразу открывает комнату вместо list.
  // Single-shot — после consume сбрасываем в null.
  const [initialEditorRoom, setInitialEditorRoom] = useState<string | null>(null);
  const [initialBoardRoom, setInitialBoardRoom] = useState<string | null>(null);
  // Brief-driven navigation hooks: when DailyBriefPanel'е жмут review_note
  // или unblock chip, кладём target_id сюда; целевая страница подхватывает
  // на mount и сбрасывает back to null. Single-shot semantics.
  const [briefTargetNoteId, setBriefTargetNoteId] = useState<string | null>(null);
  const [briefTargetPlanItemId, setBriefTargetPlanItemId] = useState<string | null>(null);
  // Sentinel для backend session — null значит "не идёт". Создаётся при
  // первом переходе в running, гасится в finishSession.
  const sessionRef = useRef<string | null>(null);
  const [reflectionPrompt, setReflectionPrompt] = useState<ReflectionPrompt | null>(null);

  // ── Bootstrap: session + pomodoro snapshot + IPC subscribers ────────────
  useEffect(() => {
    void bootstrap();
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge) return;

    // pomodoro snapshot restore.
    void bridge.pomodoro.load().then((snap) => {
      if (!snap) return;
      const elapsedMs = Date.now() - snap.savedAt;
      // Если timer был запущен дольше чем remainSec — он дотикал во сне.
      if (snap.running && elapsedMs >= snap.remainSec * 1000) {
        setRemain(0);
        setRunning(false);
        return;
      }
      const adjusted = snap.running
        ? Math.max(0, snap.remainSec - Math.floor(elapsedMs / 1000))
        : snap.remainSec;
      setRemain(adjusted);
      setRunning(false); // restore без авто-старта; юзер ткнёт пробел
    });

    // authChanged push: deep-link OAuth callback.
    const offAuth = bridge.on('authChanged', (session) => {
      if (session) {
        hydrate({
          userId: session.userId,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAt: session.expiresAt,
        });
      } else {
        void clear();
      }
    });

    // deepLink push: druz9://focus?task=...&title=... — ставит pinned-task
    // и стартует таймер сразу (поведение совместимое со старым FocusPage).
    const offDeep = bridge.on('deepLink', ({ url }) => {
      try {
        const u = new URL(url);
        if (u.host === 'focus') {
          const planItemId = u.searchParams.get('task') ?? undefined;
          const pinned = u.searchParams.get('title') ?? undefined;
          startFocus({ planItemId, pinnedTitle: pinned });
        }
      } catch {
        /* ignore malformed */
      }
    });

    return () => {
      offAuth();
      offDeep();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Onboarding: первый запуск показывает modal с шорткатами ─────────────
  useEffect(() => {
    if (status !== 'signed_in') return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(ONBOARDING_KEY)) return;
    setOnboardingOpen(true);
  }, [status]);

  // ── Device bootstrap (Phase C-3.1) ──────────────────────────────────────
  // Регистрируем устройство при первом успешном логине. Errors глотаем —
  // sync feature просто не активируется до следующего запуска. Free-tier
  // 1-device limit (DeviceLimitError) НЕ блокирует app, юзер увидит
  // «Replace device» в Settings → Devices.
  useEffect(() => {
    if (status !== 'signed_in') return;
    void import('./api/device').then(({ ensureDevice }) => {
      void ensureDevice({ appVersion: '0.0.1' }).catch(() => {
        /* limit / network — silent; повторим на следующем запуске */
      });
    });
  }, [status]);

  // ── Vault auto-lock (Phase C-7) ─────────────────────────────────────────
  // На logout (status flip away from signed_in) wipe in-memory vault key.
  // Без этого encrypted notes остались бы readable до tab close.
  useEffect(() => {
    if (status === 'signed_in') return;
    void import('./api/vault').then(({ lockVault }) => lockVault());
  }, [status]);

  // ── Sync replication (Phase C-4) ────────────────────────────────────────
  // На login: full bootstrap pull → IndexedDB cache. После — polling каждые
  // 30s + immediate pull on window focus / online events. Errors silent
  // (sync — best-effort, не должен ломать app). При 401 device_revoked
  // sync.ts internally trigger'ит session.clear() — see api/sync.ts.
  const userId = useSessionStore((s) => s.userId);
  useEffect(() => {
    if (status !== 'signed_in' || !userId) return;
    let stopped = false;
    let timer: number | null = null;

    const runPull = async () => {
      if (stopped) return;
      try {
        const { pullUntilCaughtUp, getStoredCursor, setStoredCursor } = await import('./api/sync');
        const { applyPullResponse } = await import('./api/localCache');
        const resp = await pullUntilCaughtUp(getStoredCursor());
        await applyPullResponse(userId, resp);
        setStoredCursor(resp.cursor);
      } catch {
        /* silent retry on next tick */
      }
    };

    void runPull(); // initial
    timer = window.setInterval(() => void runPull(), 30_000);

    const onFocus = () => void runPull();
    const onOnline = () => void runPull();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    // Phase C-6.2 — SSE push channel. На каждое событие от server'а
    // триггерим immediate pull (мгновенный sync вместо 30s lag).
    // EventSource auto-reconnects на disconnect.
    let sseClose: (() => void) | null = null;
    void import('./api/syncEvents').then(({ openSyncEventStream }) => {
      if (stopped) return;
      const stream = openSyncEventStream({
        onEvent: (ev) => {
          void runPull();
          // Bridge для page-level компонентов (Notes, Whiteboards) —
          // даём знать что данные изменились извне, чтобы они могли
          // re-fetch свои listings без отдельного polling. Дешевле
          // чем zustand-store reactivity для одного use-case'а.
          window.dispatchEvent(
            new CustomEvent('hone:sync-changed', { detail: ev }),
          );
        },
      });
      sseClose = stream.close;
    });

    return () => {
      stopped = true;
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      if (sseClose) sseClose();
    };
  }, [status, userId]);

  const dismissOnboarding = () => {
    setOnboardingOpen(false);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  // ── Pomodoro tick + persist ─────────────────────────────────────────────
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(
      () => setRemain((r) => (mode === 'countdown' ? Math.max(0, r - 1) : r + 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [running, mode]);

  // Сохраняем snapshot при значимых изменениях, не на каждом тике —
  // достаточно при start/stop и при изменении remain раз в 5 секунд.
  const lastSavedRef = useRef(0);
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge) return;
    const now = Date.now();
    if (now - lastSavedRef.current < 5000 && remain > 0) return;
    lastSavedRef.current = now;
    void bridge.pomodoro.save({ remainSec: remain, running, savedAt: now });
  }, [remain, running]);

  // ── Focus session backend integration ─────────────────────────────────
  // Start session при первом переходе running false→true. Errors глотаем —
  // streak-наполнение «best-effort», не должно ломать таймер.
  useEffect(() => {
    if (!running || sessionRef.current) return;
    const planItemId = pinnedPlanItemId ?? undefined;
    const pinned = pinnedTitle ?? undefined;
    startFocusSession({ planItemId, pinnedTitle: pinned, mode: 'pomodoro' })
      .then((s) => {
        sessionRef.current = s.id;
      })
      .catch(() => {
        /* silent — Dock-таймер не должен показывать ошибку */
      });
  }, [running, pinnedPlanItemId, pinnedTitle]);

  const finishSession = useCallback(
    async (reflection: string = '') => {
      const id = sessionRef.current;
      if (!id) return;
      const secondsFocused = Math.max(0, POMODORO_SECONDS - remain);
      const pomodorosCompleted = remain === 0 ? 1 : 0;
      sessionRef.current = null;
      try {
        await endFocusSession({
          sessionId: id,
          pomodorosCompleted,
          secondsFocused,
          reflection: reflection.trim(),
        });
      } catch {
        /* silent — сессия уже была живой, бэкенд авто-закроет по timeout */
      }
    },
    [remain],
  );

  // Auto-end когда countdown-таймер дотикивает до 0. Stopwatch (∞)
  // автоматически НЕ финиширует — юзер сам Stop / Reset.
  useEffect(() => {
    if (mode !== 'countdown') return;
    if (running && remain === 0) {
      setRunning(false);
      const id = sessionRef.current;
      const seconds = POMODORO_SECONDS;
      void finishSession();
      // OS-native notification — юзер мог уйти от экрана, нужна звуковая
      // подсказка что pomodoro закончилось. notify() сам проверяет
      // settings.notifications + permission, no-op'ит если отключено.
      void notify('Focus session complete', 'Pomodoro finished — take a break.');
      if (id) {
        setReflectionPrompt({
          sessionId: id,
          secondsFocused: seconds,
          pomodorosCompleted: 1,
        });
      }
      setRemain(POMODORO_SECONDS);
    }
  }, [remain, running, mode, finishSession]);

  const initialFor = useCallback(
    (m: 'countdown' | 'stopwatch') => (m === 'countdown' ? POMODORO_SECONDS : 0),
    [],
  );

  const resetTimer = useCallback(() => {
    void finishSession();
    setRunning(false);
    setRemain(initialFor(mode));
  }, [finishSession, initialFor, mode]);

  const toggleMode = useCallback(() => {
    void finishSession();
    setRunning(false);
    setMode((m) => {
      const next = m === 'countdown' ? 'stopwatch' : 'countdown';
      setRemain(initialFor(next));
      return next;
    });
  }, [finishSession, initialFor]);

  const startFocus = useCallback((args?: StartFocusArgs) => {
    setPinnedPlanItemId(args?.planItemId ?? null);
    setPinnedTitle(args?.pinnedTitle ?? null);
    setReflectionPrompt(null);
    setRemain(POMODORO_SECONDS);
    setRunning(true);
    setPage('home');
  }, []);

  const stopFocus = useCallback(() => {
    if (!running && !sessionRef.current) return;
    setRunning(false);
    void finishSession();
    setRemain(POMODORO_SECONDS);
  }, [running, finishSession]);

  const openImpl = useCallback(
    (id: PaletteAction, args?: StartFocusArgs) => {
      if (id === 'copilot') {
        setCopilotOpen(true);
        return;
      }
      if (id === 'stats') {
        // Stats overlay поверх Home.
        setPage('home');
        setStatsOpen(true);
        return;
      }
      if (id === 'standup') {
        // Standup переехал из overlay в morning banner на Today page
        // (см. TodayStandupBanner.tsx). Палитра теперь просто открывает
        // Today — banner сам решит показываться или нет (после morning
        // window или если уже записан → не появится).
        setPage('today');
        setStatsOpen(false);
        return;
      }
      if (args) {
        // Today/Plan нажал «Start focus» — ставим pinned-task и переходим
        // на Home с запущенным таймером.
        startFocus(args);
        return;
      }
      setStatsOpen(false);
      setPage(id);
    },
    [startFocus],
  );

  const open = openImpl;

  const goHome = () => setPage('home');

  // Custom event для sidebar back-arrow в SharedBoards / Editor.
  // window.history.back() в Electron renderer не работает — нет router.
  useEffect(() => {
    const onNavHome = () => setPage('home');
    window.addEventListener('hone:nav-home', onNavHome);
    return () => window.removeEventListener('hone:nav-home', onNavHome);
  }, []);

  // ── Global keyboard ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isText =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          (target as HTMLElement).isContentEditable);

      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      if (isMod && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        setCopilotOpen((c) => !c);
        return;
      }

      if (e.key === 'Escape') {
        if (onboardingOpen) {
          dismissOnboarding();
          return;
        }
        if (copilotOpen) {
          setCopilotOpen(false);
          return;
        }
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        if (statsOpen) {
          setStatsOpen(false);
          return;
        }
        if (page !== 'home') {
          goHome();
          return;
        }
        return;
      }
      // Hotkey-nav должна работать через overlays — openImpl сам
      // закроет stats overlay при переключении.
      if (isText || paletteOpen || onboardingOpen) return;

      const k = e.key.toLowerCase();
      if (k === 't') open('today');
      else if (k === 'n') open('notes');
      else if (k === 'd') open('shared_boards'); // 'board' page удалена; D ведёт на shared_boards
      else if (k === 's') open('stats');
      else if (k === 'p') open('podcasts');
      else if (k === 'e') open('editor');
      else if (k === 'b') open('shared_boards');
      else if (k === 'v') open('events');
      else if (k === ',') open('settings');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, copilotOpen, onboardingOpen, page]);

  const canvasMode: CanvasMode = page === 'home' || page === 'stats' ? 'full' : 'quiet';

  // Quota refresh после auth-bootstrap'а. Subscription-сервис может быть
  // не loaded на бэке — store корректно дегейзит на defaults без ошибки.
  useEffect(() => {
    if (status !== 'signed_in') return;
    void useQuotaStore.getState().refresh();
    // Refresh раз в час чтобы поймать tier-update'ы (admin set / Boosty
    // sync). Cheap (1 GET, JSON).
    const id = window.setInterval(() => {
      void useQuotaStore.getState().refresh();
    }, 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // Pre-bootstrap: чёрный экран без UI шевеления (длится <100ms обычно).
  if (status === 'unknown') {
    return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />;
  }

  // Guest → login screen, ничего больше не рендерим (palette / dock тоже off).
  if (status === 'guest') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
        <CanvasBg mode="full" theme={theme} />
        <LoginScreen />
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      <CanvasBg mode={canvasMode} theme={theme} />

      {/* Window-drag strip: невидимая полоса вдоль верха окна (32 px),
          через которую macOS позволяет таскать окно. TrafficLightsHover и
          Versionmark лежат поверх и помечены no-drag, чтобы клики туда
          работали штатно. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 32,
          zIndex: 1,
          // @ts-expect-error — нестандартное Electron-CSS-property
          WebkitAppRegion: 'drag',
        }}
      />
      <TrafficLightsHover />
      <Wordmark />
      <Versionmark escHint={page !== 'home'} onEsc={goHome} />

      {/* Daily Brief panel — bottom-left on Home, hidden during running focus.
          AI-coach слой: показывается даже когда focus ≠ active, но не отвлекает
          юзера во время сессии. */}
      {page === 'home' && !running && (
        <DailyBriefPanel
          onAct={(rec) => {
            if (rec.kind === 'tiny_task') {
              startFocus({ pinnedTitle: rec.title });
              return;
            }
            if (rec.kind === 'review_note' && rec.targetId) {
              setBriefTargetNoteId(rec.targetId);
              setPage('notes');
              return;
            }
            if (rec.kind === 'unblock' && rec.targetId) {
              setBriefTargetPlanItemId(rec.targetId);
              setPage('today');
              return;
            }
            // schedule — tooltip-only (advice). Title ↻ rationale shown via title attr.
          }}
        />
      )}
      {page === 'home' && (
        <HomePage
          running={running}
          remain={remain}
          pinnedTitle={pinnedTitle}
          reflectionPrompt={reflectionPrompt}
          onStop={stopFocus}
          onSubmitReflection={async (text) => {
            const id = reflectionPrompt?.sessionId;
            if (!id) return;
            // Reflection приходит ПОСЛЕ finishSession (backend уже закрыл
            // сессию автоматически по auto-end). Re-call endFocusSession
            // не имеет смысла — она idempotent на session_id, но
            // EndFocusSession в hone-bible ждёт активную сессию.
            // Вместо повторного end делаем noop: reflection просто
            // dismiss'ится и в Today bible предложит юзеру записать.
            // Фактическое сохранение reflection — отдельная RPC future
            // task; для MVP просто прячем prompt.
            void text;
            setReflectionPrompt(null);
          }}
          onDismissReflection={() => setReflectionPrompt(null)}
        />
      )}
      {page === 'today' && (
        <TodayPage
          onStartFocus={startFocus}
          highlightedItemId={briefTargetPlanItemId}
          onConsumeHighlight={() => setBriefTargetPlanItemId(null)}
        />
      )}
      {page === 'notes' && (
        <VaultUnlockGate>
          <NotesPage
            initialSelectedId={briefTargetNoteId}
            onConsumeInitial={() => setBriefTargetNoteId(null)}
          />
        </VaultUnlockGate>
      )}
      {/* page === 'board' removed — единый поток через shared_boards.
          Private/public — это лишь вопрос с кем поделили URL комнаты. */}
      {/* Stats теперь overlay (см. statsOpen ниже). Старая StatsPage снята. */}
      {page === 'podcasts' && <PodcastsPage />}
      {/* Boards / Code rooms — два отдельных page'а. Tabs вынесены в
          top chrome (BoardsTabsChrome ниже), сами страницы рендерятся
          напрямую без BoardsHub-обёртки. Caller сам решает что
          показывать; tabs перебрасывают через setPage. */}
      {page === 'shared_boards' && (
        <SharedBoardsPage
          initialRoomId={initialBoardRoom}
          onConsumeInitial={() => setInitialBoardRoom(null)}
        />
      )}
      {page === 'editor' && (
        <EditorPage
          initialRoomId={initialEditorRoom}
          onConsumeInitial={() => setInitialEditorRoom(null)}
        />
      )}
      {(page === 'shared_boards' || page === 'editor') && (
        <BoardsTabsChrome
          current={page}
          onChange={(t) => openImpl(t)}
        />
      )}
      {statsOpen && page === 'home' && <StatsOverlay onClose={() => setStatsOpen(false)} />}
      {page === 'settings' && (
        <SettingsPage theme={theme} onThemeChange={setTheme} />
      )}
      {page === 'events' && (
        <EventsPage
          onJumpToEditor={(roomId) => {
            setInitialEditorRoom(roomId);
            setPage('editor');
          }}
          onJumpToBoard={(roomId) => {
            setInitialBoardRoom(roomId);
            setPage('shared_boards');
          }}
        />
      )}

      <Dock
        onMenu={() => setPaletteOpen(true)}
        running={running}
        onToggle={() => {
          if (running) {
            // Pause: таймер остановили, session ещё активна (финиш только
            // на auto-end / Reset / явный stopFocus с Home).
            setRunning(false);
          } else {
            setRunning(true);
          }
        }}
        remain={remain}
        mode={mode}
        onToggleMode={toggleMode}
        onReset={resetTimer}
        vol={vol}
        onVol={setVol}
      />

      {paletteOpen && (
        <Palette onClose={() => setPaletteOpen(false)} onOpen={(id) => open(id)} />
      )}
      {copilotOpen && <Copilot onClose={() => setCopilotOpen(false)} />}
      {onboardingOpen && <OnboardingModal onClose={dismissOnboarding} />}
      <UpdateToast />
      <UpgradePrompt />
    </div>
  );
}
