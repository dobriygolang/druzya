// Today — Focus Queue: per-day actionable list с тремя секциями.
//
// Архитектура:
//   - Источник истины — backend /hone/queue (ListQueue RPC).
//   - AI items материализуются автоматически после GeneratePlan на бэке
//     (see services/hone/app/plan.go GeneratePlan.Do → SyncAIItems).
//   - User items создаются через AddQueueItem (inline input под списком).
//   - Status flow: TODO → IN_PROGRESS → DONE. Только один in_progress per
//     user — enforced на бэке (atomic TX в repo.UpdateStatus).
//
// Optimistic UI: каждое state-изменение применяется к локальному списку
// немедленно, на ошибку откатываем. Это держит ощущение мгновенности
// даже при network blip'ах.
//
// Empty state: если queue пуст и plan пуст — кнопка «Generate plan» как
// раньше. После генерации AI items появятся в queue автоматически.
import { useCallback, useEffect, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { Icon } from '../components/primitives/Icon';
import { TodayStandupBanner } from '../components/TodayStandupBanner';
import {
  generatePlan,
  listQueue,
  addQueueItem,
  updateQueueItemStatus,
  deleteQueueItem,
  type QueueItem,
} from '../api/hone';

export interface StartFocusArgs {
  planItemId?: string;
  pinnedTitle?: string;
}

interface TodayPageProps {
  onStartFocus: (args?: StartFocusArgs) => void;
  highlightedItemId?: string | null;
  onConsumeHighlight?: () => void;
}

interface FetchState {
  status: 'loading' | 'ok' | 'error';
  items: QueueItem[];
  error: string | null;
  errorCode: Code | null;
}

const INITIAL: FetchState = { status: 'loading', items: [], error: null, errorCode: null };

const REFETCH_AFTER_MS = 5 * 60 * 1000; // 5 минут — refetch при возврате на страницу

function formatHeader(d: Date): string {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
}

export function TodayPage({ onStartFocus, highlightedItemId, onConsumeHighlight }: TodayPageProps) {
  useEffect(() => {
    if (highlightedItemId && onConsumeHighlight) onConsumeHighlight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  void highlightedItemId;

  const [state, setState] = useState<FetchState>(INITIAL);
  const [generating, setGenerating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState(0);

  const refetch = useCallback(async () => {
    try {
      const items = await listQueue();
      setState({ status: 'ok', items, error: null, errorCode: null });
      setLastFetchedAt(Date.now());
    } catch (err) {
      const ce = ConnectError.from(err);
      setState({
        status: 'error',
        items: [],
        error: ce.rawMessage || ce.message,
        errorCode: ce.code,
      });
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Refetch on tab/window focus, throttled by REFETCH_AFTER_MS — юзер мог
  // отлучиться, а бэкенд тем временем регенерил plan / sync'нул AI items.
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFetchedAt > REFETCH_AFTER_MS) {
        void refetch();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [lastFetchedAt, refetch]);

  // Optimistic mutators: применяем к локальному списку немедленно, на
  // ошибку откатываем через refetch (server — source of truth).
  const handleStatusChange = async (item: QueueItem, newStatus: QueueItem['status']) => {
    const before = state.items;
    // Локальный snapshot: меняем target + если new=in_progress, сбрасываем
    // peers (mirror'им бизнес-правило сервера для optimistic-UI).
    setState((s) => ({
      ...s,
      items: s.items.map((it) => {
        if (it.id === item.id) return { ...it, status: newStatus };
        if (newStatus === 'in_progress' && it.status === 'in_progress') {
          return { ...it, status: 'todo' };
        }
        return it;
      }),
    }));
    try {
      await updateQueueItemStatus(item.id, newStatus);
    } catch (err) {
      // Rollback + reconcile с сервером.
      setState((s) => ({ ...s, items: before }));
      const ce = ConnectError.from(err);
      setState((s) => ({ ...s, error: ce.rawMessage || ce.message, errorCode: ce.code }));
    }
  };

  const handleDelete = async (item: QueueItem) => {
    const before = state.items;
    setState((s) => ({ ...s, items: s.items.filter((it) => it.id !== item.id) }));
    try {
      await deleteQueueItem(item.id);
    } catch {
      setState((s) => ({ ...s, items: before }));
    }
  };

  const handleAdd = async () => {
    const title = draftTitle.trim();
    if (!title) {
      setAdding(false);
      setDraftTitle('');
      return;
    }
    try {
      const created = await addQueueItem(title);
      setState((s) => ({ ...s, items: [...s.items, created] }));
      setDraftTitle('');
      setAdding(false);
    } catch (err) {
      const ce = ConnectError.from(err);
      setState((s) => ({ ...s, error: ce.rawMessage || ce.message, errorCode: ce.code }));
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generatePlan(true);
      // Queue refetch — AI items now materialised на бэке.
      await refetch();
    } catch (err) {
      const ce = ConnectError.from(err);
      setState((s) => ({ ...s, error: ce.rawMessage || ce.message, errorCode: ce.code }));
    } finally {
      setGenerating(false);
    }
  };

  const inProgress = state.items.filter((i) => i.status === 'in_progress');
  const todo = state.items.filter((i) => i.status === 'todo');
  const done = state.items.filter((i) => i.status === 'done');

  const header = formatHeader(new Date());

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 88,
        paddingBottom: 80,
        overflowY: 'auto',
      }}
    >
      <div style={{ width: 640, maxWidth: '92%', padding: '0 16px' }}>
        {/* Morning standup — collapsed/expanded banner. Self-gating:
            компонент сам решает показываться или нет (morning-window +
            server.recorded check). Нулевой DOM если условия не выполнены. */}
        <TodayStandupBanner />
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)' }}>
          {header}
        </div>
        <h1
          style={{
            margin: '20px 0 0',
            fontSize: 44,
            fontWeight: 400,
            letterSpacing: '-0.03em',
            lineHeight: 1.08,
          }}
        >
          What will you hone today?
        </h1>

        {state.status === 'loading' && (
          <p style={{ marginTop: 48, fontSize: 14, color: 'var(--ink-40)' }}>Gathering today’s queue…</p>
        )}

        {state.status === 'error' && (
          <div style={{ marginTop: 48 }}>
            <p style={{ fontSize: 14, color: 'var(--ink-60)' }}>{errorHeadline(state.errorCode)}</p>
            {state.error && (
              <p className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-40)' }}>
                {state.error}
              </p>
            )}
          </div>
        )}

        {state.status === 'ok' && state.items.length === 0 && !adding && (
          <div style={{ marginTop: 48 }}>
            <p style={{ fontSize: 14, color: 'var(--ink-60)' }}>
              Empty queue. Generate today’s plan or add a task manually.
            </p>
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="focus-ring"
                style={{
                  padding: '9px 18px',
                  borderRadius: 999,
                  background: generating ? 'rgba(255,255,255,0.08)' : '#fff',
                  color: generating ? 'var(--ink-60)' : '#000',
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  cursor: generating ? 'default' : 'pointer',
                }}
              >
                {generating ? 'Generating…' : 'Generate plan'}
              </button>
              <button
                onClick={() => setAdding(true)}
                className="focus-ring"
                style={{
                  padding: '9px 14px',
                  borderRadius: 999,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--ink-60)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                + Add task
              </button>
            </div>
          </div>
        )}

        {state.status === 'ok' && state.items.length > 0 && (
          <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 0 }}>
            {inProgress.length > 0 && (
              <>
                <SectionList
                  items={inProgress}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onItemClick={(it) => onStartFocus({ planItemId: it.id, pinnedTitle: it.title })}
                />
                <Divider />
              </>
            )}
            {todo.length > 0 && (
              <>
                <SectionList
                  items={todo}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                />
                {done.length > 0 && <Divider />}
              </>
            )}
            {done.length > 0 && (
              <SectionList
                items={done}
                onStatusChange={handleStatusChange}
                onDelete={handleDelete}
              />
            )}

            {/* Add-task affordance — inline input snake'ом под списком. */}
            <div style={{ marginTop: 14 }}>
              {adding ? (
                <input
                  type="text"
                  autoFocus
                  value={draftTitle}
                  placeholder="What needs to be done?"
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAdd();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setDraftTitle('');
                      setAdding(false);
                    }
                  }}
                  onBlur={() => {
                    // Если пустой — schließen без save. С контентом — save.
                    if (!draftTitle.trim()) {
                      setAdding(false);
                    } else {
                      void handleAdd();
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 0',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--ink)',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              ) : (
                <button
                  onClick={() => setAdding(true)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink-40)',
                    fontSize: 13,
                    cursor: 'pointer',
                    padding: '8px 0',
                    transition: 'color 160ms ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-90)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
                >
                  + Add task
                </button>
              )}
            </div>

            <div style={{ marginTop: 32, display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={() => onStartFocus()}
                className="focus-ring"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 20px',
                  borderRadius: 999,
                  background: '#fff',
                  color: '#000',
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Start focus <Icon name="arrow" size={12} />
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="focus-ring mono"
                style={{
                  padding: '9px 14px',
                  borderRadius: 999,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--ink-60)',
                  fontSize: 11,
                  letterSpacing: '.08em',
                  cursor: generating ? 'default' : 'pointer',
                }}
              >
                {generating ? 'REGENERATING…' : '⟳ REGENERATE'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SectionList ─────────────────────────────────────────────────────────────

function SectionList({
  items,
  onStatusChange,
  onDelete,
  onItemClick,
}: {
  items: QueueItem[];
  onStatusChange: (item: QueueItem, newStatus: QueueItem['status']) => void | Promise<void>;
  onDelete: (item: QueueItem) => void | Promise<void>;
  onItemClick?: (item: QueueItem) => void;
}) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((it) => (
        <Row
          key={it.id}
          item={it}
          onStatusChange={onStatusChange}
          onDelete={onDelete}
          onItemClick={onItemClick}
        />
      ))}
    </ul>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        background: 'rgba(255,255,255,0.06)',
        margin: '14px 0',
      }}
    />
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function Row({
  item,
  onStatusChange,
  onDelete,
  onItemClick,
}: {
  item: QueueItem;
  onStatusChange: (item: QueueItem, newStatus: QueueItem['status']) => void | Promise<void>;
  onDelete: (item: QueueItem) => void | Promise<void>;
  onItemClick?: (item: QueueItem) => void;
}) {
  const [hover, setHover] = useState(false);

  const onCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.status === 'todo') void onStatusChange(item, 'in_progress');
    else if (item.status === 'in_progress') void onStatusChange(item, 'done');
    else void onStatusChange(item, 'todo'); // done → todo (un-check)
  };

  const onRowClick = () => {
    if (item.status === 'in_progress' && onItemClick) {
      onItemClick(item);
    }
  };

  const titleColor =
    item.status === 'done' ? 'var(--ink-40)' : 'var(--ink-90)';

  return (
    <li
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onRowClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 0',
        cursor: item.status === 'in_progress' && onItemClick ? 'pointer' : 'default',
      }}
    >
      <CheckboxAffordance status={item.status} onClick={onCheckboxClick} />
      <span
        style={{
          flex: 1,
          fontSize: 14,
          color: titleColor,
          textDecoration: item.status === 'done' ? 'line-through' : 'none',
          textDecorationColor: 'rgba(255,255,255,0.15)',
          transition: 'color 160ms ease',
          // word-break чтобы длинные тайтлы не ломали layout.
          wordBreak: 'break-word',
        }}
      >
        {item.title}
      </span>
      {item.source === 'ai' && item.skillKey && <SkillTag skillKey={item.skillKey} />}
      <DeleteButton visible={hover} onClick={(e) => { e.stopPropagation(); void onDelete(item); }} />
    </li>
  );
}

