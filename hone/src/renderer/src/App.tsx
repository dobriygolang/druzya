import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { CueSessionAnalysis } from '@shared/ipc';

import { CanvasBg, type CanvasMode, type ThemeId } from './components/CanvasBg';
import { Wordmark, Versionmark } from './components/Chrome';
import { TrafficLightsHover } from './components/TrafficLightsHover';
import { Dock } from './components/Dock';
import { LoginScreen } from './components/LoginScreen';
import { OnboardingModal } from './components/OnboardingModal';
import { CueInstallSuggestion } from './components/CueInstallSuggestion';
import { LinguaMigrationModal } from './components/LinguaMigrationModal';
import {
  IdentityIntroModal,
  shouldShowIdentityIntro,
} from './components/onboarding/IdentityIntroModal';
import { Palette, type PageId, type PaletteAction } from './components/Palette';
import { DailyBriefPanel } from './components/DailyBriefPanel';
import { TutorAssignmentsBanner } from './components/TutorAssignmentsBanner';
import { UpdateToast } from './components/UpdateToast';
import { OfflineBanner } from './components/OfflineBanner';
import { CategorizeToastContainer } from './components/taskboard/CategorizeToast';
import { ConflictModal, useConflictListener } from './components/ConflictModal';
import { HomePage } from './pages/Home';
import { type StartFocusArgs } from './pages/Today';
import { VaultUnlockGate } from './components/VaultUnlockGate';
import { UpgradePrompt } from './components/UpgradePrompt';
import { UpgradeModal } from './components/UpgradeModal';
import { useQuotaStore } from './stores/quota';
import { TutorTabsChrome, type TutorTab } from './components/TutorTabsChrome';
import { useTrackStore } from './stores/track';
import { UpcomingEventChip } from './components/UpcomingEventChip';
import {
  readStoredTheme,
  readPomodoroSeconds,
  readFocusMode,
  writeFocusMode,
  FOCUS_MODES,
  type FocusMode,
} from './stores/prefs';
import { useSessionStore } from './stores/session';
import { startFocusSession, endFocusSession } from './api/hone';
import { notify } from './api/notifications';
import { AnimatedStatsOverlay } from './components/AnimatedStatsOverlay';
import { PageSkeleton } from './components/Skeleton';
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys';
import { useTrackpadSwipe } from './hooks/useTrackpadSwipe';
import { useHoneSync } from './hooks/useHoneSync';
import { trackEvent, installTelemetryAutoFlush } from './api/events';
import { analytics, ANALYTICS_EVENTS } from './lib/analytics';

