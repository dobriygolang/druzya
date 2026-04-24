// App — orchestrator с auth-гейтом, deep-link listener'ом и pomodoro-
// persist'ом. Структура:
//   - bootstrap session из keychain (через preload IPC) на mount
//   - подписка на authChanged (deep-link OAuth callback) и deepLink
//     (focus/start, custom routes)
//   - pomodoro snapshot восстанавливается из main-process store, новые
//     значения пушатся в save с rate-limit'ом 1 раз/сек
//   - guest → LoginScreen, иначе обычные страницы
import { useCallback, useEffect, useRef, useState } from 'react';

import { CanvasBg, type CanvasMode } from './components/CanvasBg';
import { Wordmark, Versionmark } from './components/Chrome';
import { Dock } from './components/Dock';
import { LoginScreen } from './components/LoginScreen';
import { OnboardingModal } from './components/OnboardingModal';
import { Palette, type PageId } from './components/Palette';
import { Copilot } from './components/Copilot';
import { StandupModal } from './components/StandupModal';
import { HomePage } from './pages/Home';
import { TodayPage, type StartFocusArgs } from './pages/Today';
import { FocusPage } from './pages/Focus';
import { NotesPage } from './pages/Notes';
import { WhiteboardPage } from './pages/Whiteboard';
import { StatsPage } from './pages/Stats';
import { useSessionStore } from './stores/session';

const POMODORO_SECONDS = 25 * 60;
const ONBOARDING_KEY = 'hone:onboarded:v1';

export default function App() {
  const status = useSessionStore((s) => s.status);
  const bootstrap = useSessionStore((s) => s.bootstrap);
  const hydrate = useSessionStore((s) => s.hydrate);
  const clear = useSessionStore((s) => s.clear);

  const [page, setPage] = useState<PageId>('home');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [standupOpen, setStandupOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const [remain, setRemain] = useState(POMODORO_SECONDS);
  const [running, setRunning] = useState(false);
  const [vol, setVol] = useState(40);

  const [focusArgs, setFocusArgs] = useState<StartFocusArgs | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [focusBump, setFocusBump] = useState(0);

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

    // deepLink push: focus/start, etc.
    const offDeep = bridge.on('deepLink', ({ url }) => {
      try {
        const u = new URL(url);
        if (u.host === 'focus') {
          // druz9://focus?task=<id>&title=<urlenc>
          const planItemId = u.searchParams.get('task') ?? undefined;
          const pinnedTitle = u.searchParams.get('title') ?? undefined;
          openImpl('focus', { planItemId, pinnedTitle });
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
    const id = window.setInterval(() => setRemain((r) => Math.max(0, r - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

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

  useEffect(() => {
    if (page === 'focus' && remain === 0 && running) {
      setRunning(false);
      setStopRequested(true);
    }
  }, [page, remain, running]);

  const openImpl = useCallback((id: PageId | 'copilot', args?: StartFocusArgs) => {
    if (id === 'copilot') {
      setCopilotOpen(true);
      return;
    }
    if (id === 'focus') {
      setFocusArgs(args ?? null);
      setStopRequested(false);
      setFocusBump((b) => b + 1);
      setRemain(POMODORO_SECONDS);
      setRunning(true);
    }
    setPage(id);
  }, []);

  const open = openImpl;

  const goHome = () => {
    if (page === 'focus') {
      setRunning(false);
      setRemain(POMODORO_SECONDS);
      setStopRequested(false);
      setFocusArgs(null);
    }
    setPage('home');
  };

  const handleFocusEnd = useCallback(() => {
    setRunning(false);
    setRemain(POMODORO_SECONDS);
    setStopRequested(false);
    setFocusArgs(null);
    setPage('home');
  }, []);

  const handleStopTick = useCallback(() => {
    setRunning(false);
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
        if (standupOpen) {
          setStandupOpen(false);
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
        if (page !== 'home') {
          goHome();
          return;
        }
        return;
      }
      if (isText || paletteOpen || standupOpen || onboardingOpen) return;

      if (page === 'focus') {
        if (e.code === 'Space') {
          e.preventDefault();
          setRunning((r) => !r);
          return;
        }
        if (e.key.toLowerCase() === 's') {
          setStopRequested(true);
          return;
        }
      }

      const k = e.key.toLowerCase();
      if (k === 't') open('today');
      else if (k === 'f') open('focus');
      else if (k === 'n') open('notes');
      else if (k === 'd') open('board');
      else if (k === 's') open('stats');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, copilotOpen, standupOpen, onboardingOpen, page]);

  const focusMode = page === 'focus';
  const canvasMode: CanvasMode =
    page === 'home' || page === 'stats' ? 'full' : focusMode ? 'void' : 'quiet';

  // Pre-bootstrap: чёрный экран без UI шевеления (длится <100ms обычно).
  if (status === 'unknown') {
    return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />;
  }

  // Guest → login screen, ничего больше не рендерим (palette / dock тоже off).
  if (status === 'guest') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
        <CanvasBg mode="full" />
        <LoginScreen />
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      <CanvasBg mode={canvasMode} />

      {!focusMode && <Wordmark />}
      {!focusMode && <Versionmark escHint={page !== 'home'} onEsc={goHome} />}

      {page === 'home' && <HomePage />}
      {page === 'today' && <TodayPage onStartFocus={(args) => open('focus', args)} />}
      {page === 'focus' && (
        <FocusPage
          key={focusBump}
          remain={remain}
          pomodoroSeconds={POMODORO_SECONDS}
          planItemId={focusArgs?.planItemId}
          pinnedTitle={focusArgs?.pinnedTitle}
          onEnd={handleFocusEnd}
          onStopTick={handleStopTick}
          stopRequested={stopRequested}
        />
      )}
      {page === 'notes' && <NotesPage />}
      {page === 'board' && <WhiteboardPage />}
      {page === 'stats' && <StatsPage />}

      {!focusMode && (
        <Dock
          onMenu={() => setPaletteOpen(true)}
          running={running}
          onToggle={() => setRunning((r) => !r)}
          remain={remain}
          vol={vol}
          onVol={setVol}
        />
      )}

      {paletteOpen && (
        <Palette
          onClose={() => setPaletteOpen(false)}
          onOpen={(id) => {
            if (id === 'standup') {
              setStandupOpen(true);
              return;
            }
            open(id);
          }}
        />
      )}
      {copilotOpen && <Copilot onClose={() => setCopilotOpen(false)} />}
      {standupOpen && <StandupModal onClose={() => setStandupOpen(false)} />}
      {onboardingOpen && <OnboardingModal onClose={dismissOnboarding} />}
    </div>
  );
}
