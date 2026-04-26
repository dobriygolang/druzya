// Today — Notion-style daily note. Один canvas, не карточки.
//
// Layout сверху вниз (всё inline на одной странице):
//
//   1. Date header  (FRIDAY · APR 26)
//   2. H1           («Today» — статичный, не вопрос-prompt)
//   3. Morning standup banner — collapsible, self-gating (см. TodayStandupBanner)
//   4. Morning intent — large textarea (free-form, autosaves to a Note
//      titled "Daily YYYY-MM-DD"). Юзер пишет туда что угодно: «what's
//      on my mind», quick-jots, intent. Это не задачи — это размышления.
//   5. Tasks       — Focus Queue, three sections без больших дивайдеров.
//      Inline + Add task внизу. Hover-delete, click checkbox для transitions.
//   6. AI nudges   — слот под Coach.
//
// NOTE: Standup banner был НА Today всегда — он самораскрывается утром и
// прячется когда юзер записал stand-up на сегодня. Из общих палетки/tabs
// мы команду удалили (нет смысла навигироваться отдельно), но на Today
// сам компонент остался: он часть «утреннего блока».
//
// Никаких pop-up кнопок «Generate plan / Regenerate». Plan генерится
// автоматически утром (cron) или по явному запросу через Palette
// (TODO: refactor). Today — это просто отображение.
//
// AI smarter — не в этом файле. Этот файл рендерит. Логика в backend
// services/intelligence (Coach) + services/hone (PlanSynthesizer).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { TodayStandupBanner } from '../components/TodayStandupBanner';
import {
  generatePlan,
  listQueue,
  addQueueItem,
  updateQueueItemStatus,
  deleteQueueItem,
  type QueueItem,
  // Daily-note autosave: используем существующий notes API, ничего нового
  // не добавляем. Ищем note с title="Daily YYYY-MM-DD", upsert content.
  listNotes,
  createNote,
  updateNote,
  type NoteSummary,
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
const REFETCH_AFTER_MS = 5 * 60 * 1000;
const DAILY_AUTOSAVE_DEBOUNCE_MS = 800;

function formatHeader(d: Date): string {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
}

function dailyNoteTitle(d: Date): string {
  // Local-time date — юзер видит свою локальную дату, заметка должна
  // совпадать. Backend приёмлет любые title-строки, дата внутри title —
  // чисто human-readable label.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `Daily ${y}-${m}-${day}`;
}

// Префикс для fallback'а: если текущая локальная дата не совпала с title'ом
// (timezone edge-case у границы суток), мы возьмём LATEST note начинающуюся
// с "Daily " — это всегда «вчерашний/сегодняшний daily note».
const DAILY_PREFIX = 'Daily ';

export function TodayPage({ onStartFocus, highlightedItemId, onConsumeHighlight }: TodayPageProps) {
  useEffect(() => {
    if (highlightedItemId && onConsumeHighlight) onConsumeHighlight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  void highlightedItemId;

  const [state, setState] = useState<FetchState>(INITIAL);
  const [adding, setAdding] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [lastFetchedAt, setLastFetchedAt] = useState(0);
  // Daily note: noteId — null если ещё не создана. body — local copy
  // которая autosaves debounced. На mount подтягиваем существующую (если
  // есть запись с title="Daily YYYY-MM-DD") или создаём новую при первом
  // keypress'е.
  const [dailyNoteId, setDailyNoteId] = useState<string | null>(null);
  const [dailyBody, setDailyBody] = useState('');
  const dailyTitleRef = useRef(dailyNoteTitle(new Date()));
  const dailySaveTimer = useRef<number | null>(null);
  const dailyLoadingRef = useRef(false);

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

  // Refetch on focus, throttled.
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFetchedAt > REFETCH_AFTER_MS) void refetch();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [lastFetchedAt, refetch]);

  // Mount: пытаемся найти существующий daily note. Если есть — pre-fill.
  // Если нет — оставляем noteId null, создадим лениво при первом write.
  useEffect(() => {
    let cancelled = false;
    dailyLoadingRef.current = true;
    void listNotes({ limit: 50 })
      .then((res) => {
        if (cancelled) return;
        // Resilient lookup: сначала точный match по local-date title,
        // если нет — берём LATEST note по updatedAt с префиксом "Daily ".
        // Это защищает от timezone edge-case'ов и от ситуации когда юзер
        // начал писать в 23:50, заметка создалась с YYYY-MM-DD A, потом
        // открыл утром в 00:10 — local-date уже B, точный match не найдёт.
        let target: NoteSummary | undefined =
          res.notes.find((n: NoteSummary) => n.title === dailyTitleRef.current);
        if (!target) {
          const dailyCandidates = res.notes
            .filter((n: NoteSummary) => n.title.startsWith(DAILY_PREFIX))
            .sort((a, b) => {
              const at = a.updatedAt?.getTime() ?? 0;
              const bt = b.updatedAt?.getTime() ?? 0;
              return bt - at;
            });
          target = dailyCandidates[0];
        }
        if (target) {
          setDailyNoteId(target.id);
          void import('../api/hone').then(({ getNote }) =>
            getNote(target.id).then((n) => {
              if (!cancelled) setDailyBody(n.bodyMd);
            }),
          );
        }
      })
      .catch(() => {
        /* silent — daily note opt-in, fail = просто пустой textarea */
      })
      .finally(() => {
        dailyLoadingRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleDailySave = useCallback((nextBody: string) => {
    setDailyBody(nextBody);
    if (dailySaveTimer.current !== null) {
      window.clearTimeout(dailySaveTimer.current);
    }
    dailySaveTimer.current = window.setTimeout(async () => {
      const title = dailyTitleRef.current;
      try {
        if (dailyNoteId === null) {
          // Lazy create только когда юзер реально что-то написал.
          if (nextBody.trim() === '') return;
          const created = await createNote(title, nextBody);
          setDailyNoteId(created.id);
        } else {
          await updateNote(dailyNoteId, title, nextBody);
        }
      } catch {
        /* silent — autosave best-effort. Юзер увидит content в UI; на
           следующем keystroke попробуем снова. */
      }
    }, DAILY_AUTOSAVE_DEBOUNCE_MS);
  }, [dailyNoteId]);

  // Optimistic mutators for queue.
  const handleStatusChange = async (item: QueueItem, newStatus: QueueItem['status']) => {
    const before = state.items;
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

  // «Generate plan» — оставляем эту команду доступной, но без отдельной
  // кнопки в UI. На пустой queue показываем call-to-action — это
  // единственное место где юзер может явно её триггернуть.
  const handleGenerate = useCallback(async () => {
    try {
      await generatePlan(true);
      await refetch();
    } catch (err) {
      const ce = ConnectError.from(err);
      setState((s) => ({ ...s, error: ce.rawMessage || ce.message, errorCode: ce.code }));
    }
  }, [refetch]);

  const inProgress = state.items.filter((i) => i.status === 'in_progress');
  const todo = state.items.filter((i) => i.status === 'todo');
  const done = state.items.filter((i) => i.status === 'done');

  const header = formatHeader(new Date());
  const empty = state.status === 'ok' && state.items.length === 0 && !adding;

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
      <div style={{ width: 720, maxWidth: '92%', padding: '0 24px' }}>
        {/* Date stamp */}
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)' }}>
          {header}
        </div>

        {/* Static H1 — не вопрос. Notion-like заголовок страницы. */}
        <h1
          style={{
            margin: '14px 0 28px',
            fontSize: 40,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            color: 'var(--ink)',
          }}
        >
          Today
        </h1>

        {/* Morning standup — self-gating: показывается только утром и если
            stand-up за сегодня ещё не записан. После записи свернётся в null. */}
        <TodayStandupBanner />

        {/* Morning intent — free-form note, autosaves debounced. */}
        <DailyNoteEditor body={dailyBody} onChange={scheduleDailySave} />

        {/* Tasks section header — мини-label в Notion-style. */}
        <SectionLabel>Tasks</SectionLabel>

        {state.status === 'loading' && (
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-40)' }}>Loading queue…</p>
        )}

        {state.status === 'error' && (
          <div style={{ marginTop: 4 }}>
            <p style={{ fontSize: 13, color: 'var(--ink-60)' }}>{errorHeadline(state.errorCode)}</p>
            {state.error && (
              <p className="mono" style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-40)' }}>
                {state.error}
              </p>
            )}
          </div>
        )}

        {empty && <EmptyTasks onGenerate={handleGenerate} onAddManual={() => setAdding(true)} />}

        {state.status === 'ok' && state.items.length > 0 && (
          <>
            {/* Active items (todo + in_progress) — единый список, без секций.
                Done — отдельный блок снизу с уменьшенным opacity. */}
            <SectionList
              items={[...inProgress, ...todo]}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onItemClick={(it) => onStartFocus({ planItemId: it.id, pinnedTitle: it.title })}
            />
            {done.length > 0 && (
              <div style={{ marginTop: 14, opacity: 0.7 }}>
                <SectionList items={done} onStatusChange={handleStatusChange} onDelete={handleDelete} />
              </div>
            )}
          </>
        )}

        {/* Add task affordance — inline под списком. */}
        <div style={{ marginTop: 6 }}>
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
                if (!draftTitle.trim()) setAdding(false);
                else void handleAdd();
              }}
              style={{
                width: '100%',
                padding: '8px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                color: 'var(--ink)',
                fontSize: 14,
                outline: 'none',
              }}
            />
          ) : (
            !empty && (
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
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DailyNoteEditor ────────────────────────────────────────────────────────
//
// Notion-style large textarea. Autosizes по контенту (min 2 строки), placeholder
// «What's on your mind today?». Без заголовка-секции — один из основных
// content-блоков страницы.

function DailyNoteEditor({ body, onChange }: { body: string; onChange: (b: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Auto-grow на content. useEffect синхронизит height каждый раз когда
  // body меняется (включая first render с pre-loaded body).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 60)}px`;
  }, [body]);
  return (
    <div style={{ marginBottom: 32 }}>
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What's on your mind today?"
        rows={2}
        style={{
          width: '100%',
          padding: '8px 0',
          background: 'transparent',
          border: 'none',
          color: 'var(--ink)',
          fontSize: 17,
          lineHeight: 1.55,
          outline: 'none',
          resize: 'none',
          fontFamily: 'inherit',
          letterSpacing: '-0.005em',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}

// ─── EmptyTasks ─────────────────────────────────────────────────────────────

function EmptyTasks({ onGenerate, onAddManual }: { onGenerate: () => void; onAddManual: () => void }) {
  return (
    <div style={{ marginTop: 4 }}>
      <p style={{ fontSize: 13, color: 'var(--ink-60)', margin: '0 0 12px' }}>
        Nothing on the board yet. Generate a plan from your skill graph or jot one down.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => void onGenerate()}
          style={{
            padding: '7px 14px',
            borderRadius: 999,
            background: '#fff',
            color: '#000',
            border: 'none',
            fontSize: 12.5,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Generate plan
        </button>
        <button
          onClick={onAddManual}
          style={{
            padding: '7px 14px',
            borderRadius: 999,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--ink-60)',
            fontSize: 12.5,
            cursor: 'pointer',
          }}
        >
          Add task manually
        </button>
      </div>
    </div>
  );
}

// ─── SectionLabel ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 10,
        letterSpacing: '0.22em',
        color: 'var(--ink-40)',
        margin: '0 0 8px',
      }}
    >
      {String(children).toUpperCase()}
    </div>
  );
}

// ─── SectionList ────────────────────────────────────────────────────────────

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

// ─── Row ────────────────────────────────────────────────────────────────────

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

  // Чекбокс toggles только todo↔done (как в Notion / Linear / Apple
  // Reminders). Раньше клик делал todo→in_progress, потом → done — было
  // непонятно: «я отметил выполненным, а оно куда-то прыгнуло наверх».
  // in_progress теперь триггерится только явной кнопкой Focus (см. ниже).
  const onCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.status === 'done') {
      void onStatusChange(item, 'todo'); // un-check
    } else {
      void onStatusChange(item, 'done');
    }
  };

  const onFocusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.status === 'in_progress') {
      // Уже in_progress — клик возвращает в todo.
      void onStatusChange(item, 'todo');
      return;
    }
    void onStatusChange(item, 'in_progress');
    if (onItemClick) onItemClick(item);
  };

  const titleColor = item.status === 'done' ? 'var(--ink-40)' : 'var(--ink-90)';
  const isInProgress = item.status === 'in_progress';

  return (
    <li
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 0',
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
          wordBreak: 'break-word',
        }}
      >
        {item.title}
        {isInProgress && (
          <span
            className="mono"
            style={{
              marginLeft: 8,
              fontSize: 9,
              letterSpacing: '0.18em',
              color: 'var(--ink-40)',
              textTransform: 'uppercase',
            }}
          >
            · in focus
          </span>
        )}
      </span>
      {item.source === 'ai' && item.skillKey && <SkillTag skillKey={item.skillKey} />}
      {/* Focus button — appears on hover для todo, всегда виден для in_progress.
          Done items не получают эту кнопку (бессмысленно). */}
      {item.status !== 'done' && (
        <FocusButton visible={hover || isInProgress} active={isInProgress} onClick={onFocusClick} />
      )}
      <DeleteButton
        visible={hover}
        onClick={(e) => {
          e.stopPropagation();
          void onDelete(item);
        }}
      />
    </li>
  );
}