const Coach = lazy(() => import('./pages/Coach').then((m) => ({ default: m.Coach })));
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const TaskBoardPage = lazy(() => import('./pages/TaskBoard').then((m) => ({ default: m.TaskBoardPage })));
const NotesPage = lazy(() => import('./pages/Notes').then((m) => ({ default: m.NotesPage })));
const TutorAssignmentsPage = lazy(() =>
  import('./pages/TutorAssignments').then((m) => ({ default: m.TutorAssignmentsPage })),
);
const CalendarPage = lazy(() => import('./pages/Calendar').then((m) => ({ default: m.CalendarPage })));
const MemoryTimelinePage = lazy(() => import('./pages/MemoryTimeline').then((m) => ({ default: m.MemoryTimelinePage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

const Copilot = lazy(() => import('./components/Copilot').then((m) => ({ default: m.Copilot })));

const PageSuspense = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
);

const ONBOARDING_KEY = 'hone:onboarded:v2';

interface ReflectionPrompt {
  sessionId: string;
  secondsFocused: number;
  pomodorosCompleted: number;
  focusMode: 'pomodoro' | 'countdown' | 'plan';
  startedAt: Date;
  endedAt: Date;
  taskPinned?: string;
}

export default function App() {
  const status = useSessionStore((s) => s.status);
  const bootstrap = useSessionStore((s) => s.bootstrap);
  const hydrate = useSessionStore((s) => s.hydrate);
  const clear = useSessionStore((s) => s.clear);
  const hydrateTrack = useTrackStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateTrack();
  }, [hydrateTrack]);

  useConflictListener();

  const PAGE_STORAGE_KEY = 'hone:lastPage:v1';
  const VALID_PAGES = new Set<PageId>([
    'home', 'today', 'coach', 'notes', 'stats',
    'assignments',
    'calendar', 'memory', 'settings',
  ]);
  const readStoredPage = (): PageId => {
    if (typeof window === 'undefined') return 'home';
    try {
      const v = window.sessionStorage.getItem(PAGE_STORAGE_KEY);
      if (v && VALID_PAGES.has(v as PageId)) return v as PageId;
    } catch {
      /* sessionStorage may be unavailable (private mode) — fall through */
    }
    return 'home';
  };
  const [page, setPageRaw] = useState<PageId>(() => readStoredPage());
  // Wrap setState in View Transitions API so old↔new pages cross-fade via CSS
  // ::view-transition rules in globals.css. sessionStorage write happens inside
  // the functional updater so a single setState = single render = one transition.
  const setPage = useCallback((next: PageId | ((p: PageId) => PageId)) => {
    const update = () => {
      setPageRaw((current) => {
        const resolved = typeof next === 'function'
          ? (next as (p: PageId) => PageId)(current)
          : next;
        try {
          window.sessionStorage.setItem(PAGE_STORAGE_KEY, resolved);
        } catch {
          /* sessionStorage unavailable — restore just won't fire */
        }
        if (resolved !== current) {
          trackEvent('page_view', { page: resolved, from: current });
        }
        return resolved;
      });
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(update);
    } else {
      update();
    }
  }, []);
  const [paletteOpen, setPaletteOpenRaw] = useState(false);
  const setPaletteOpen = useCallback((next: boolean | ((p: boolean) => boolean)) => {
    setPaletteOpenRaw((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      if (resolved && !prev) {
        trackEvent('palette_open');
      }
      return resolved;
    });
  }, []);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [cueSuggestionOpen, setCueSuggestionOpen] = useState(false);
  const [identityIntroOpen, setIdentityIntroOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => readStoredTheme());

  // Mutable cap — updating doesn't interrupt a running timer; new length
  // takes effect on the next pomodoro.
  const pomodoroSecsRef = useRef(readPomodoroSeconds());
  const pomodoroSecs = pomodoroSecsRef.current;

  const [remain, setRemain] = useState(pomodoroSecs);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<FocusMode>(() => readFocusMode());
  const [vol, setVol] = useState(40);

  useEffect(() => {
    // Cap ambient at 50% — it's SFX background, not main content.
    void import('./audio/ambient-music').then((m) => m.setAmbientVolume((vol / 100) * 0.5));
  }, [vol]);

  // Autoplay policy blocks first mount — ambient-music installs a one-shot
  // click listener for the first user interaction.
  useEffect(() => {
    void import('./audio/ambient-music').then((m) => m.bootstrapAmbient());
  }, []);

  const [pinnedTitle, setPinnedTitle] = useState<string | null>(null);
  const [pinnedPlanItemId, setPinnedPlanItemId] = useState<string | null>(null);
  // Single-shot brief-driven navigation: target page consumes value on mount and resets to null.
  const [briefTargetNoteId, setBriefTargetNoteId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_briefTargetPlanItemId, setBriefTargetPlanItemId] = useState<string | null>(null);
  const [importedCueNote, setImportedCueNote] = useState<{ filePath: string; analysis: CueSessionAnalysis } | null>(null);
  const sessionRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<Date | null>(null);
  const [reflectionPrompt, setReflectionPrompt] = useState<ReflectionPrompt | null>(null);

  useEffect(() => {
    void bootstrap();
    // Outbox executors must be wired before any enqueue call, so install eagerly.
    void import('./offline/wire').then((m) => m.wireOutboxExecutors());
    void import('./offline/ydoc-migrate').then((m) => m.installYDocMigrationHook());
    void import('./offline/outbox').then((m) => m.installOutboxAutoDrain());
    installTelemetryAutoFlush();
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge) return;

    void bridge.pomodoro.load().then((snap) => {
      if (!snap) return;
      const elapsedMs = Date.now() - snap.savedAt;
      if (snap.running && elapsedMs >= snap.remainSec * 1000) {
        setRemain(0);
        setRunning(false);
        return;
      }
      const adjusted = snap.running
        ? Math.max(0, snap.remainSec - Math.floor(elapsedMs / 1000))
        : snap.remainSec;
      setRemain(adjusted);
      setRunning(false);
    });

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

    const offCue = bridge.on('cueNoteImport', (ev) => {
      setImportedCueNote(ev);
      setPage('notes');
    });

    return () => {
      offAuth();
      offDeep();
      offCue();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'signed_in') return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(ONBOARDING_KEY)) return;
    setOnboardingOpen(true);
  }, [status]);

  // Wait for OnboardingModal to close before stacking identity-intro.
  useEffect(() => {
    if (status !== 'signed_in') return;
    if (onboardingOpen) return;
    if (!shouldShowIdentityIntro()) return;
    setIdentityIntroOpen(true);
  }, [status, onboardingOpen]);

  useEffect(() => {
    const onOpen = (): void => setIdentityIntroOpen(true);
    window.addEventListener('hone:open-identity-intro', onOpen);
    return () => window.removeEventListener('hone:open-identity-intro', onOpen);
  }, []);

  useEffect(() => {
    if (status !== 'signed_in') return;
    void import('./api/device').then(({ ensureDevice }) => {
      void ensureDevice({ appVersion: '0.0.1' }).catch(() => {
        /* device-limit / network — silent; retry next launch */
      });
    });
    void import('./api/intelligence').then(({ recordAppInstall }) => {
      void recordAppInstall('hone', '0.0.1').then((r) => {
        if (r.trialProGranted) {
          try {
            window.dispatchEvent(
              new CustomEvent('hone:trial-pro-granted', {
                detail: { until: r.trialProUntil },
              }),
            );
          } catch {
            /* CustomEvent unsupported in old WebView — silent */
          }
        }
      }).catch(() => {
        /* heartbeat is best-effort, retry next launch */
      });
    });
    let goalUnsub: (() => void) | undefined;
    void import('./stores/goal').then(({ useGoalStore }) => {
      void useGoalStore.getState().hydrate();
      goalUnsub = useGoalStore.getState().subscribe();
    });
    return () => {
      if (goalUnsub) goalUnsub();
    };
  }, [status]);

  // Wipe in-memory vault key on logout — without this encrypted notes
  // remain readable until tab close.
  useEffect(() => {
    if (status === 'signed_in') return;
    void import('./api/vault').then(({ lockVault }) => lockVault());
  }, [status]);

  const sessionUserId = useSessionStore((s) => s.userId);
  useEffect(() => {
    if (status !== 'signed_in' || !sessionUserId) return;
    analytics.init({ userId: sessionUserId });
  }, [status, sessionUserId]);

  const userId = useSessionStore((s) => s.userId);
  useHoneSync(status, userId);

  const dismissOnboarding = () => {
    setOnboardingOpen(false);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  // Tick semantics per mode:
  //   pomodoro/countdown/plan → counts down (auto-end at 0).
  //   stopwatch/free → counts up uncapped.
  //   pinned → counts up; auto-end on task-done is handled externally.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setRemain((r) => {
        switch (mode) {
          case 'pomodoro':
          case 'countdown':
          case 'plan':
            return Math.max(0, r - 1);
          case 'stopwatch':
          case 'free':
          case 'pinned':
          default:
            return r + 1;
        }
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, mode]);

  // Throttle snapshot persist to once per 5s while ticking — per-second
  // writes are wasted IO; start/stop transitions flush immediately.
  const lastSavedRef = useRef(0);
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge) return;
    const now = Date.now();
    if (now - lastSavedRef.current < 5000 && remain > 0) return;
    lastSavedRef.current = now;
    void bridge.pomodoro.save({ remainSec: remain, running, savedAt: now });
  }, [remain, running]);

  // Push tray title only on minute-flips (not every second). macOS throttles
  // unfocused-app updates anyway, and per-second ticks in the menubar mislead
  // the user into expecting precision Apple doesn't deliver.
  const lastTrayMinuteRef = useRef<number | null>(null);
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.hone : undefined;
    if (!bridge) return;
    if (!running) {
      lastTrayMinuteRef.current = null;
      void bridge.tray.update('', 'Hone');
      return;
    }
    const totalSec = Math.max(0, remain);
    const m = Math.floor(totalSec / 60);
    if (lastTrayMinuteRef.current === m) return;
    lastTrayMinuteRef.current = m;
    const title = `${String(m).padStart(2, '0')}:00`;
    const tooltip = pinnedTitle ? `Hone — ${pinnedTitle}` : 'Hone — focus session';
    void bridge.tray.update(title, tooltip);
  }, [remain, running, pinnedTitle]);

  useEffect(() => {
    if (!running || sessionRef.current) return;
    const planItemId = pinnedPlanItemId ?? undefined;
    const pinned = pinnedTitle ?? undefined;
    sessionStartedAtRef.current = new Date();
    startFocusSession({ planItemId, pinnedTitle: pinned, mode: 'pomodoro' })
      .then((s) => {
        sessionRef.current = s.id;
      })
      .catch(() => {
        /* silent — Dock timer must not show error */
      });
  }, [running, pinnedPlanItemId, pinnedTitle]);

  const finishSession = useCallback(
    async (reflection: string = '') => {
      const id = sessionRef.current;
      if (!id) return;
      const secondsFocused = Math.max(0, pomodoroSecsRef.current - remain);
      const pomodorosCompleted = remain === 0 ? 1 : 0;
      sessionRef.current = null;
      const trimmed = reflection.trim();
      const payload = {
        sessionId: id,
        pomodorosCompleted,
        secondsFocused,
        reflection: trimmed,
      };
      // Reflection is user-data — never silently drop. Without reflection
      // a missed end-call is OK; backend closes the session on timeout.
      const queueIfNeeded = async () => {
        if (!trimmed) return;
        try {
          const { enqueue } = await import('./offline/outbox');
          await enqueue('focus.end', payload);
        } catch {
          /* outbox unavailable (IDB closed) — data lost; Sentry will pick up if widespread */
        }
      };
      trackEvent('focus_end', {
        seconds_focused: secondsFocused,
        pomodoros_completed: pomodorosCompleted,
        had_reflection: trimmed.length > 0 ? 'true' : 'false',
      });
      analytics.track(ANALYTICS_EVENTS.focus_session_completed, {
        seconds_focused: secondsFocused,
        pomodoros_completed: pomodorosCompleted,
        had_reflection: trimmed.length > 0,
      });
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await queueIfNeeded();
        return;
      }
      try {
        await endFocusSession(payload);
      } catch {
        await queueIfNeeded();
      }
    },
    [remain],
  );

  useEffect(() => {
    const isCountdownLike = mode === 'pomodoro' || mode === 'countdown' || mode === 'plan';
    if (!isCountdownLike) return;
    if (running && remain === 0) {
      setRunning(false);
      const id = sessionRef.current;
      const seconds = pomodoroSecsRef.current;
      void finishSession();
      void notify('Focus session complete', 'Pomodoro finished — take a break.');
      if (id) {
        const endedAt = new Date();
        const startedAt = sessionStartedAtRef.current ?? new Date(endedAt.getTime() - seconds * 1000);
        setReflectionPrompt({
          sessionId: id,
          secondsFocused: seconds,
          pomodorosCompleted: 1,
          focusMode: mode as 'pomodoro' | 'countdown' | 'plan',
          startedAt,
          endedAt,
          taskPinned: pinnedTitle ?? undefined,
        });
      }
      sessionStartedAtRef.current = null;
      setRemain(pomodoroSecsRef.current);
      // Defer Cue-suggestion check until after reflection mounts so it
      // lands on top, not in front of the timer ring.
      void (async () => {
        try {
          const { wasCueSuggestionDismissed } = await import('./components/CueInstallSuggestion');
          if (wasCueSuggestionDismissed()) return;
          const { getInstalledApps } = await import('./api/intelligence');
          const installs = await getInstalledApps();
          const hasCue = installs.some((it) => it.app === 'cue');
          if (!hasCue) setCueSuggestionOpen(true);
        } catch {
          /* suggestion is best-effort, never throws */
        }
      })();
    }
  }, [remain, running, mode, finishSession, pinnedTitle]);

  const initialFor = useCallback(
    (m: FocusMode) => {
      switch (m) {
        case 'pomodoro':
        case 'countdown':
        case 'plan':
          return pomodoroSecsRef.current;
        case 'stopwatch':
        case 'free':
        case 'pinned':
        default:
          return 0;
      }
    },
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
      const idx = FOCUS_MODES.indexOf(m);
      const next = FOCUS_MODES[(idx + 1) % FOCUS_MODES.length];
      setRemain(initialFor(next));
      writeFocusMode(next);
      return next;
    });
  }, [finishSession, initialFor]);

  const startFocus = useCallback((args?: StartFocusArgs) => {
    setPinnedPlanItemId(args?.planItemId ?? null);
    setPinnedTitle(args?.pinnedTitle ?? null);
    setReflectionPrompt(null);
    setRemain(pomodoroSecsRef.current);
    setRunning(true);
    setPage('home');
    trackEvent('focus_start', {
      has_plan_item: args?.planItemId ? 'true' : 'false',
      has_pinned_title: args?.pinnedTitle ? 'true' : 'false',
    });
    analytics.track(ANALYTICS_EVENTS.focus_session_started, {
      has_plan_item: args?.planItemId ? true : false,
      has_pinned_title: args?.pinnedTitle ? true : false,
    });
  }, []);

  const stopFocus = useCallback(() => {
    if (!running && !sessionRef.current) return;
    setRunning(false);
    void finishSession();
    setRemain(pomodoroSecsRef.current);
  }, [running, finishSession]);

  const openImpl = useCallback(
    (id: PaletteAction, args?: StartFocusArgs) => {
      if (id === 'copilot') {
        setCopilotOpen(true);
        return;
      }
      if (id === 'stats') {
        setStatsOpen(true);
        return;
      }
      if (args) {
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

  // Sidebar back-arrow uses this — window.history.back() doesn't work in
  // Electron renderer without a router.
  useEffect(() => {
    const onNavHome = () => setPage('home');
    window.addEventListener('hone:nav-home', onNavHome);
    return () => window.removeEventListener('hone:nav-home', onNavHome);
  }, []);

  useGlobalHotkeys({
    page,
    paletteOpen,
    copilotOpen,
    onboardingOpen,
    statsOpen,
    setPaletteOpen,
    setCopilotOpen,
    setStatsOpen,
    dismissOnboarding,
    goHome,
    open,
    openStats: () => open('stats'),
  });

  useTrackpadSwipe(statsOpen, setStatsOpen);

  const canvasMode: CanvasMode = page === 'home' || page === 'stats' ? 'full' : 'quiet';

  useEffect(() => {
    if (status !== 'signed_in') return;
    void useQuotaStore.getState().refresh();
    const id = window.setInterval(() => {
      void useQuotaStore.getState().refresh();
    }, 60 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [status]);

  if (status === 'unknown') {
    return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />;
  }

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

      {/* Invisible 48px drag strip — macOS lets you drag the window through
          this region. Covers traffic lights (no-drag) and leaves drag-only
          area to the right. z-index 5 sits above CanvasBg but below Wordmark. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 5,
          // @ts-expect-error — non-standard Electron CSS property
          WebkitAppRegion: 'drag',
        }}
      />
      <TrafficLightsHover />
      <Wordmark />
      <Versionmark escHint={page !== 'home'} onEsc={goHome} />

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
          }}
        />
      )}
      {page === 'home' && (
        <TutorAssignmentsBanner
          running={running}
          onOpenAll={() => setPage('assignments')}
        />
      )}
      {page === 'home' && (
        <UpcomingEventChip
          running={running}
          onOpenCalendar={() => setPage('calendar')}
        />
      )}
      {page === 'home' && (
        <HomePage
          running={running}
          remain={remain}
          pinnedTitle={pinnedTitle}
          reflectionPrompt={reflectionPrompt}
          onStop={stopFocus}
          onSubmitReflection={async (text, grade) => {
            const prompt = reflectionPrompt;
            if (!prompt) return;
            const trimmed = text.trim();
            const payload = {
              sessionId: prompt.sessionId,
              focusMode: prompt.focusMode,
              durationSeconds: prompt.secondsFocused,
              grade: typeof grade === 'number' ? grade : 0,
              notes: trimmed,
              taskPinned: prompt.taskPinned ?? '',
              startedAt: prompt.startedAt.toISOString(),
              endedAt: prompt.endedAt.toISOString(),
            };
            const queueIfNeeded = async (): Promise<void> => {
              try {
                const { enqueue } = await import('./offline/outbox');
                await enqueue('focus.reflection', payload);
              } catch {
                /* outbox unavailable — degenerate path, data lost */
              }
            };
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
              await queueIfNeeded();
              setReflectionPrompt(null);
              return;
            }
            try {
              const { saveFocusReflection } = await import('./api/intelligence');
              await saveFocusReflection({
                sessionId: prompt.sessionId,
                focusMode: prompt.focusMode,
                durationSeconds: prompt.secondsFocused,
                grade: typeof grade === 'number' ? grade : 0,
                notes: trimmed,
                taskPinned: prompt.taskPinned ?? '',
                startedAt: prompt.startedAt,
                endedAt: prompt.endedAt,
              });
            } catch {
              await queueIfNeeded();
            }
            analytics.track(ANALYTICS_EVENTS.reflection_submitted, {
              has_grade: typeof grade === 'number',
              has_notes: trimmed.length > 0,
              focus_mode: prompt.focusMode,
            });
            setReflectionPrompt(null);
          }}
          onDismissReflection={() => setReflectionPrompt(null)}
        />
      )}
      <PageSuspense>
        {page === 'today' && <TaskBoardPage />}
        {page === 'coach' && <Coach onStartFocus={({ pinnedTitle }) => startFocus({ pinnedTitle })} />}
        {page === 'stats' && <Stats />}
        {page === 'notes' && (
          <VaultUnlockGate>
            <NotesPage
              initialSelectedId={briefTargetNoteId}
              onConsumeInitial={() => setBriefTargetNoteId(null)}
              initialCueNote={importedCueNote}
              onConsumeCueNote={() => setImportedCueNote(null)}
            />
          </VaultUnlockGate>
        )}
      </PageSuspense>
      {(page === 'assignments' || page === 'calendar') && (
        <TutorTabsChrome
          current={page as TutorTab}
          onChange={(t) => openImpl(t)}
        />
      )}
      {page === 'home' && (
        <AnimatedStatsOverlay open={statsOpen} onClose={() => setStatsOpen(false)} />
      )}
      <PageSuspense>
        {page === 'settings' && (
          <SettingsPage
            theme={theme}
            onThemeChange={setTheme}
            onPomoChange={(secs) => {
              pomodoroSecsRef.current = secs;
              if (!running) setRemain(secs);
            }}
          />
        )}

        {page === 'assignments' && <TutorAssignmentsPage />}
        {page === 'calendar' && <CalendarPage />}
        {page === 'memory' && <MemoryTimelinePage />}
      </PageSuspense>

      <Dock
        onMenu={() => setPaletteOpen(true)}
        running={running}
        onToggle={() => {
          if (running) {
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
      {copilotOpen && (
        <Suspense fallback={null}>
          <Copilot onClose={() => setCopilotOpen(false)} />
        </Suspense>
      )}
      {onboardingOpen && <OnboardingModal onClose={dismissOnboarding} />}
      {identityIntroOpen && (
        <IdentityIntroModal onClose={() => setIdentityIntroOpen(false)} />
      )}
      <CueInstallSuggestion
        open={cueSuggestionOpen}
        onClose={() => setCueSuggestionOpen(false)}
      />
      <LinguaMigrationModal />
      <UpdateToast />
      <OfflineBanner />
      <UpgradePrompt />
      <CategorizeToastContainer />
      <UpgradeModal />
      <ConflictModal />
    </div>
  );
}
