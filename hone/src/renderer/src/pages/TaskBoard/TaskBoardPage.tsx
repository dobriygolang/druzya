// TaskBoard — Notion-style kanban в Hone (electron renderer).
//
// Дизайн натянут с design/index.html: цветной strip per-kind, kind-icon,
// priority dots, age, AI/user badge, side-drawer с комментариями,
// context-menu по правому клику, FAB → modal (Linear-стиль), footer с
// прогрессом и часами. Цвета через --ink/--bg/--surface CSS-vars.
//
// Топ-паддинг 64px чтобы под traffic-lights / draggable header не
// уезжали title и FAB.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listTasks,
  createTask,
  moveTaskStatus,
  deleteTask,
  updateTaskKind,
  bulkAutoCategorise,
  subscribeCursorEvents,
  type TaskCard,
  type TaskKind,
  type TaskStatus,
  type CursorEvent,
} from '../../api/tasks';
import { AICursor } from '../../components/AICursor';
import { KindPicker } from '../../components/taskboard/KindPicker';
import { useSessionStore } from '../../stores/session';
import { useToastStore } from '../../stores/toast';
import { useTrackStore } from '../../stores/track';
import { TodayGoalSection } from '../Today';
import { MyTutorsRail } from '../../components/MyTutorsRail';
import { trackEvent } from '../../api/events';
import { analytics, ANALYTICS_EVENTS } from '../../lib/analytics';
import { TasksSuggestionsCard } from '../../components/taskboard/TasksSuggestionsCard';
import { COLUMNS, type TabKey } from './lib/columns';
import { KINDS, KindIcon, readKindFilter, writeKindFilter } from './lib/kinds';
import { hdrStyle, emptyStyle, emptyIconStyle, kindChipStyle } from './lib/styles';
import { Column } from './Column';
import { ContextMenu } from './ContextMenu';
import { TaskDrawer } from './TaskDrawer';
import { ArchiveDrawer } from './ArchiveDrawer';
import { CreateTaskModal } from './CreateTaskModal';

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

      {/* Phase K T6 (2026-05-12) — compact tutor social-proof rail.
          Hidden when zero tutors. One-line summary, dock-mono rhythm. */}
      <div style={{ marginTop: 12 }}>
        <MyTutorsRail />
      </div>

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
        {(['algo', 'sysdesign', 'quiz', 'reflection', 'reading', 'ml', 'custom'] as TaskKind[]).map((k) => {
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

      {/* Phase K Wave 15 — Coach reads recent notes (last 7d, AI-readable
          only) и предлагает добавить in-line action-items как задачи.
          Card сама прячется когда нет suggestions / LLM не wired. */}
      {!loading && <TasksSuggestionsCard onAccepted={() => void refresh()} />}

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