function CheckboxAffordance({
  status,
  onClick,
}: {
  status: QueueItem['status'];
  onClick: (e: React.MouseEvent) => void;
}) {
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
        <svg
          width={10}
          height={10}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: 'var(--ink-60)' }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
    );
  }
  // todo + in_progress shared empty checkbox — in_progress дополнительно
  // помечается «· in focus» текстом + visible Focus button.
  return (
    <button
      onClick={onClick}
      aria-label="Mark as done"
      style={{
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: 3,
        border: status === 'in_progress'
          ? '1.5px solid rgba(255,255,255,0.4)'
          : '1.5px solid rgba(255,255,255,0.15)',
        background: 'transparent',
        cursor: 'pointer',
        padding: 0,
        transition: 'border-color 160ms ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = status === 'in_progress' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)')}
    />
  );
}

// FocusButton — отдельный affordance, появляется на hover'е todo и всегда
// для in_progress. Click → ставит/убирает in_progress + (для todo→
// in_progress) триггерит pinned focus session через onItemClick.
function FocusButton({
  visible,
  active,
  onClick,
}: {
  visible: boolean;
  active: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={active ? 'Stop focus' : 'Start focus on this'}
      title={active ? 'Stop focus' : 'Start focus on this'}
      style={{
        width: 24,
        height: 24,
        flexShrink: 0,
        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 6,
        color: active ? 'var(--ink)' : 'var(--ink-60)',
        cursor: 'pointer',
        padding: 0,
        opacity: visible ? 1 : 0,
        transition: 'opacity 180ms ease, color 160ms ease, background-color 160ms ease',
        display: 'grid',
        placeItems: 'center',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = active ? 'var(--ink)' : 'var(--ink-60)')}
    >
      <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor">
        <polygon points="6,4 20,12 6,20" />
      </svg>
    </button>
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

function DeleteButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
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
      <svg
        width={12}
        height={12}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
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
      return 'Service is offline. The LLM chain is unreachable.';
    case Code.PermissionDenied:
      return 'This action requires a Pro subscription.';
    default:
      return 'Could not load today’s tasks.';
  }
}
