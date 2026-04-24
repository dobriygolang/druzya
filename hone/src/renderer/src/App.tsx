// App — the orchestrator. Holds:
//   1. Which page is showing (home / today / focus / notes / board / stats).
//   2. Whether the ⌘K palette / Copilot / Standup overlay is open.
//   3. Pomodoro timer tick.
//   4. Focus session context (planItemId + pinnedTitle, passed to Focus on start).
//
// Routing is a single `page` state (no react-router) — Hone has no URL
// surface in v0; deep-links land via preload and flip `page` directly.
import { useCallback, useEffect, useState } from 'react';

import { CanvasBg, type CanvasMode } from './components/CanvasBg';
import { Wordmark, Versionmark } from './components/Chrome';
import { Dock } from './components/Dock';
import { Palette, type PageId } from './components/Palette';
import { Copilot } from './components/Copilot';
import { StandupModal } from './components/StandupModal';
import { HomePage } from './pages/Home';
import { TodayPage, type StartFocusArgs } from './pages/Today';
import { FocusPage } from './pages/Focus';
import { NotesPage } from './pages/Notes';
import { WhiteboardPage } from './pages/Whiteboard';
import { StatsPage } from './pages/Stats';

const POMODORO_SECONDS = 25 * 60;

export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [standupOpen, setStandupOpen] = useState(false);

  const [remain, setRemain] = useState(POMODORO_SECONDS);
  const [running, setRunning] = useState(false);
  const [vol, setVol] = useState(40);

  // Focus-session context — set when user хочет сфокусироваться на
  // конкретном PlanItem. null = free-form focus without backend plan link.
  const [focusArgs, setFocusArgs] = useState<StartFocusArgs | null>(null);
  // stopRequested — App сообщает FocusPage что пользователь нажал S
  // (или timer дошёл до нуля). FocusPage на этот сигнал поднимает
  // reflection-modal. onStopTick — FocusPage просит остановить тикать.
  const [stopRequested, setStopRequested] = useState(false);
  // bump — ключ для re-mount FocusPage между сессиями; иначе startedRef
  // внутри FocusPage не сбросится и вторая сессия подряд не создастся.
  const [focusBump, setFocusBump] = useState(0);

  // Pomodoro tick.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setRemain((r) => Math.max(0, r - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // Auto-stop when timer hits zero. Triggers reflection flow through
  // stopRequested — FocusPage решает, показывать modal или нет (если
  // сессия так и не создалась, она просто onEnd'ит).
  useEffect(() => {
    if (page === 'focus' && remain === 0 && running) {
      setRunning(false);
      setStopRequested(true);
    }
  }, [page, remain, running]);

  const open = (id: PageId | 'copilot', args?: StartFocusArgs) => {
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
  };

  const goHome = () => {
    if (page === 'focus') {
      setRunning(false);
      setRemain(POMODORO_SECONDS);
      setStopRequested(false);
      setFocusArgs(null);
    }
    setPage('home');
  };

  // onFocusEnd — FocusPage завершил сессию (успешно или после skip'а
  // reflection'а). Возвращаемся в home + сбрасываем таймер.
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

  // Global keyboard handler.
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
      if (isText || paletteOpen || standupOpen) return;

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
  }, [paletteOpen, copilotOpen, standupOpen, page]);

  const focusMode = page === 'focus';
  const canvasMode: CanvasMode =
    page === 'home' || page === 'stats' ? 'full' : focusMode ? 'void' : 'quiet';

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
    </div>
  );
}
