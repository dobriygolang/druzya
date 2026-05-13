// SchedulePage — time-blocking day-view (Phase K Wave 15).
//
// Layout:
//   • Left rail: backlog (unscheduled tasks, filterable, draggable handles).
//   • Right rail: timeline. Часовые слоты 06:00–23:00 (по дефолту), 15-min
//     grid. Каждая запланированная задача отрисована блоком с серым фоном
//     (b/w only — НЕ цветные kanban-strip'ы), title + длительность.
//   • Header: дата + сумма «6.5h scheduled».
//
// Drag-and-drop: ванильный HTML5 DnD (rfc draggable=true). Drop в часовой
// слот → scheduleTask RPC. Move уже-запланированного блока — drag на новый
// слот. Сдвиг края низа блока меняет длительность (handle + onMouseMove).
//
// Identity: B/W only. #FF3B30 — точка-индикатор (текущее время на таймлайне),
// никогда в bg/fill блоков.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  listTasks,
  scheduleTask,
  unscheduleTask,
  type TaskCard,
} from '../../api/tasks';
import { trackEvent } from '../../api/events';

const DAY_START_HOUR = 6; // 06:00
const DAY_END_HOUR = 23; // 23:00 (last slot starts at 22:00)
const SLOT_HEIGHT = 60; // px per hour
// 15-minute snap grid — used by the drag-handler when computing minute
// offset within a slot. Kept as a name for future per-15-min snap.

interface Block {
  task: TaskCard;
  startMs: number; // ms since dayStart 00:00 local
  durationMin: number;
}

