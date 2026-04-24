// App — the orchestrator. Holds three pieces of state:
//   1. Which page is showing (home / today / focus / notes / board / stats).
//   2. Whether the ⌘K palette or the Copilot overlay is open.
//   3. The pomodoro tick: remaining seconds + running flag + volume slider.
//
// Everything page-side is a pure view on those values. Routing is intentionally
// a single `page` state (no react-router) because Hone has zero URL surface
// in v0 — deep-links land via the preload bridge and flip `page` directly.
import { useEffect, useState } from 'react';

import { CanvasBg, type CanvasMode } from './components/CanvasBg';
import { Wordmark, Versionmark } from './components/Chrome';
import { Dock } from './components/Dock';
import { Palette, type PageId } from './components/Palette';
import { Copilot } from './components/Copilot';
import { HomePage } from './pages/Home';
import { TodayPage } from './pages/Today';
import { FocusPage } from './pages/Focus';
import { NotesPage } from './pages/Notes';
import { WhiteboardPage } from './pages/Whiteboard';
import { StatsPage } from './pages/Stats';

const POMODORO_SECONDS = 25 * 60;

export default function App() {
  const [page, setPage] = useState<PageId>('home');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  const [remain, setRemain] = useState(POMODORO_SECONDS);
  const [running, setRunning] = useState(false);
  const [vol, setVol] = useState(40);

  // Pomodoro tick. The interval is gated on `running` — when the timer
  // is paused we don't register a callback at all. We clamp at zero so
  // the ticker never goes negative if a long browser-throttle hits.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setRemain((r) => Math.max(0, r - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const open = (id: PageId | 'copilot') => {
    if (id === 'copilot') {
      setCopilotOpen(true);
      return;
    }
    if (id === 'focus') setRunning(true);
    setPage(id);
  };

  const goHome = () => {
    if (page === 'focus') {
      setRunning(false);
      setRemain(POMODORO_SECONDS);
    }
    setPage('home');
  };

  // Global keyboard handler. Three groups:
  //   - ⌘K / ⌘⇧Space — always available, toggle palette / copilot.
  //   - Esc — context-aware: closes overlays first, then leaves sub-page.
  //   - Single-letter shortcuts (t/f/n/d/s) — only when no overlay is
  //     open and the user isn't typing into a field. Focus page gets
  //     its own overrides (space pause, S stop).
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
      if (isText || paletteOpen) return;

      if (page === 'focus') {
        if (e.code === 'Space') {
          e.preventDefault();
          setRunning((r) => !r);
          return;
        }
        if (e.key.toLowerCase() === 's') {
          setRunning(false);
          setRemain(POMODORO_SECONDS);
          setPage('home');
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
  }, [paletteOpen, copilotOpen, page]);

  const focusMode = page === 'focus';
  const canvasMode: CanvasMode =
    page === 'home' || page === 'stats' ? 'full' : focusMode ? 'void' : 'quiet';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      <CanvasBg mode={canvasMode} />

      {!focusMode && <Wordmark />}
      {!focusMode && <Versionmark escHint={page !== 'home'} onEsc={goHome} />}

      {page === 'home' && <HomePage />}
      {page === 'today' && <TodayPage onStartFocus={() => open('focus')} />}
      {page === 'focus' && <FocusPage remain={remain} />}
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

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} onOpen={open} />}
      {copilotOpen && <Copilot onClose={() => setCopilotOpen(false)} />}
    </div>
  );
}
