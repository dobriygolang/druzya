// TaskBoard — Notion-style kanban в Hone (electron renderer).
//
// Дизайн натянут с design/index.html: цветной strip per-kind, kind-icon,
// priority dots, age, AI/user badge, side-drawer с комментариями,
// context-menu по правому клику, FAB → modal (Linear-стиль), footer с
// прогрессом и часами. Цвета через --ink/--bg/--surface CSS-vars.
//
// Топ-паддинг 64px чтобы под traffic-lights / draggable header не
// уезжали title и FAB.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  listTasks,
  createTask,
  moveTaskStatus,
  deleteTask,
  listTaskComments,
  addTaskComment,
  updateTaskKind,
  bulkAutoCategorise,
  subscribeCursorEvents,
  type TaskCard,
  type TaskComment,
  type TaskKind,
  type TaskStatus,
  type CursorEvent,
} from '../api/tasks';
import { AICursor } from '../components/AICursor';
import { KindPicker } from '../components/taskboard/KindPicker';
import { useSessionStore } from '../stores/session';
import { useToastStore } from '../stores/toast';
import { useTrackStore } from '../stores/track';
import { TodayGoalSection } from './Today';
import { trackEvent } from '../api/events';
import { analytics, ANALYTICS_EVENTS } from '../lib/analytics';

// ── Config ─────────────────────────────────────────────────────────────

interface ColumnDef {
  status: TaskStatus;
  label: string;
  accent: string;
}

// B/W only per feedback_color_rule.md — accent через opacity-стратификацию,
// не цветами. Активные columns — высокий contrast, dismissed — приглушённый.
const COLUMNS: ReadonlyArray<ColumnDef> = [
  { status: 'todo', label: 'To Do', accent: 'rgba(255,255,255,0.85)' },
  { status: 'in_progress', label: 'In Progress', accent: 'rgba(255,255,255,0.7)' },
  { status: 'in_review', label: 'In Review', accent: 'rgba(255,255,255,0.55)' },
  { status: 'done', label: 'Done', accent: 'rgba(255,255,255,0.4)' },
  { status: 'dismissed', label: 'Dismissed', accent: 'rgba(255,255,255,0.2)' },
];

interface KindDef {
  label: string;
  color: string;
  // SVG path (24x24, stroke-based, lucide-style). Single path keeps card-icon
  // rendering cheap and consistent с минимализмом hone.
  path: string;
}

// B/W rule: kind taxonomy несётся иконкой + label, цвет нулевой (ink-ramp).
// Identity: technical, no gamification — kanban не должен выглядеть как
// radio-color-coded.
const KINDS: Record<TaskKind, KindDef> = {
  algo:      { label: 'Algorithm',     color: 'rgba(255,255,255,0.65)', path: 'M16 18l6-6-6-6 M8 6l-6 6 6 6 M14.5 4l-5 16' },
  sysdesign: { label: 'System Design', color: 'rgba(255,255,255,0.55)', path: 'M9 19v-3 M15 19v-3 M9 8V5 M15 8V5 M5 11h14 M5 11v3a2 2 0 002 2h10a2 2 0 002-2v-3 M7 5h10' },
  quiz:      { label: 'Quiz',          color: 'rgba(255,255,255,0.75)', path: 'M12 22a10 10 0 100-20 10 10 0 000 20z M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3 M12 17h.01' },
  reflection:{ label: 'Reflection',    color: 'rgba(255,255,255,0.60)', path: 'M9.5 2A2.5 2.5 0 0112 4.5 2.5 2.5 0 0114.5 2 2.5 2.5 0 0117 4.5c0 .55-.18 1.06-.49 1.47A2.5 2.5 0 0118 8.5a2.5 2.5 0 01-1.5 2.29A2.5 2.5 0 0118 13.5a2.5 2.5 0 01-2.5 2.5h-.05A2.5 2.5 0 0113 18.5 2.5 2.5 0 0110.5 16H10A2.5 2.5 0 017.5 13.5 2.5 2.5 0 016 11 2.5 2.5 0 017.5 8.5 2.5 2.5 0 016 6 2.5 2.5 0 019.5 2z' },
  reading:   { label: 'Reading',       color: 'rgba(255,255,255,0.50)', path: 'M2 4h7a3 3 0 013 3v14a2 2 0 00-2-2H2V4z M22 4h-7a3 3 0 00-3 3v14a2 2 0 012-2h8V4z' },
  custom:    { label: 'Custom',        color: 'rgba(255,255,255,0.58)', path: 'M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z' },
};

// KindIcon — единая SVG-обёртка для всех мест где раньше был эмодзи.
function KindIcon({ kind, size = 14, color }: { kind: TaskKind; size?: number; color?: string }): JSX.Element {
  const def = KINDS[kind];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? def.color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d={def.path} />
    </svg>
  );
}

type TabKey = 'my' | 'week';

