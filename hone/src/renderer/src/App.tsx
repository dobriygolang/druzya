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
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CueSessionAnalysis } from '@shared/ipc';

import { CanvasBg, type CanvasMode, type ThemeId } from './components/CanvasBg';
import { Wordmark, Versionmark } from './components/Chrome';
// TrackSwitcher import retired — Sergey 2026-05-05 hide legacy general/dev/go.
import { TrafficLightsHover } from './components/TrafficLightsHover';
import { Dock } from './components/Dock';
import { LoginScreen } from './components/LoginScreen';
import { OnboardingModal } from './components/OnboardingModal';
import { CueInstallSuggestion } from './components/CueInstallSuggestion';
import {
  IdentityIntroModal,
  shouldShowIdentityIntro,
} from './components/onboarding/IdentityIntroModal';
import { Palette, type PageId, type PaletteAction } from './components/Palette';
import { DailyBriefPanel } from './components/DailyBriefPanel';
import { TutorAssignmentsBanner } from './components/TutorAssignmentsBanner';
// StandupOverlay удалён — standup переехал в morning banner на Today page
// (см. components/TodayStandupBanner.tsx).
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
// BoardsTabsChrome removed 2026-05-12 (D4/Stream F) — Whiteboard / Editor
// migrated to web solo. Hone hotkeys (B / E) теперь открывают browser tab.
import { EnglishTabsChrome, type EnglishTab } from './components/EnglishTabsChrome';
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
import { EnglishOffPlaceholder } from './components/EnglishOffPlaceholder';
import { PageSkeleton } from './components/Skeleton';
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys';
import { useTrackpadSwipe } from './hooks/useTrackpadSwipe';
import { useHoneSync } from './hooks/useHoneSync';
import { trackEvent, installTelemetryAutoFlush } from './api/events';
import { analytics, ANALYTICS_EVENTS } from './lib/analytics';