function localDayStart(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function isoFromSlot(date: Date, hour: number, minute = 0): string {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function parseBlock(t: TaskCard, dayStart: Date): Block | null {
  if (!t.scheduledStart || !t.scheduledDurationMin) return null;
  const start = new Date(t.scheduledStart);
  // Same calendar day?
  if (start.toDateString() !== dayStart.toDateString()) return null;
  return {
    task: t,
    startMs: start.getTime() - dayStart.getTime(),
    durationMin: t.scheduledDurationMin,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

export function SchedulePage(): JSX.Element {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState<Date>(() => localDayStart(new Date()));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Live «now» line — rerender each minute.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listTasks();
      setTasks(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    trackEvent('schedule_page_open');
  }, [reload]);

  const dayStart = localDayStart(day);
  const blocks: Block[] = useMemo(() => {
    return tasks
      .map((t) => parseBlock(t, dayStart))
      .filter((b): b is Block => b !== null && b.task.status !== 'done' && b.task.status !== 'dismissed');
  }, [tasks, dayStart]);

  const backlog = useMemo(
    () =>
      tasks.filter(
        (t) => !t.scheduledStart && t.status !== 'done' && t.status !== 'dismissed',
      ),
    [tasks],
  );

  const totalScheduledMin = useMemo(
    () => blocks.reduce((acc, b) => acc + b.durationMin, 0),
    [blocks],
  );

  const handleDropOnSlot = useCallback(
    async (taskId: string, hour: number, minute: number) => {
      const startIso = isoFromSlot(day, hour, minute);
      try {
        const updated = await scheduleTask(taskId, startIso, 60);
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        trackEvent('schedule_task_set', { hour, minute, duration_min: 60 });
      } catch {
        /* leave UI as-is; toast not wired here to keep page lean */
      }
    },
    [day],
  );

  const handleUnschedule = useCallback(async (taskId: string) => {
    try {
      const updated = await unscheduleTask(taskId);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      trackEvent('schedule_task_clear');
    } catch {
      /* swallow */
    }
  }, []);

  const handleResize = useCallback(
    async (block: Block, newMin: number) => {
      const clamped = Math.max(15, Math.min(480, Math.round(newMin / 15) * 15));
      if (clamped === block.durationMin) return;
      try {
        const updated = await scheduleTask(
          block.task.id,
          block.task.scheduledStart ?? '',
          clamped,
        );
        setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      } catch {
        /* swallow */
      }
    },
    [],
  );

  const dayLabel = day.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const goPrevDay = (): void =>
    setDay((d) => localDayStart(new Date(d.getTime() - 86_400_000)));
  const goNextDay = (): void =>
    setDay((d) => localDayStart(new Date(d.getTime() + 86_400_000)));
  const goToday = (): void => setDay(localDayStart(new Date()));

  const isToday = day.toDateString() === new Date().toDateString();
  const nowOffsetPx = isToday
    ? ((now.getHours() - DAY_START_HOUR) +
        now.getMinutes() / 60) *
      SLOT_HEIGHT
    : -1;

  return (
    <div
      className="motion-page-in"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 64,
        display: 'flex',
        gap: 16,
        color: 'var(--ink)',
        overflow: 'hidden',
      }}
    >
      {/* Backlog rail */}
      <div
        style={{
          width: 280,
          minWidth: 240,
          flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: '0 16px',
          overflowY: 'auto',
        }}
      >
        <div style={{ paddingBottom: 12, opacity: 0.6, fontSize: 11, letterSpacing: '0.14em' }}>
          BACKLOG · {backlog.length}
        </div>
        {loading && <div style={{ opacity: 0.5, fontSize: 12 }}>Loading…</div>}
        {!loading && backlog.length === 0 && (
          <div style={{ opacity: 0.5, fontSize: 12 }}>
            No unscheduled tasks. Add tasks in TaskBoard.
          </div>
        )}
        {backlog.map((t) => (
          <div
            key={t.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/x-hone-task', t.id);
              e.dataTransfer.effectAllowed = 'move';
              setDraggingId(t.id);
            }}
            onDragEnd={() => setDraggingId(null)}
            style={{
              padding: '10px 12px',
              marginBottom: 8,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.08)',
              background: draggingId === t.id ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
              cursor: 'grab',
              fontSize: 13,
              userSelect: 'none',
            }}
          >
            <div style={{ fontWeight: 500 }}>{t.title}</div>
            <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>{t.kind}</div>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={goPrevDay} style={navBtn}>‹</button>
            <button onClick={goToday} style={navBtnSm}>today</button>
            <button onClick={goNextDay} style={navBtn}>›</button>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{dayLabel}</div>
          </div>
          <div
            style={{ fontSize: 12, opacity: 0.7 }}
            data-testid="schedule-total"
          >
            {(totalScheduledMin / 60).toFixed(1)}h scheduled
          </div>
        </div>

        <div
          ref={timelineRef}
          style={{
            flex: 1,
            position: 'relative',
            overflowY: 'auto',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            padding: '0 16px',
          }}
        >
          <div style={{ position: 'relative', minHeight: (DAY_END_HOUR - DAY_START_HOUR) * SLOT_HEIGHT }}>
            {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => {
              const hour = DAY_START_HOUR + i;
              return (
                <div
                  key={hour}
                  data-hour={hour}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('text/x-hone-task')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const taskId = e.dataTransfer.getData('text/x-hone-task');
                    if (!taskId) return;
                    // Snap to the half-hour the cursor landed in.
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const minute = e.clientY - rect.top > SLOT_HEIGHT / 2 ? 30 : 0;
                    void handleDropOnSlot(taskId, hour, minute);
                    setDraggingId(null);
                  }}
                  style={{
                    position: 'absolute',
                    top: i * SLOT_HEIGHT,
                    left: 0,
                    right: 0,
                    height: SLOT_HEIGHT,
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    paddingLeft: 56,
                    fontSize: 10,
                    color: 'var(--ink-40)',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: -6,
                      width: 50,
                      textAlign: 'right',
                      paddingRight: 8,
                      fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    }}
                  >
                    {pad(hour)}:00
                  </span>
                </div>
              );
            })}

            {/* Now-line — current time indicator (the only red accent on this page). */}
            {nowOffsetPx >= 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: nowOffsetPx,
                  left: 56,
                  right: 16,
                  height: 0,
                  borderTop: '1.5px solid #FF3B30',
                  pointerEvents: 'none',
                  zIndex: 3,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: -10,
                    top: -5,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: '#FF3B30',
                  }}
                />
              </div>
            )}

            {/* Scheduled blocks */}
            {blocks.map((b) => {
              const startMin = b.startMs / 60_000;
              const offsetMin = startMin - DAY_START_HOUR * 60;
              const topPx = (offsetMin / 60) * SLOT_HEIGHT;
              const heightPx = (b.durationMin / 60) * SLOT_HEIGHT;
              return (
                <div
                  key={b.task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/x-hone-task', b.task.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingId(b.task.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  style={{
                    position: 'absolute',
                    top: topPx,
                    left: 64,
                    right: 16,
                    height: Math.max(heightPx - 2, 24),
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 12,
                    cursor: 'grab',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    userSelect: 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.task.title}
                    </span>
                    <button
                      onClick={() => void handleUnschedule(b.task.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--ink-40)',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 12,
                        lineHeight: 1,
                      }}
                      aria-label="Unschedule"
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.55 }}>{b.durationMin}m</div>
                  {/* Resize handle */}
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setResizingId(b.task.id);
                      const startY = e.clientY;
                      const startDuration = b.durationMin;
                      const onMove = (ev: MouseEvent): void => {
                        const dy = ev.clientY - startY;
                        const deltaMin = (dy / SLOT_HEIGHT) * 60;
                        const next = startDuration + deltaMin;
                        // We don't fire RPC on every move — only on mouseup.
                        // For visual feedback let layout reflect the new height.
                        const el = e.currentTarget as HTMLElement | null;
                        if (el && el.parentElement) {
                          el.parentElement.style.height = `${Math.max(24, (next / 60) * SLOT_HEIGHT - 2)}px`;
                          el.parentElement.dataset.tempDuration = String(next);
                        }
                      };
                      const onUp = (): void => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        const targetEl = (e.currentTarget as HTMLElement | null)?.parentElement;
                        const newMin = targetEl?.dataset.tempDuration
                          ? Number(targetEl.dataset.tempDuration)
                          : b.durationMin;
                        void handleResize(b, newMin);
                        setResizingId(null);
                      };
                      document.addEventListener('mousemove', onMove);
                      document.addEventListener('mouseup', onUp);
                    }}
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 6,
                      cursor: 'ns-resize',
                      background:
                        resizingId === b.task.id
                          ? 'rgba(255,255,255,0.18)'
                          : 'transparent',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'var(--ink)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
};

const navBtnSm: React.CSSProperties = {
  ...navBtn,
  width: 'auto',
  padding: '0 10px',
  fontSize: 11,
  letterSpacing: '0.08em',
};