// Phase J / H3 (P1, 2026-05-12) — kind-filter localStorage persistence so
// the user's last selection survives page reload (TaskBoard is the daily
// driver — restoring the filter is the table-stakes UX). URL hash would be
// shareable, but Hone is a single-user surface so localStorage scope fits.
const KIND_FILTER_KEY = 'hone:taskboard:kindFilter:v1';
function readKindFilter(): Set<TaskKind> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(KIND_FILTER_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as TaskKind[];
    return new Set(arr.filter((k) => k in KINDS));
  } catch {
    return new Set();
  }
}
function writeKindFilter(s: Set<TaskKind>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KIND_FILTER_KEY, JSON.stringify([...s]));
  } catch {
    /* localStorage quota / private mode — silent */
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function relativeAge(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.floor((Date.now() - t) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ── Page ───────────────────────────────────────────────────────────────

export function TaskBoardPage(): JSX.Element {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('my');
  const [createOpen, setCreateOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; taskId: string } | null>(null);
  const cursorEventsRef = useRef<CursorEvent[]>([]);
  const [cursorEvents, setCursorEvents] = useState<CursorEvent[]>([]);
  // R4 (Phase A 2026-05-12) — archive drawer. Dismissed column moved out of
  // main board; restored via slide-out drawer для consistency между focus
  // surface (board) и cold storage (archive).
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Phase J / H3 (P1, 2026-05-12) — kind-filter chips + bulk action +
  // kind-picker anchor for inline override on card chips.
  const [kindFilter, setKindFilterRaw] = useState<Set<TaskKind>>(() => readKindFilter());
  const setKindFilter = useCallback((next: Set<TaskKind>) => {
    setKindFilterRaw(next);
    writeKindFilter(next);
  }, []);
  const [bulkProgress, setBulkProgress] = useState<{ processed: number; total: number } | null>(null);
  const bulkAbortRef = useRef<AbortController | null>(null);
  const [kindPickerFor, setKindPickerFor] = useState<{ taskId: string; current: TaskKind; x: number; y: number } | null>(null);
  const accessToken = useSessionStore((s) => s.accessToken);
  const showInfo = useToastStore((s) => s.showInfo);
  const showCategorize = useToastStore((s) => s.showCategorize);

  const toast = useCallback((msg: string): void => {
    showInfo(msg);
  }, [showInfo]);

  const refresh = useCallback(async () => {
    try {
      setTasks(await listTasks());
    } catch {
      /* keep stale */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // tasksRef — pinned to latest snapshot so SSE callback can pick taskTitle
  // without re-subscribing on every list update. Single read in handler;
  // closure stays stable.
  const tasksRef = useRef<TaskCard[]>([]);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // ESC для закрытия оверлеев
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setOpenTaskId(null);
      setCreateOpen(false);
      setCtx(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Скрытие ctx-меню при клике вне
  useEffect(() => {
    if (!ctx) return;
    const onClick = (): void => setCtx(null);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [ctx]);

  // SSE cursor stream
  useEffect(() => {
    if (!accessToken) return;
    const close = subscribeCursorEvents(accessToken, (e) => {
      cursorEventsRef.current = [...cursorEventsRef.current, e].slice(-32);
      setCursorEvents(cursorEventsRef.current);
      if (e.kind === 'card.move') window.setTimeout(() => void refresh(), 600);
      // Phase J / H3 — push «Auto-tagged as <kind>» toast when backend
      // categoriser emits a hint via SSE. Suppress low-confidence noise
      // (server-side gate also drops <0.4, this is a defensive client
      // floor against future server-side tuning).
      if (e.kind === 'card.categorise' && e.taskId && e.detectedKind) {
        const conf = typeof e.confidence === 'number' ? e.confidence : 0;
        if (conf >= 0.4 || e.body) {
          // Use the latest snapshot for taskTitle without putting `tasks`
          // в deps (would re-subscribe on every list refresh).
          const t = tasksRef.current.find((x) => x.id === e.taskId);
          showCategorize({
            taskId: e.taskId,
            taskTitle: t?.title ?? '(task)',
            detectedKind: e.detectedKind,
            reasoning: e.body ?? '',
            confidence: conf,
          });
          // Phase J / X3 — cross-product taxonomy. detectedKind +
          // confidence bucket. Never log task title (free-text).
          analytics.track(ANALYTICS_EVENTS.task_auto_categorised, {
            detected_kind: e.detectedKind,
            confidence_bucket: conf >= 0.8 ? 'high' : conf >= 0.6 ? 'med' : 'low',
          });
          // Optimistically reflect kind change в list (server already wrote).
          setTasks((prev) => prev.map((x) => (x.id === e.taskId ? { ...x, kind: e.detectedKind as TaskKind } : x)));
        }
      }
    });
    return () => close();
  }, [accessToken, refresh, showCategorize]);

  // Active study mode filter — задачи с skill_key вне выбранного track'а
  // скрываем. Mode 'general' = passthrough.
  const itemMatchesActive = useTrackStore((s) => s.itemMatchesActive);
  const loadAtlasTracks = useTrackStore((s) => s.loadAtlasTracks);
  useEffect(() => {
    void loadAtlasTracks();
  }, [loadAtlasTracks]);

  // Filter pipeline
  const visibleTasks = useMemo(() => {
    let arr = tasks.filter((t) => itemMatchesActive(t.skillKey ?? ''));
    if (tab === 'week') {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      arr = arr.filter((t) => {
        const ts = Date.parse(t.updatedAt || t.createdAt);
        return Number.isFinite(ts) && ts >= cutoff;
      });
    }
    // Phase J / H3 — kind filter chips. Empty set = passthrough (no filter).
    if (kindFilter.size > 0) {
      arr = arr.filter((t) => kindFilter.has(t.kind));
    }
    return arr;
  }, [tasks, tab, itemMatchesActive, kindFilter]);

  // uncategorised candidates count — shown в empty state CTA + bulk button.
  const autoEligibleCount = useMemo(() => {
    return tasks.filter((t) =>
      (t.status === 'todo' || t.status === 'in_progress' || t.status === 'in_review') &&
      !t.manualKindOverride,
    ).length;
  }, [tasks]);

  // ── Bulk auto-categorise ──────────────────────────────────────────────
  const handleBulkCategorise = useCallback(async () => {
    if (bulkProgress) return; // already running
    if (bulkAbortRef.current) bulkAbortRef.current.abort();
    const ctrl = new AbortController();
    bulkAbortRef.current = ctrl;
    setBulkProgress({ processed: 0, total: 0 });
    trackEvent('taskboard_bulk_categorise_start', { eligible: autoEligibleCount.toString() });
    try {
      await bulkAutoCategorise([], (ev) => {
        setBulkProgress({ processed: ev.processed, total: ev.total });
        if (ev.taskId && ev.kind && ev.reasoning) {
          const t = tasksRef.current.find((x) => x.id === ev.taskId);
          if (t && t.kind !== ev.kind) {
            // Optimistic local update — server already wrote it.
            setTasks((prev) => prev.map((x) => (x.id === ev.taskId ? { ...x, kind: ev.kind } : x)));
          }
          if (ev.confidence >= 0.4 && t) {
            showCategorize({
              taskId: ev.taskId,
              taskTitle: t.title,
              detectedKind: ev.kind,
              reasoning: ev.reasoning,
              confidence: ev.confidence,
            });
          }
        }
        if (ev.done) {
          setBulkProgress(null);
          showInfo(`Categorised ${ev.total} task${ev.total === 1 ? '' : 's'}`);
          trackEvent('taskboard_bulk_categorise_done', { total: ev.total.toString() });
        }
      }, ctrl.signal);
    } catch (err) {
      setBulkProgress(null);
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error && err.message ? err.message : 'Bulk categorise failed';
      showInfo(msg);
    } finally {
      if (bulkAbortRef.current === ctrl) bulkAbortRef.current = null;
    }
  }, [autoEligibleCount, bulkProgress, showCategorize, showInfo]);

  // ── Manual kind override (chip-picker on card) ─────────────────────────
  const handleOverrideKind = useCallback(
    async (taskId: string, nextKind: TaskKind) => {
      // Optimistic: write locally + flip manualKindOverride flag.
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, kind: nextKind, manualKindOverride: true } : t)),
      );
      trackEvent('taskboard_kind_override', { to_kind: nextKind });
      try {
        const updated = await updateTaskKind(taskId, nextKind, true);
        // Reconcile с сервером (в идеале — то же, но safe rewire).
        setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      } catch {
        // Revert on failure.
        showInfo('Override failed — reverted');
        void refresh();
      }
    },
    [refresh, showInfo],
  );

  const colsToShow = COLUMNS.filter((c) => c.status !== 'dismissed');

  const grouped = useMemo(() => {
    const m: Record<TaskStatus, TaskCard[]> = {
      todo: [], in_progress: [], in_review: [], done: [], dismissed: [],
    };
    for (const t of visibleTasks) m[t.status]?.push(t);
    return m;
  }, [visibleTasks]);

  async function handleMove(taskId: string, status: TaskStatus): Promise<void> {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await moveTaskStatus(taskId, status);
      trackEvent('taskboard_status_change', { to_status: status });
      const col = COLUMNS.find((c) => c.status === status);
      if (col) toast(`Moved to ${col.label}`);
    } catch {
      void refresh();
    }
  }

  async function handleDelete(taskId: string): Promise<void> {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      await deleteTask(taskId);
      toast('Task deleted');
    } catch {
      void refresh();
    }
  }

  async function handleCreate(input: {
    kind: TaskKind;
    title: string;
    briefMd: string;
    skillKey: string;
    priority: number;
  }): Promise<void> {
    try {
      const c = await createTask({
        kind: input.kind,
        title: input.title,
        briefMd: input.briefMd || undefined,
        skillKey: input.skillKey || undefined,
      });
      setTasks((prev) => [c, ...prev]);
      toast('Task created');
    } catch {
      toast('Failed to create');
    }
  }

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        padding: '64px 32px 28px', // 64px top — under draggable chrome / traffic lights
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TodayGoalSection />

      {/* Header — минимальный, tabs + bulk action + archive button */}
      <header style={{ ...hdrStyle, justifyContent: 'space-between' }}>
        <div role="tablist" aria-label="Task filter" style={{ display: 'flex', gap: 4 }}>
          {(['my', 'week'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              role="tab"
              aria-selected={tab === t}
              aria-pressed={tab === t}
              style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 6,
                border: '1px solid var(--ink-20)',
                background: tab === t ? 'var(--ink)' : 'transparent',
                color: tab === t ? 'var(--bg)' : 'var(--ink-60)',
                cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase',
                fontWeight: 500,
                transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
              }}
            >
              {t === 'my' ? 'My' : 'This week'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Phase J / H3 — bulk auto-categorise button. Hidden when no
              eligible tasks (already всё auto-tagged или manually-pinned).
              While running показываем progress chip «X / N». */}
          {(bulkProgress || autoEligibleCount > 0) && (
            <button
              onClick={() => {
                if (bulkProgress) {
                  bulkAbortRef.current?.abort();
                  setBulkProgress(null);
                  return;
                }
                void handleBulkCategorise();
              }}
              aria-label={bulkProgress ? 'Cancel bulk categorise' : 'Auto-categorise uncategorised tasks'}
              title={bulkProgress
                ? `Categorising… (${bulkProgress.processed}/${bulkProgress.total || '?'})`
                : `Auto-recategorise ${autoEligibleCount} uncategorised`}
              style={{
                fontSize: 11,
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid var(--ink-20)',
                background: bulkProgress ? 'rgba(255,255,255,0.04)' : 'transparent',
                color: 'var(--ink-60)',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {bulkProgress ? (
                <>
                  <span
                    style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: 'var(--ink-60)',
                      animation: 'pulse 1.4s ease-in-out infinite',
                    }}
                  />
                  {bulkProgress.processed}{bulkProgress.total > 0 ? `/${bulkProgress.total}` : ''}
                </>
              ) : (
                <>Auto-tag{autoEligibleCount > 0 ? ` ·${autoEligibleCount}` : ''}</>
              )}
            </button>
          )}

          {/* Archive trigger — shows count of dismissed tasks. */}
          <button
            onClick={() => setArchiveOpen(true)}
            aria-label="Open archive drawer"
            aria-expanded={archiveOpen}
            aria-haspopup="dialog"
            title="Архив завершённых / dismissed задач"
            style={{
              fontSize: 11,
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid var(--ink-20)',
              background: 'transparent',
              color: 'var(--ink-60)',
              cursor: 'pointer',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            Archive
            {tasks.filter((t) => t.status === 'dismissed').length > 0 && (
              <span
                style={{
                  background: 'var(--ink-20)',
                  color: 'var(--ink-90)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {tasks.filter((t) => t.status === 'dismissed').length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Phase J / H3 — Kind-filter chip row. cmd/ctrl+click = multi-select,
          plain click toggles. «All» chip resets. Hairline highlight when
          active (B/W rule: no fill). */}
      <div
        role="toolbar"
        aria-label="Filter by kind"
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 18,
          alignItems: 'center', minWidth: 0,
        }}
      >
        <button
          onClick={() => setKindFilter(new Set())}
          aria-pressed={kindFilter.size === 0}
          style={kindChipStyle(kindFilter.size === 0)}
        >
          All
        </button>
        {(['algo', 'sysdesign', 'quiz', 'reflection', 'reading', 'custom'] as TaskKind[]).map((k) => {
          const def = KINDS[k];
          const on = kindFilter.has(k);
          return (
            <button
              key={k}
              onClick={(e) => {
                const multi = e.metaKey || e.ctrlKey;
                const next = new Set(kindFilter);
                if (multi) {
                  if (next.has(k)) next.delete(k);
                  else next.add(k);
                } else {
                  if (on && next.size === 1) {
                    // toggle off — same chip clicked → All.
                    next.clear();
                  } else {
                    next.clear();
                    next.add(k);
                  }
                }
                setKindFilter(next);
              }}
              aria-pressed={on}
              title={`Filter by ${def.label} · cmd-click for multi-select`}
              style={kindChipStyle(on)}
            >
              <KindIcon kind={k} size={11} color={on ? def.color : 'currentColor'} />
              <span style={{ marginLeft: 4 }}>{def.label}</span>
            </button>
          );
        })}
      </div>

      {/* States */}
      {loading && (
        <p style={{ color: 'var(--ink-40)', textAlign: 'center', marginTop: 80 }}>Loading…</p>
      )}

      {!loading && visibleTasks.length === 0 && kindFilter.size === 0 && (
        <div style={emptyStyle}>
          <div style={emptyIconStyle}>✨</div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-60)', margin: 0 }}>
            No tasks yet
          </h2>
          <p style={{ fontSize: 13, maxWidth: 320, textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
            AI-coach анализирует твою активность и скоро предложит персональные задачи
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            style={{
              fontSize: 12, color: 'var(--ink-60)', cursor: 'pointer',
              textDecoration: 'underline', textUnderlineOffset: 2,
              background: 'none', border: 'none',
            }}
          >
            Создать первую задачу
          </button>
        </div>
      )}

      {/* Per-filter empty state — Phase J / H3 */}
      {!loading && visibleTasks.length === 0 && kindFilter.size > 0 && (
        <div style={emptyStyle}>
          <div style={emptyIconStyle}>
            {[...kindFilter].slice(0, 1).map((k) => (
              <KindIcon key={k} kind={k} size={22} />
            ))}
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-60)', margin: 0 }}>
            No tasks match the selected kind
            {kindFilter.size > 1 ? 's' : ''}
          </h2>
          <p style={{ fontSize: 12.5, maxWidth: 360, textAlign: 'center', lineHeight: 1.6, margin: 0, color: 'var(--ink-40)' }}>
            Click the kind chip on any card to retag it, or run «Auto-tag» to let AI re-categorise the {autoEligibleCount} open task{autoEligibleCount === 1 ? '' : 's'}.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setKindFilter(new Set())}
              style={{
                fontSize: 12, color: 'var(--ink-60)', cursor: 'pointer',
                textDecoration: 'underline', textUnderlineOffset: 2,
                background: 'none', border: 'none',
              }}
            >
              Clear filter
            </button>
            {autoEligibleCount > 0 && !bulkProgress && (
              <button
                onClick={() => void handleBulkCategorise()}
                style={{
                  fontSize: 12, color: 'var(--ink-60)', cursor: 'pointer',
                  textDecoration: 'underline', textUnderlineOffset: 2,
                  background: 'none', border: 'none',
                }}
              >
                Auto-tag {autoEligibleCount} task{autoEligibleCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Board */}
      {!loading && visibleTasks.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${colsToShow.length}, minmax(0, 1fr))`,
            gap: 12, flex: 1, alignItems: 'start', minHeight: 0,
          }}
        >
          {colsToShow.map((c) => (
            <Column
              key={c.status}
              col={c}
              tasks={grouped[c.status] ?? []}
              onDropTask={(id) => void handleMove(id, c.status)}
              onCardClick={(id) => setOpenTaskId(id)}
              onCtxMenu={(e, id) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, taskId: id });
              }}
              onOpenKindPicker={(taskId, current, x, y) =>
                setKindPickerFor({ taskId, current, x, y })}
            />
          ))}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setCreateOpen(true)}
        aria-label="Add task"
        style={{
          position: 'fixed', bottom: 28, right: 28, width: 44, height: 44, borderRadius: 12,
          background: 'var(--ink)', color: 'var(--bg)', border: 'none', fontSize: 22,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 100, fontWeight: 300,
          lineHeight: 1, paddingBottom: 4,
        }}
      >
        +
      </button>

      {/* Phase J / H3 — toasts mounted globally in App.tsx via
          <CategorizeToastContainer />. TaskBoard pushes via useToastStore. */}

      {/* Context menu */}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          task={tasks.find((t) => t.id === ctx.taskId)}
          onMove={(s) => { void handleMove(ctx.taskId, s); setCtx(null); }}
          onDelete={() => { void handleDelete(ctx.taskId); setCtx(null); }}
          onClose={() => setCtx(null)}
        />
      )}

      {/* Drawer */}
      {openTaskId && (
        <TaskDrawer
          taskId={openTaskId}
          task={tasks.find((t) => t.id === openTaskId)}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      {/* Modal */}
      {createOpen && (
        <CreateTaskModal
          onClose={() => setCreateOpen(false)}
          onSubmit={async (input) => {
            await handleCreate(input);
            setCreateOpen(false);
          }}
        />
      )}

      {/* R4 (Phase A 2026-05-12) — Archive drawer. Right-slide overlay
          с dismissed tasks. Restore = move back to 'todo'. Delete =
          hard remove. */}
      {archiveOpen && (
        <ArchiveDrawer
          tasks={tasks.filter((t) => t.status === 'dismissed')}
          onClose={() => setArchiveOpen(false)}
          onRestore={(id) => void handleMove(id, 'todo')}
          onDelete={(id) => void handleDelete(id)}
        />
      )}

      {/* Phase J / H3 — manual kind override picker, opened from the
          card chip or from CategorizeToast «Set to…» button. */}
      {kindPickerFor && (
        <KindPicker
          current={kindPickerFor.current}
          anchor={{ x: kindPickerFor.x, y: kindPickerFor.y }}
          onClose={() => setKindPickerFor(null)}
          onPick={(next) => {
            const taskId = kindPickerFor.taskId;
            setKindPickerFor(null);
            void handleOverrideKind(taskId, next);
          }}
        />
      )}

      <AICursor events={cursorEvents} />
      {/* Local keyframe for the bulk-action pulse dot — avoids spilling
          into globals.css for a one-off. */}
      <style>{`@keyframes pulse {
        0%, 100% { opacity: 0.4; transform: scale(0.85); }
        50%      { opacity: 1;   transform: scale(1.15); }
      }`}</style>
    </div>
  );
}

// ── Styles (объекты вынесены, чтобы JSX был читаемее) ──────────────────

const hdrStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: 24, flexWrap: 'wrap', gap: 12,
};

const emptyStyle: CSSProperties = {
  flex: 1, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 16,
  color: 'var(--ink-40)', padding: '80px 0',
};

const emptyIconStyle: CSSProperties = {
  width: 56, height: 56, borderRadius: 14, background: 'var(--surface-2)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
};

// kindChipStyle — single source for filter chip styling so active /
// inactive states stay symmetric. B/W rule: active chip uses hairline
// outline + faint background, no fill.
function kindChipStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    fontSize: 10.5,
    fontWeight: 500,
    letterSpacing: '0.04em',
    borderRadius: 6,
    border: `1px solid ${active ? 'var(--ink-40)' : 'rgba(255,255,255,0.08)'}`,
    background: active ? 'rgba(255,255,255,0.045)' : 'transparent',
    color: active ? 'var(--ink)' : 'var(--ink-60)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
  };
}


// ── Column ─────────────────────────────────────────────────────────────

interface ColumnProps {
  col: ColumnDef;
  tasks: TaskCard[];
  onDropTask: (taskId: string) => void;
  onCardClick: (id: string) => void;
  onCtxMenu: (e: React.MouseEvent, id: string) => void;
  onOpenKindPicker: (taskId: string, current: TaskKind, x: number, y: number) => void;
}

function Column({ col, tasks, onDropTask, onCardClick, onCtxMenu, onOpenKindPicker }: ColumnProps): JSX.Element {
  const [over, setOver] = useState(false);
  return (
    <section
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => {
        // Only clear if leaving the column entirely (not entering a child).
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/task-id');
        if (id) onDropTask(id);
      }}
      style={{
        background: over ? 'var(--surface-2)' : 'var(--surface)',
        // Polish — 1.5px red stripe (#FF3B30) along top edge when dragOver.
        // Conforms feedback_color_rule.md: red as a stripe, not bg.
        borderTop: over ? '1.5px solid #FF3B30' : '1px solid rgba(255,255,255,0.045)',
        borderRight: `1px solid ${over ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
        borderBottom: `1px solid ${over ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
        borderLeft: `1px solid ${over ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
        borderRadius: 10, display: 'flex', flexDirection: 'column',
        minHeight: 380, transition: 'background-color var(--motion-dur-medium) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
      }}
    >
      <header style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 7, height: 7, borderRadius: '50%', background: col.accent,
              boxShadow: `0 0 5px ${col.accent}`, flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-60)' }}>
            {col.label}
          </span>
        </div>
        <span style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-40)' }}>
          {tasks.length}
        </span>
      </header>
      <div style={{ flex: 1, padding: '4px 8px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {tasks.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-40)', fontSize: 11, opacity: 0.45, padding: '24px 0' }}>
            —
          </div>
        ) : (
          tasks.map((t) => (
            <TaskCardView
              key={t.id}
              task={t}
              onClick={() => onCardClick(t.id)}
              onCtxMenu={(e) => onCtxMenu(e, t.id)}
              onOpenKindPicker={onOpenKindPicker}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ── Card ───────────────────────────────────────────────────────────────

interface TaskCardViewProps {
  task: TaskCard;
  onClick: () => void;
  onCtxMenu: (e: React.MouseEvent) => void;
  onOpenKindPicker: (taskId: string, current: TaskKind, x: number, y: number) => void;
}

// Local-only title overrides — backend пока не имеет updateTaskTitle RPC,
// поэтому inline-edit персистится в localStorage и накладывается поверх
// серверного title'а на следующем render'е. Когда appears RPC — этот
// override-слой убирается + replace'ится server-side patch'ем.
//
// Sergey 2026-05-12: соблюдает offline-first rule — write локальная,
// никуда не отправляется, синхронизация будет позже когда добавим RPC.
const TITLE_OVERRIDE_KEY = 'hone:taskTitleOverride:v1';
function readTitleOverrides(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(TITLE_OVERRIDE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function writeTitleOverride(taskId: string, title: string): void {
  try {
    const map = readTitleOverrides();
    if (title.trim() && title.trim() !== '') {
      map[taskId] = title.trim();
    } else {
      delete map[taskId];
    }
    window.localStorage.setItem(TITLE_OVERRIDE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage quota / private mode — silently drop */
  }
}

function TaskCardView({ task, onClick, onCtxMenu, onOpenKindPicker }: TaskCardViewProps): JSX.Element {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  // Title state — initial = override if present, иначе server title.
  const [localTitle, setLocalTitle] = useState<string>(() => {
    const ov = readTitleOverrides();
    return ov[task.id] ?? task.title;
  });
  // Sync с сервером когда тот меняет title'и (например на refresh) и
  // у нас нет override для этой карточки.
  useEffect(() => {
    const ov = readTitleOverrides();
    if (!(task.id in ov)) setLocalTitle(task.title);
  }, [task.id, task.title]);
  const k = KINDS[task.kind];
  const aiPulse = task.status === 'in_review' && task.source === 'ai';

  const commitTitle = (next: string): void => {
    const trimmed = next.trim();
    if (!trimmed) {
      // Пустой title — cancel edit, восстанавливаем последнее значение.
      setEditing(false);
      return;
    }
    setLocalTitle(trimmed);
    writeTitleOverride(task.id, trimmed);
    setEditing(false);
  };

  return (
    <article
      // data-task-id — anchor для AICursor overlay'а: компонент ищет
      // карточку через document.querySelector('[data-task-id="..."]')
      // и центрирует курсор в её bounding-box. Без этого атрибута SSE
      // сработает (event придёт), но визуально курсор не переместится.
      data-task-id={task.id}
      // draggable отключаем во время edit'а — иначе Электрон/Chromium
      // снимает focus с <input> при mousedown и Enter/Escape не доедут.
      draggable={!editing}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
        // Polish — custom ghost: clone current card, fade + scale, attach
        // off-screen, hand to dataTransfer.setDragImage. Browser renders
        // the clone instead of the default fullsize screenshot, then
        // garbage-collects it after dragend tick.
        const src = e.currentTarget as HTMLElement;
        const ghost = src.cloneNode(true) as HTMLElement;
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        ghost.style.left = '-1000px';
        ghost.style.width = `${src.offsetWidth}px`;
        ghost.style.opacity = '0.85';
        ghost.style.transform = 'rotate(-1.5deg) scale(0.98)';
        ghost.style.boxShadow = '0 6px 24px rgba(0,0,0,0.45)';
        ghost.style.pointerEvents = 'none';
        ghost.style.background = 'var(--surface-2)';
        document.body.appendChild(ghost);
        try {
          e.dataTransfer.setDragImage(ghost, 20, 14);
        } catch {
          // Some browsers/Electron versions throw on detached nodes — fail
          // silently and fall back to default ghost.
        }
        // Clean up after the browser has snapshotted the node.
        window.setTimeout(() => { ghost.remove(); }, 0);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={(e) => {
        if (editing) return; // не открываем drawer пока редактируем title
        if ((e.target as HTMLElement).closest('[data-stop]')) return;
        onClick();
      }}
      onContextMenu={onCtxMenu}
      style={{
        display: 'flex', borderRadius: 7,
        background: hover ? 'var(--surface-2)' : 'rgba(255,255,255,0.025)',
        cursor: dragging ? 'grabbing' : 'grab',
        position: 'relative',
        opacity: dragging ? 0.35 : 1,
        transform: dragging ? 'scale(0.97)' : hover ? 'translateY(-1px)' : 'none',
        boxShadow: hover ? '0 2px 12px rgba(0,0,0,0.25)' : 'none',
        transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), box-shadow var(--motion-dur-medium) var(--motion-ease-standard), transform var(--motion-dur-medium) var(--motion-ease-standard)',
      }}
    >
      <span style={{ width: 3, borderRadius: '7px 0 0 7px', flexShrink: 0, background: k.color }} />
      <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
          {editing ? (
            <input
              data-stop
              autoFocus
              defaultValue={localTitle}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => commitTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false); // отменяем без сохранения
                }
              }}
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.4,
                color: 'var(--ink)',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--ink-40)',
                outline: 'none',
                padding: 0,
                fontFamily: 'inherit',
                minWidth: 0,
              }}
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                // Double-click = edit; останавливаем propagation чтобы
                // drawer onClick не сработал.
                e.stopPropagation();
                setEditing(true);
              }}
              title="Double-click — переименовать"
              style={{
                flex: 1,
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.4,
                color: 'var(--ink)',
                cursor: 'text',
              }}
            >
              {localTitle}
            </span>
          )}
          {/* Phase J / H3 — kind chip is now a button: click → KindPicker
              for manual override. data-stop prevents the card-level click
              from opening the drawer. */}
          <button
            data-stop
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onOpenKindPicker(task.id, task.kind, r.right + 4, r.top);
            }}
            aria-label={`Kind: ${KINDS[task.kind].label}${task.manualKindOverride ? ' (manually set)' : ''}. Click to change.`}
            title={task.manualKindOverride ? 'Kind set manually · click to change' : 'Auto-tagged · click to override'}
            style={{
              marginTop: 1,
              padding: 2,
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              flexShrink: 0,
              opacity: 0.85,
            }}
          >
            <KindIcon kind={task.kind} size={12} />
            {task.manualKindOverride && (
              <span
                aria-hidden
                style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: '#FF3B30',
                  flexShrink: 0,
                }}
                title="Manually set (won't auto-recategorise)"
              />
            )}
          </button>
        </div>
        {task.briefMd && (
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--ink-40)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 8 }}>
            {task.briefMd}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {task.skillKey && (
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-60)' }}>
              {task.skillKey}
            </span>
          )}
          {task.priority > 0 && (
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              {Array.from({ length: Math.min(task.priority, 3) }).map((_, i) => (
                <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--ink-40)' }} />
              ))}
            </div>
          )}
          <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>{relativeAge(task.createdAt)}</span>
          {task.source === 'ai' ? (
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', padding: '1px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.10)', color: 'rgb(var(--ink))' }}>
              AI
            </span>
          ) : (
            <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>you</span>
          )}
          {task.deepLink && (
            <button
              data-stop
              onClick={() => window.open(task.deepLink, '_blank')}
              title="Open"
              style={{
                marginLeft: 'auto', minWidth: 28, minHeight: 28, width: 28, height: 28, borderRadius: 5, border: 'none',
                background: 'rgba(255,255,255,0.06)', color: 'var(--ink-40)',
                fontSize: 10, cursor: 'pointer', opacity: hover ? 1 : 0,
                transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              →
            </button>
          )}
        </div>
      </div>
      {aiPulse && (
        <span
          style={{
            position: 'absolute', inset: 0, borderRadius: 7, pointerEvents: 'none',
            animation: 'aiPulseHone 2.5s ease-in-out infinite',
          }}
        />
      )}
      <style>{`@keyframes aiPulseHone {
        0%, 100% { background: rgba(56,189,248,0); }
        50% { background: rgba(56,189,248,0.04); }
      }`}</style>
    </article>
  );
}