// Lazy pages — each ships in its own chunk. Heavy editors (Editor with
// CodeMirror, SharedBoards with Excalidraw, Notes with Milkdown) are the
// biggest payoff; lighter ones still benefit from cold-path delay.
// HomePage stays eager because it is the first paint after auth and the
// reflection prompt + pomodoro depend on it being mounted immediately.
const Coach = lazy(() => import('./pages/Coach').then((m) => ({ default: m.Coach })));
const Stats = lazy(() => import('./pages/Stats').then((m) => ({ default: m.Stats })));
const TaskBoardPage = lazy(() => import('./pages/TaskBoard').then((m) => ({ default: m.TaskBoardPage })));
const NotesPage = lazy(() => import('./pages/Notes').then((m) => ({ default: m.NotesPage })));
// D5 (2026-05-12) — Podcasts migrated to web (/podcasts). Hone стал pure
// focus cockpit; content surfaces (articles + podcasts) живут в web.
// D4 (2026-05-12, Stream F) — SharedBoardsPage / EditorPage migrated to web
// solo (/whiteboard/:id + /editor/:id). Peer-collab WS dropped; Hone больше
// не загружает Excalidraw + CodeMirror bundle. B / E hotkeys теперь
// открывают browser tab (см. onKey handler ниже).
const ReadingPage = lazy(() => import('./pages/Reading').then((m) => ({ default: m.ReadingPage })));
const WritingPage = lazy(() => import('./pages/Writing').then((m) => ({ default: m.WritingPage })));
const TutorAssignmentsPage = lazy(() =>
  import('./pages/TutorAssignments').then((m) => ({ default: m.TutorAssignmentsPage })),
);
const ListeningPage = lazy(() => import('./pages/Listening').then((m) => ({ default: m.ListeningPage })));
const SpeakingPage = lazy(() => import('./pages/Speaking').then((m) => ({ default: m.SpeakingPage })));
const EnglishOverviewPage = lazy(() =>
  import('./pages/EnglishOverview').then((m) => ({ default: m.EnglishOverviewPage })),
);
const CalendarPage = lazy(() => import('./pages/Calendar').then((m) => ({ default: m.CalendarPage })));
const MemoryTimelinePage = lazy(() => import('./pages/MemoryTimeline').then((m) => ({ default: m.MemoryTimelinePage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

// Heavy overlays — only mounted on demand.
// StatsOverlay вынесен в AnimatedStatsOverlay (отдельный файл), Copilot —
// rarely opened (palette / hotkey only).
const Copilot = lazy(() => import('./components/Copilot').then((m) => ({ default: m.Copilot })));

// Suspense fallback: shimmer skeleton чтобы lazy-chunk загрузка не выглядела
// как «ничего не происходит». Геометрия generic (header strip + 3 KPI + 2
// large cards) — не имитирует конкретную page, а заполняет canvas-area так
// чтобы юзер видел «что-то грузится» до first paint лейаута.
const PageSuspense = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
);

// Pomodoro duration — initialised from localStorage so Settings changes
// survive restart. pomodoroSecsRef holds the "cap" for the next session;
// updating it doesn't interrupt a running timer (intentional: the user
// shouldn't have their active session cut short mid-focus).

const ONBOARDING_KEY = 'hone:onboarded:v2';

// ReflectionPrompt — что показывает Home после завершения сессии. Не
// модалка-блокер (как было в FocusPage), просто inline-инпут в углу.
//
// H2 (Phase J 2026-05-12): добавлены focusMode + startedAt + endedAt чтобы
// payload передаваемый в SaveFocusReflection RPC был complete. taskPinned —
// optional pinned-task title если у юзера был.
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
  // English как orthogonal modifier (Sergey 2026-05-03). Если false —
  // English-страницы рендерятся как «English отключён» CTA вместо реального
  // surface'а. Toggle в Settings.
  const englishActive = useTrackStore((s) => s.englishActive);
  const hydrateTrack = useTrackStore((s) => s.hydrate);
  // englishVisible = settings.englishActive || onboarding stack === 'english'.
  // Если юзер выбрал English-track в onboarding'е, мы показываем module даже
  // если backend ещё не получил setEnglishActive(true) (network/offline).
  // Sergey 2026-05-04: English — opt-in, не должен светиться в палитре по
  // умолчанию.
  const profileStackIsEnglish = useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = window.localStorage.getItem('hone:profile:v2');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { stack?: string };
      return parsed?.stack === 'english';
    } catch {
      return false;
    }
  }, [status]);
  const englishVisible = englishActive || profileStackIsEnglish;
  useEffect(() => {
    void hydrateTrack();
  }, [hydrateTrack]);

  // CI4 (Phase A 2026-05-12) — listen для emitConflict() events из outbox
  // 409 paths. Modal mount ниже подхватывает state из conflict store.
  useConflictListener();

  // CI2 (Phase A W3 — 2026-05-11): persist last page в sessionStorage so a
  // reload (Cmd+R, electron-updater restart, devtools-reload) lands you
  // back where you were. Previously every reload bounced юзера на home —
  // breaks the «Hone remembers context» promise. sessionStorage (NOT
  // localStorage) is the right scope: cross-window restore would surprise
  // — each Hone window has its own page context.
  const PAGE_STORAGE_KEY = 'hone:lastPage:v1';
  const VALID_PAGES = new Set<PageId>([
    'home', 'today', 'coach', 'notes', 'stats',
    // 'editor' / 'shared_boards' removed 2026-05-12 (D4/Stream F) —
    // migrated to web solo (/whiteboard/:id + /editor/:id).
    'english_overview',
    'reading', 'writing', 'assignments', 'listening', 'speaking',
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
  // setPage обёрнут в View Transitions API — Chromium фиксирует snapshot
  // текущего DOM, обновляет state, и анимирует old↔new через ::view-transition.
  // CSS правила лежат в globals.css (page-fade in/out).
  // Если API недоступен (старый Chromium / fallback) — обычный setState.
  //
  // sessionStorage write happens внутри функционального updater'а так что
  // single setState вызов = single React render и одна view transition; ни
  // dual-render ни race с functional `next` (которая зависит от current).
  const setPage = useCallback((next: PageId | ((p: PageId) => PageId)) => {
    const update = () => {
      setPageRaw((current) => {
        const resolved = typeof next === 'function'
          ? (next as (p: PageId) => PageId)(current)
          : next;
        try {
          window.sessionStorage.setItem(PAGE_STORAGE_KEY, resolved);
        } catch {
          /* sessionStorage недоступен — restore просто не сработает */
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
  // Wrap setPaletteOpen чтобы трекать palette_open из любого пути (⌘K hotkey,
  // dock-menu, programmatic open). Single source of telemetry для consistency.
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
  // Phase J / X1 (P0) — show «install Cue» suggestion exactly once after
  // the user's first completed focus session, gated on backend confirming
  // they don't have Cue installed yet.
  const [cueSuggestionOpen, setCueSuggestionOpen] = useState(false);
  // Phase J / X4 (P1) — identity-discovery modal. Триггерится через
  // useEffect ниже (после auth, только если OnboardingModal не висит и
  // localStorage flag пустой). Settings → Ecosystem может re-open
  // программно через window event 'hone:open-identity-intro'.
  const [identityIntroOpen, setIdentityIntroOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  // Theme — initial значение читаем из localStorage. Settings page пишет
  // в тот же ключ + дёргает onThemeChange (нам), так что CanvasBg
  // обновляется без full-reload.
  const [theme, setTheme] = useState<ThemeId>(() => readStoredTheme());

  // Mutable cap — updated when the user changes duration in Settings.
  // All "reset to full" calls read from this ref so the new length takes
  // effect on the *next* pomodoro, not mid-session.
  const pomodoroSecsRef = useRef(readPomodoroSeconds());
  const pomodoroSecs = pomodoroSecsRef.current;

  const [remain, setRemain] = useState(pomodoroSecs);
  const [running, setRunning] = useState(false);
  // 6-mode focus selector. Persisted в localStorage через writeFocusMode;
  // bootstrap читает readFocusMode на mount чтобы restore с прошлого
  // session'а. См. stores/prefs.ts FOCUS_MODES.
  const [mode, setMode] = useState<FocusMode>(() => readFocusMode());
  const [vol, setVol] = useState(40);

  // Volume slider в Dock'е управляет ambient cosmic music'ой.
  // (Podcast playback переехал в web /podcasts — D5 2026-05-12; podcast-audio
  // module остался для backward compat но больше не consumed Hone'ом.)
  useEffect(() => {
    // Ambient громче 50% не даём — он SFX background, не main content.
    void import('./audio/ambient-music').then((m) => m.setAmbientVolume((vol / 100) * 0.5));
  }, [vol]);

  // Bootstrap ambient music на app-start если юзер ранее включил (default ON).
  // Autoplay policy блочит на первом mount'е — ambient-music сам ставит
  // one-shot click listener для starting на первом user-interaction'е.
  useEffect(() => {
    void import('./audio/ambient-music').then((m) => m.bootstrapAmbient());
  }, []);

  const [pinnedTitle, setPinnedTitle] = useState<string | null>(null);
  const [pinnedPlanItemId, setPinnedPlanItemId] = useState<string | null>(null);
  // initialEditorRoom / initialBoardRoom — refs к локально-открытым boards
  // и code-rooms — удалены 2026-05-12 (D4/Stream F). Любые deeplinks на
  // конкретную комнату теперь открываются как web URL.
  // Brief-driven navigation hooks: when DailyBriefPanel'е жмут review_note
  // или unblock chip, кладём target_id сюда; целевая страница подхватывает
  // на mount и сбрасывает back to null. Single-shot semantics.
  const [briefTargetNoteId, setBriefTargetNoteId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_briefTargetPlanItemId, setBriefTargetPlanItemId] = useState<string | null>(null);
  const [importedCueNote, setImportedCueNote] = useState<{ filePath: string; analysis: CueSessionAnalysis } | null>(null);
  // Sentinel для backend session — null значит "не идёт". Создаётся при
  // первом переходе в running, гасится в finishSession.
  const sessionRef = useRef<string | null>(null);
  // H2 (Phase J 2026-05-12) — startedAt timestamp фиксируется на момент
  // session start; используется в ReflectionPrompt чтобы SaveFocusReflection
  // получил корректный (startedAt, endedAt) window для backend prompt'а.
  const sessionStartedAtRef = useRef<Date | null>(null);
  const [reflectionPrompt, setReflectionPrompt] = useState<ReflectionPrompt | null>(null);

  // ── Bootstrap: session + pomodoro snapshot + IPC subscribers ────────────
  useEffect(() => {
    void bootstrap();
    // Offline outbox: register executors + auto-drain online listener.
    // Idempotent — повторный вызов no-op. Должно быть ДО первого использования
    // outbox enqueue'а (поэтому здесь, в bootstrap'е, не lazy).
    void import('./offline/wire').then((m) => m.wireOutboxExecutors());
    void import('./offline/ydoc-migrate').then((m) => m.installYDocMigrationHook());
    void import('./offline/outbox').then((m) => m.installOutboxAutoDrain());
    // Phase A telemetry: 30s auto-flush + flush-on-pagehide. Idempotent.
    installTelemetryAutoFlush();
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

  // ── Onboarding: первый запуск показывает modal с шорткатами ─────────────
  useEffect(() => {
    if (status !== 'signed_in') return;
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(ONBOARDING_KEY)) return;
    setOnboardingOpen(true);
  }, [status]);

  // ── Identity-discovery modal (Phase J / X4 P1) ──────────────────────────
  // Триггер: signed_in + OnboardingModal закрыт + identity-flag не выставлен.
  // Ждём пока OnboardingModal закроется (если был открыт) чтобы не stack'ить
  // 2 modal'я. Юзер может re-open из Settings → window event subscription.
  useEffect(() => {
    if (status !== 'signed_in') return;
    if (onboardingOpen) return;
    if (!shouldShowIdentityIntro()) return;
    setIdentityIntroOpen(true);
  }, [status, onboardingOpen]);

  // Settings «Show intro again» dispatches this — re-opens modal без
  // page-reload (flag уже очищен внутри Settings handler'а).
  useEffect(() => {
    const onOpen = (): void => setIdentityIntroOpen(true);
    window.addEventListener('hone:open-identity-intro', onOpen);
    return () => window.removeEventListener('hone:open-identity-intro', onOpen);
  }, []);

  // ── Device bootstrap (Phase C-3.1) ──────────────────────────────────────
  // Регистрируем устройство при первом успешном логине. Errors глотаем —
  // sync feature просто не активируется до следующего запуска. Free-tier
  // 1-device limit (DeviceLimitError) НЕ блокирует app, юзер увидит
  // «Replace device» в Settings → Devices.
  //
  // F2 (2026-05-12) — primary goal: hydrate + subscribe в той же useEffect.
  // Не отдельный hook — offline-first, errors swallowed; subscribe ставит
  // window focus listener для re-fetch'а (юзер мог edit'нуть goal в web).
  useEffect(() => {
    if (status !== 'signed_in') return;
    void import('./api/device').then(({ ensureDevice }) => {
      void ensureDevice({ appVersion: '0.0.1' }).catch(() => {
        /* limit / network — silent; повторим на следующем запуске */
      });
    });
    // Phase J / X1 (P0) — fire idempotent install heartbeat to the
    // backend so we know the user actually launched Hone (not just signed
    // up via web). Result may carry trial_pro_granted=true on FIRST
    // install across all 3 surfaces; we surface the celebratory toast
    // via a window event so UpgradePrompt / settings can react too.
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
            /* CustomEvent unsupported в old WebView — silent */
          }
        }
      }).catch(() => {
        /* network / 401 — heartbeat is best-effort, retry next launch */
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

  // ── Vault auto-lock (Phase C-7) ─────────────────────────────────────────
  // На logout (status flip away from signed_in) wipe in-memory vault key.
  // Без этого encrypted notes остались бы readable до tab close.
  useEffect(() => {
    if (status === 'signed_in') return;
    void import('./api/vault').then(({ lockVault }) => lockVault());
  }, [status]);

  // ── Analytics opt-in SDK bootstrap (Phase J / X3, 2026-05-12) ──────────
  // Mirrored API surface across web/hone/cue. Hone default: opted-IN
  // (desktop install = explicit trust); user can flip in Settings → Privacy.
  // Delegates to existing trackEvent (Connect-RPC + batching).
  const sessionUserId = useSessionStore((s) => s.userId);
  useEffect(() => {
    if (status !== 'signed_in' || !sessionUserId) return;
    analytics.init({ userId: sessionUserId });
  }, [status, sessionUserId]);

  // ── Sync replication (Phase C-4) ────────────────────────────────────────
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

  // ── Pomodoro tick + persist ─────────────────────────────────────────────
  // 6 focus modes:
  //   pomodoro/countdown → счёт ВНИЗ (auto-end на 0).
  //   stopwatch → счёт ВВЕРХ без cap.
  //   pinned → счёт ВВЕРХ (auto-end когда task → done, обрабатывается извне).
  //   plan → счёт ВНИЗ (cycle multi-block, MVP = 50 focus + 10 break × 3).
  //   free → tick'аем счётчик ВВЕРХ просто для UI session duration.
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

  // Phase 2.5 — push pomodoro status to the macOS menubar tray.
  // Format: "12:34" while running, empty string when idle so the tray
  // collapses to icon-only. Tooltip carries the pinned task name when
  // available so a hover reveals what the timer is for.
  //
  // Phase R3 cooldown — was firing IPC every pomodoro tick (60 calls/min
  // while running). The tray is glanced at, not stared at — the seconds
  // digit is meaningless there. We now push:
  //   1) When `running` toggles (start/stop must update immediately).
  //   2) When `pinnedTitle` changes (tooltip needs to follow).
  //   3) When the *minute* digit of the timer changes.
  // That brings tray IPC from 60/min down to ~1/min during a session.
  // The seconds in the title used to "tick" in the menubar; with this
  // change the menubar shows the same minute for ~60s, then flips. That
  // matches every other macOS timer convention (Bartender, system clock).
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
    // Title shows mm:00 — the seconds field is intentionally zeroed so we
    // don't mislead the user into expecting per-second updates in the
    // menubar (which Apple throttles anyway when the app is unfocused).
    const title = `${String(m).padStart(2, '0')}:00`;
    const tooltip = pinnedTitle ? `Hone — ${pinnedTitle}` : 'Hone — focus session';
    void bridge.tray.update(title, tooltip);
  }, [remain, running, pinnedTitle]);

  // ── Focus session backend integration ─────────────────────────────────
  // Start session при первом переходе running false→true. Errors глотаем —
  // streak-наполнение «best-effort», не должно ломать таймер.
  useEffect(() => {
    if (!running || sessionRef.current) return;
    const planItemId = pinnedPlanItemId ?? undefined;
    const pinned = pinnedTitle ?? undefined;
    // H2 (Phase J) — fix startedAt at the local "user pressed start" moment
    // (Date.now). Backend session row уже знает свой own started_at; этот
    // ref только для reflection payload — клиентский timer-truth.
    sessionStartedAtRef.current = new Date();
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
      // Offline-first rule: reflection — pure user-data, нельзя терять.
      // Без reflection — silent skip OK, backend закроет session по timeout.
      const queueIfNeeded = async () => {
        if (!trimmed) return;
        try {
          const { enqueue } = await import('./offline/outbox');
          await enqueue('focus.end', payload);
        } catch {
          /* outbox недоступен (IDB закрыт?) — данные потеряны, но это lower
             priority чем silent UX. Логи в Sentry поднимут если массово. */
        }
      };
      // Telemetry: focus_end fires unconditionally (online или offline path).
      // had_reflection отделяет «taймer закончился без feedback» от «юзер
      // подвёл итог» — это разные signal'ы для product analysis.
      trackEvent('focus_end', {
        seconds_focused: secondsFocused,
        pomodoros_completed: pomodorosCompleted,
        had_reflection: trimmed.length > 0 ? 'true' : 'false',
      });
      // Phase J / X3 — cross-product taxonomy mirror.
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

  // Auto-end когда countdown-таймер дотикивает до 0.
  //   pomodoro / countdown → finishSession + reflection prompt.
  //   plan → cycle к next block (упрощённый MVP — пока также finishSession;
  //          multi-block sequence flow выйдет следующей итерацией).
  //   stopwatch / free / pinned → юзер сам Stop / Reset.
  useEffect(() => {
    const isCountdownLike = mode === 'pomodoro' || mode === 'countdown' || mode === 'plan';
    if (!isCountdownLike) return;
    if (running && remain === 0) {
      setRunning(false);
      const id = sessionRef.current;
      const seconds = pomodoroSecsRef.current;
      void finishSession();
      // OS-native notification — юзер мог уйти от экрана, нужна звуковая
      // подсказка что pomodoro закончилось. notify() сам проверяет
      // settings.notifications + permission, no-op'ит если отключено.
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
      // Phase J / X1 (P0) — after the user's first completed focus
      // session, check if Cue is installed and, if not, nudge them.
      // Once-only logic: localStorage flag guards against repeat shows.
      // We do this AFTER setRemain so the reflection modal already mounted
      // and the suggestion lands on top, not in front of the timer ring.
      void (async () => {
        try {
          const { wasCueSuggestionDismissed } = await import('./components/CueInstallSuggestion');
          if (wasCueSuggestionDismissed()) return;
          const { getInstalledApps } = await import('./api/intelligence');
          const installs = await getInstalledApps();
          const hasCue = installs.some((it) => it.app === 'cue');
          if (!hasCue) setCueSuggestionOpen(true);
        } catch {
          /* network / 401 — suggestion is best-effort, never throws */
        }
      })();
    }
  }, [remain, running, mode, finishSession, pinnedTitle]);

  // initialFor: per-mode initial remain value.
  //   pomodoro / countdown / plan → pomodoroSecsRef (count-down baseline)
  //   stopwatch / free / pinned → 0 (count-up)
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

  // Cycle через FOCUS_MODES в порядке объявления; персистим выбор в
  // localStorage чтобы restore с прошлого session'а. Switching modes
  // сбрасывает remain в initialFor(next) — running сессия завершается
  // через finishSession.
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
    // Phase J / X3 — cross-product taxonomy. Identical surface across apps
    // so funnel queries can group hone+cue+web focus starts cleanly.
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
        // Sergey 2026-05-05: full Stats page удалён (duplicate с overlay).
        // Palette S → выдвижной StatsOverlay.
        setStatsOpen(true);
        return;
      }
      // 'standup' palette command удалён — banner был раньше на Today page,
      // юзер просил убрать и оттуда, и из общих переходов.
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
  useGlobalHotkeys({
    page,
    paletteOpen,
    copilotOpen,
    onboardingOpen,
    statsOpen,
    englishVisible,
    setPaletteOpen,
    setCopilotOpen,
    setStatsOpen,
    dismissOnboarding,
    goHome,
    open,
    openStats: () => open('stats'),
  });

  // ── Trackpad horizontal swipe — Mac-style 2-finger gesture ─────────────
  useTrackpadSwipe(statsOpen, setStatsOpen);

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

      {/* Window-drag strip: невидимая полоса вдоль верха окна (48 px),
          через которую macOS позволяет таскать окно. Traffic lights
          (видимые после убирания setWindowButtonVisibility) занимают
          ~28px высоты + 20px padding — 48px надёжно покрывает их и
          оставляет place для drag за пустую область справа.
          z-index 5 ставит strip ВЫШЕ CanvasBg (zIndex:0) но НИЖЕ
          Wordmark/Versionmark (которые помечены no-drag сами). */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 5,
          // @ts-expect-error — нестандартное Electron-CSS-property
          WebkitAppRegion: 'drag',
        }}
      />
      <TrafficLightsHover />
      <Wordmark />
      {/* TrackSwitcher (general/dev/go) скрыт — Sergey 2026-05-05.
       * Identity 3-track (Go senior · ML · English) определяется в onboarding
       * stack + Settings.englishActive, а legacy «general/dev/go» triple
       * confusing для юзера и duplicate'ит state. Если track-aware filtering
       * нужно — добавим как Settings dropdown, не header chip. */}
      {/* Versionmark — глобальная подсказка возврата. Раньше скрывался на
          editor page (CodeMirror использует Escape) — D4 2026-05-12 editor
          мигрирован в web, гард больше не нужен. */}
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
      {/* Tutor-pushed assignments — most-urgent pending shown on Home
          (Wave 5.1 → Hone HomePage integration). Hidden during running
          focus sessions to keep the canvas quiet; the banner self-polls
          every 60s + on window focus. */}
      {page === 'home' && (
        <TutorAssignmentsBanner
          running={running}
          onOpenAll={() => setPage('assignments')}
        />
      )}
      {/* Wave 5.2b — next tutor-scheduled session. Top-right chip; only
          surfaces within 24h (or while live). Click → /calendar page. */}
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
            // H2 (Phase J 2026-05-12) — offline-friendly persistence.
            // SaveFocusReflection идемпотентна через (user_id, session_id),
            // так что drain re-attempt после offline gap безопасен.
            const payload = {
              sessionId: prompt.sessionId,
              focusMode: prompt.focusMode,
              durationSeconds: prompt.secondsFocused,
              grade: typeof grade === 'number' ? grade : 0,
              notes: trimmed,
              taskPinned: prompt.taskPinned ?? '',
              // ISO strings для outbox JSON-serialisation; executor parse'ит обратно.
              startedAt: prompt.startedAt.toISOString(),
              endedAt: prompt.endedAt.toISOString(),
            };
            const queueIfNeeded = async (): Promise<void> => {
              try {
                const { enqueue } = await import('./offline/outbox');
                await enqueue('focus.reflection', payload);
              } catch {
                /* outbox недоступен — данные потеряны; редкая degenerate ветка */
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
            // Phase J / X3 — reflection submitted. `grade` already
            // sanitised by FormField; `notes` length is non-PII signal.
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
        {/* D5 (2026-05-12) — page 'podcasts' migrated to web /podcasts. */}
        {/* D4 (2026-05-12) — page 'shared_boards' / 'editor' migrated to
            web solo (/whiteboard/:id + /editor/:id). Hone B / E hotkeys
            теперь открывают browser tab; BoardsTabsChrome удалён. */}
      </PageSuspense>
      {/* English-loop hub chrome — surfaces R/W/L страницы как один
          логический hub. Palette сейчас один entry «English · Read ·
          Write · Listen», конкретный child выбирается через табы. */}
      {englishVisible && (page === 'reading' || page === 'writing' || page === 'listening' || page === 'speaking' || page === 'english_overview') && (
        <EnglishTabsChrome
          current={page as EnglishTab}
          onChange={(t) => openImpl(t)}
        />
      )}
      {/* Tutor hub chrome — same pattern, tasks + calendar. */}
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
              // Only reset remain if the timer isn't running — we don't
              // interrupt an active focus session.
              if (!running) setRemain(secs);
            }}
          />
        )}

        {(page === 'english_overview' || page === 'reading' || page === 'writing' || page === 'listening' || page === 'speaking') &&
          (englishVisible ? (
            <>
              {page === 'english_overview' && <EnglishOverviewPage onOpen={openImpl} />}
              {page === 'reading' && <ReadingPage />}
              {page === 'writing' && <WritingPage />}
              {page === 'listening' && <ListeningPage />}
              {page === 'speaking' && <SpeakingPage />}
            </>
          ) : (
            <EnglishOffPlaceholder onActivate={() => setPage('settings')} />
          ))}
        {page === 'assignments' && <TutorAssignmentsPage />}
        {page === 'calendar' && <CalendarPage />}
        {page === 'memory' && <MemoryTimelinePage />}
      </PageSuspense>

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
        <Palette onClose={() => setPaletteOpen(false)} onOpen={(id) => open(id)} englishVisible={englishVisible} />
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
      <UpdateToast />
      <OfflineBanner />
      <UpgradePrompt />
      {/* Phase J / H3 (P1, 2026-05-12) — global toast surface used by
          TaskBoard (auto-categorise hints) and other pages (generic info
          confirmations). Reads from useToastStore — multiple producers,
          one mount. */}
      <CategorizeToastContainer />
      {/* X2 (P0) — context-aware Pro upgrade modal. Mounted globally; fires
          via `useQuotaStore.showUpgradeModal({...})` from gating sites.
          Different from UpgradePrompt above: that one is for storage-quota
          errors (note/board/room create returned 402). This one is for
          per-feature Pro gating (calendar sync, deep analytics, etc.). */}
      <UpgradeModal />
      {/* CI4 (Phase A 2026-05-12) — 409 conflict resolution modal.
          Listens via window event from outbox 409 handlers + renders
          three-way diff (keep local / accept server / merge manually). */}
      <ConflictModal />
    </div>
  );
}