// ─── CheckboxAffordance ─────────────────────────────────────────────────────
//
// Три варианта:
//   - todo:        пустой [ ] checkbox с тонким border'ом
//   - in_progress: → arrow в accent ink
//   - done:        [✓] checkbox с заполнением + svg checkmark

function CheckboxAffordance({
  status,
  onClick,
}: {
  status: QueueItem['status'];
  onClick: (e: React.MouseEvent) => void;
}) {
  if (status === 'in_progress') {
    return (
      <button
        onClick={onClick}
        aria-label="Mark as done"
        style={{
          width: 16,
          height: 16,
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          color: 'var(--ink)',
          fontSize: 14,
          cursor: 'pointer',
          padding: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        →
      </button>
    );
  }
  if (status === 'done') {
    return (
      <button
        onClick={onClick}
        aria-label="Mark as todo"
        style={{
          width: 16,
          height: 16,
          flexShrink: 0,
          borderRadius: 3,
          border: '1.5px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.06)',
          cursor: 'pointer',
          padding: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink-60)' }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
    );
  }
  // todo
  return (
    <button
      onClick={onClick}
      aria-label="Start"
      style={{
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: 3,
        border: '1.5px solid rgba(255,255,255,0.15)',
        background: 'transparent',
        cursor: 'pointer',
        padding: 0,
        transition: 'border-color 160ms ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
    />
  );
}

function SkillTag({ skillKey }: { skillKey: string }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 9,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-40)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 4,
        padding: '2px 6px',
        flexShrink: 0,
      }}
    >
      {skillKey}
    </span>
  );
}

function DeleteButton({ visible, onClick }: { visible: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Delete task"
      style={{
        width: 18,
        height: 18,
        flexShrink: 0,
        background: 'transparent',
        border: 'none',
        color: 'var(--ink-40)',
        cursor: 'pointer',
        padding: 0,
        opacity: visible ? 1 : 0,
        transition: 'opacity 180ms ease, color 160ms ease',
        display: 'grid',
        placeItems: 'center',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-90)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-40)')}
    >
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    </button>
  );
}

// ─── Errors ─────────────────────────────────────────────────────────────────

function errorHeadline(code: Code | null): string {
  switch (code) {
    case Code.Unauthenticated:
      return 'Not signed in. Set HONE_DEV_TOKEN or sign in via the desktop dialog.';
    case Code.Unavailable:
      return 'Plan service is offline. The LLM chain is unreachable.';
    case Code.PermissionDenied:
      return 'This action requires a Pro subscription.';
    default:
      return 'Could not load today’s queue.';
  }
}