// ── Context Menu ───────────────────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  task: TaskCard | undefined;
  onMove: (s: TaskStatus) => void;
  onDelete: () => void;
  onClose: () => void;
}

function ContextMenu({ x, y, task, onMove, onDelete }: ContextMenuProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let nx = x, ny = y;
    if (r.right > window.innerWidth) nx = x - r.width;
    if (r.bottom > window.innerHeight) ny = y - r.height;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  if (!task) return null;
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed', left: pos.x, top: pos.y, zIndex: 300,
        background: 'var(--surface-2)', border: '1px solid var(--ink-20)',
        borderRadius: 8, padding: 4, minWidth: 180,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)', animation: 'fadein var(--motion-dur-small) var(--motion-ease-standard)',
      }}
    >
      {COLUMNS.filter((c) => c.status !== task.status).map((c) => (
        <button key={c.status} onClick={() => onMove(c.status)} style={ctxBtnStyle}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.accent, marginRight: 4 }} />
          Move to {c.label}
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--ink-20)', margin: '4px 8px' }} />
      <button
        onClick={() => { if (confirm('Удалить задачу?')) onDelete(); }}
        style={{ ...ctxBtnStyle, color: 'var(--red)' }}
      >
        🗑 Delete
      </button>
    </div>
  );
}

const ctxBtnStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
  fontSize: 12, color: 'var(--ink-60)', cursor: 'pointer', borderRadius: 5,
  border: 'none', background: 'none', width: '100%', fontFamily: 'inherit',
  textAlign: 'left',
};

// ── Drawer ─────────────────────────────────────────────────────────────

interface TaskDrawerProps {
  taskId: string;
  task: TaskCard | undefined;
  onClose: () => void;
}

function TaskDrawer({ taskId, task, onClose }: TaskDrawerProps): JSX.Element | null {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    void listTaskComments(taskId).then((c) => { if (alive) setComments(c); }).catch(() => {});
    return () => { alive = false; };
  }, [taskId]);

  if (!task) return null;
  const k = KINDS[task.kind];
  const c = COLUMNS.find((x) => x.status === task.status);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      const created = await addTaskComment(taskId, body.trim());
      setComments((p) => [...p, created]);
      setBody('');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400 }}
      />
      <aside
        style={{
          position: 'fixed', top: 0, right: 0, width: 420, maxWidth: '100vw', height: '100vh',
          background: 'var(--surface)', borderLeft: '1px solid var(--ink-20)', zIndex: 401,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'drawerIn var(--motion-dur-large) var(--motion-ease-emphasized)',
        }}
      >
        <header style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--ink-20)', flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-60)' }}>{c?.label ?? ''}</span>
          <button
            onClick={onClose}
            aria-label="Close task details"
            style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: 'none', color: 'var(--ink-40)', cursor: 'pointer', fontSize: 16 }}
          >
            ×
          </button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <div style={{ width: 32, height: 4, borderRadius: 2, background: k.color, marginBottom: 12 }} />
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-40)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            {k.label}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35, marginBottom: 16, letterSpacing: '-0.2px' }}>
            {task.title}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            <Meta label="Status" value={c?.label ?? ''} />
            <Meta label="Created" value={`${relativeAge(task.createdAt)} ago`} />
            <Meta label="Source" value={task.source === 'ai' ? 'AI Coach' : 'You'} />
            {task.skillKey && <Meta label="Skill" value={task.skillKey} />}
          </div>

          <div style={{ height: 1, background: 'var(--ink-20)', margin: '16px 0' }} />

          {task.briefMd && (
            <p style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--ink-60)', margin: 0 }}>
              {task.briefMd}
            </p>
          )}

          {task.deepLink && (
            <a href={task.deepLink} style={{ display: 'inline-block', marginTop: 12, fontSize: 12, color: 'var(--ink-60)', textDecoration: 'underline' }}>
              Открыть →
            </a>
          )}

          <div style={{ height: 1, background: 'var(--ink-20)', margin: '16px 0' }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-60)', marginBottom: 12 }}>
            Comments {comments.length}
          </div>

          {comments.map((cm) => (
            <div key={cm.id} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ink-40)', flexShrink: 0 }}>
                {cm.authorKind === 'ai' ? '🤖' : '👤'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-60)', marginBottom: 2 }}>
                  {cm.authorKind === 'ai' ? 'AI Coach' : 'Ты'}
                  <time style={{ fontWeight: 400, color: 'var(--ink-40)', marginLeft: 6 }}>
                    {cm.createdAt.slice(0, 10)}
                  </time>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-60)' }}>{cm.bodyMd}</div>
              </div>
            </div>
          ))}

          {comments.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--ink-40)', textAlign: 'center', padding: '12px 0' }}>
              Комментариев пока нет
            </p>
          )}

          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Add a comment..."
              style={{
                flex: 1, padding: '8px 12px', background: 'var(--surface-2)',
                border: '1px solid var(--ink-20)', borderRadius: 6, color: 'var(--ink)',
                fontFamily: 'inherit', fontSize: 12, outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={!body.trim() || sending}
              style={{
                padding: '8px 14px', background: 'var(--surface-2)',
                border: '1px solid var(--ink-20)', borderRadius: 6, color: 'var(--ink-60)',
                fontFamily: 'inherit', fontSize: 11, fontWeight: 500, cursor: 'pointer',
                opacity: !body.trim() || sending ? 0.5 : 1,
              }}
            >
              {sending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      </aside>
      <style>{`@keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ fontSize: 11, color: 'var(--ink-40)', display: 'flex', alignItems: 'center', gap: 4 }}>
      {label}: <span style={{ color: 'var(--ink-60)' }}>{value}</span>
    </div>
  );
}

// ── Modal: Linear-стиль, компактный ────────────────────────────────────

// ── R4 ArchiveDrawer ──────────────────────────────────────────────────

interface ArchiveDrawerProps {
  tasks: TaskCard[];
  onClose: () => void;
  onRestore: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

function ArchiveDrawer({ tasks, onClose, onRestore, onDelete }: ArchiveDrawerProps): JSX.Element {
  // Sort newest-first by updatedAt fallback createdAt.
  const sorted = [...tasks].sort((a, b) => {
    const at = Date.parse(a.updatedAt || a.createdAt);
    const bt = Date.parse(b.updatedAt || b.createdAt);
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });

  // ESC closes drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 500,
          animation: 'fadein var(--motion-dur-medium) var(--motion-ease-standard)',
        }}
      />
      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-label="Archive drawer"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(420px, 95vw)',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--ink-20)',
          zIndex: 501,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight var(--motion-dur-medium) var(--motion-ease-standard)',
        }}
      >
        <header
          style={{
            padding: '20px 24px 14px',
            borderBottom: '1px solid var(--hair)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <p
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-40)',
                margin: 0,
                marginBottom: 4,
              }}
            >
              Архив · dismissed
            </p>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-90)', margin: 0 }}>
              {sorted.length === 0
                ? 'Архив пуст'
                : `${sorted.length} ${pluralArchive(sorted.length)}`}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close archive"
            style={{
              background: 'transparent',
              border: '1px solid var(--ink-20)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              color: 'var(--ink-60)',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            esc
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px 24px' }}>
          {sorted.length === 0 ? (
            <p
              style={{
                fontSize: 12.5,
                color: 'var(--ink-40)',
                fontStyle: 'italic',
                lineHeight: 1.6,
                margin: 0,
                marginTop: 24,
              }}
            >
              Сюда попадают задачи отмеченные как dismissed. Restore возвращает в To Do — не теряем
              workflow когда оказывается «нет, это нужно».
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sorted.map((t) => (
                <li
                  key={t.id}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--surface-1)',
                    border: '1px solid var(--hair)',
                    borderRadius: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <KindIcon kind={t.kind} size={13} />
                    <span style={{ fontSize: 13, color: 'var(--ink-90)', flex: 1, lineHeight: 1.4 }}>
                      {t.title}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 10,
                      color: 'var(--ink-40)',
                    }}
                  >
                    <span>
                      {KINDS[t.kind].label} · {relativeAge(t.updatedAt || t.createdAt)}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => onRestore(t.id)}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--ink-20)',
                          borderRadius: 4,
                          padding: '3px 8px',
                          fontSize: 10,
                          color: 'var(--ink-60)',
                          cursor: 'pointer',
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                        }}
                      >
                        restore
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('Удалить навсегда?')) onDelete(t.id);
                        }}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--ink-20)',
                          borderRadius: 4,
                          padding: '3px 8px',
                          fontSize: 10,
                          color: 'var(--ink-40)',
                          cursor: 'pointer',
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                        }}
                      >
                        delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

function pluralArchive(n: number): string {
  if (n === 1) return 'задача';
  if (n >= 2 && n <= 4) return 'задачи';
  return 'задач';
}

interface CreateModalProps {
  onClose: () => void;
  onSubmit: (input: { kind: TaskKind; title: string; briefMd: string; skillKey: string; priority: number }) => Promise<void>;
}

const CREATE_KINDS: TaskKind[] = ['algo', 'sysdesign', 'quiz', 'reflection', 'reading', 'custom'];

function CreateTaskModal({ onClose, onSubmit }: CreateModalProps): JSX.Element {
  const [title, setTitle] = useState('');
  const [briefMd, setBriefMd] = useState('');
  const [kind, setKind] = useState<TaskKind>('custom');
  const [priority, setPriority] = useState(2);
  const [skillKey, setSkillKey] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  // Exit-анимация: ставим closing=true, ждём пока CSS-keyframes доиграют,
  // потом дёргаем onClose у родителя — иначе компонент unmount'ится сразу
  // и анимацию никто не увидит.
  function startClose(): void {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ kind, title: title.trim(), briefMd, skillKey, priority });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) startClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh', paddingLeft: 16, paddingRight: 16,
        animation: closing ? 'modalOverlayOut var(--motion-dur-medium) var(--motion-ease-standard) forwards' : 'modalOverlayIn var(--motion-dur-medium) var(--motion-ease-standard)',
      }}
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); startClose(); return; }
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { void submit(e); }
        }}
        style={{
          width: 520, maxWidth: '92vw', display: 'flex', flexDirection: 'column', gap: 12,
          background: 'var(--surface)', border: '1px solid var(--ink-20)',
          borderRadius: 12, padding: 18, boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
          animation: closing
            ? 'modalOut var(--motion-dur-medium) var(--motion-ease-accelerate) forwards'
            : 'modalIn var(--motion-dur-medium) var(--motion-ease-emphasized)',
          willChange: 'transform, opacity',
        }}
      >
        <input
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что нужно сделать?"
          required
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--ink)', fontSize: 16, fontWeight: 600,
            fontFamily: 'inherit', padding: 0,
          }}
        />
        <textarea
          value={briefMd}
          onChange={(e) => setBriefMd(e.target.value)}
          placeholder="Описание (опционально)"
          rows={2}
          style={{
            background: 'transparent', border: 'none', outline: 'none', resize: 'none',
            color: 'var(--ink-60)', fontSize: 14, lineHeight: 1.5,
            fontFamily: 'inherit', padding: 0,
          }}
        />

        <div role="radiogroup" aria-label="Task kind" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {CREATE_KINDS.map((k) => {
            const def = KINDS[k];
            const on = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                role="radio"
                aria-checked={on}
                aria-pressed={on}
                className="tb-kind-chip"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 11px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                  border: `1px solid ${on ? 'var(--ink-20)' : 'rgba(255,255,255,0.045)'}`,
                  background: on ? 'var(--surface-2)' : 'transparent',
                  color: on ? 'var(--ink)' : 'var(--ink-40)',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <KindIcon kind={k} size={13} color={on ? def.color : 'currentColor'} />
                {def.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--ink-40)' }}>
          <span id="priority-label">Priority</span>
          <div role="radiogroup" aria-labelledby="priority-label" style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPriority(n)}
                role="radio"
                aria-checked={n === priority}
                aria-pressed={n === priority}
                aria-label={n === 1 ? 'Low priority' : n === 2 ? 'Medium priority' : 'High priority'}
                title={n === 1 ? 'Low' : n === 2 ? 'Medium' : 'High'}
                style={{
                  width: 6, height: 6, borderRadius: '50%', border: 'none',
                  background: n <= priority ? 'var(--ink)' : 'var(--ink-20)',
                  cursor: 'pointer', padding: 0,
                }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            aria-controls="task-skill-input"
            style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-40)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {showMore ? 'Скрыть' : 'Дополнительно'}
          </button>
        </div>

        {showMore && (
          <input
            id="task-skill-input"
            value={skillKey}
            onChange={(e) => setSkillKey(e.target.value)}
            placeholder="Skill tag (например, Binary Search)"
            style={{
              padding: '7px 10px', background: 'var(--surface-2)',
              border: '1px solid var(--ink-20)', borderRadius: 6,
              color: 'var(--ink)', fontFamily: 'inherit', fontSize: 12, outline: 'none',
            }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--ink-20)', paddingTop: 12, marginTop: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--ink-40)' }}>
            ⌘↵ — отправить · Esc — закрыть
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={startClose}
              className="tb-modal-btn-ghost"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!title.trim() || submitting}
              className="tb-modal-btn-primary"
            >
              {submitting ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </div>
      </form>
      <style>{`
        @keyframes modalOverlayIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalOverlayOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes modalOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(-8px) scale(0.97); }
        }
        .tb-modal-btn-ghost {
          padding: 7px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          background: var(--surface-2);
          border: 1px solid var(--ink-20);
          color: var(--ink-60);
          cursor: pointer;
          font-family: inherit;
          transition: background var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard);
        }
        .tb-modal-btn-ghost:hover {
          background: rgba(255,255,255,0.05);
          color: var(--ink);
          border-color: var(--ink-40);
        }
        .tb-modal-btn-ghost:active { transform: scale(0.97); }
        .tb-modal-btn-primary {
          padding: 7px 18px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          background: var(--ink);
          color: var(--bg);
          border: none;
          cursor: pointer;
          font-family: inherit;
          transition: opacity var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard), box-shadow var(--motion-dur-small) var(--motion-ease-standard);
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
        .tb-modal-btn-primary:hover:not(:disabled) {
          opacity: 0.92;
          box-shadow: 0 4px 14px rgba(255,255,255,0.12);
          transform: translateY(-1px);
        }
        .tb-modal-btn-primary:active:not(:disabled) { transform: scale(0.97) translateY(0); }
        .tb-modal-btn-primary:disabled { opacity: 0.4; cursor: default; }
        .tb-kind-chip { transition: background var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard); }
        .tb-kind-chip:hover { border-color: var(--ink-20); color: var(--ink); }
        .tb-kind-chip:active { transform: scale(0.97); }
      `}</style>
    </div>
  );
}
