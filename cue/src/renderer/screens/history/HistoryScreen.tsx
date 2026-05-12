// History panel — paginated list of local conversations. Click one:
//   → hydrate conversation store from localStorage detail
//   → show the expanded chat window
//   → hide this window

import { useEffect, useState } from 'react';

import type { Conversation } from '@shared/types';

import { IconClose, IconHistory } from '../../components/icons';
import { BrandMark } from '../../components/d9';
import { IconButton, Kbd } from '../../components/primitives';
import {
  clearLocalHistory,
  deleteLocalConversation,
  getLocalConversation,
  listLocalHistory,
  renameLocalConversation,
  searchLocalHistory,
} from '../../lib/local-history';
import { useConversationStore } from '../../stores/conversation';

export function HistoryScreen() {
  const [items, setItems] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  // Conversation currently loaded in the expanded window — drives
  // aria-current on the matching history row for screen readers.
  // History runs in its own BrowserWindow process, so this reflects
  // the last hydrated id within THIS renderer.
  const activeConversationId = useConversationStore((s) => s.conversationId);

  useEffect(() => {
    void loadPage('', setItems, setCursor, setHasMore, setLoading, setError, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Если активен поиск — Esc сначала чистит query, потом закрывает.
        if (query) {
          setQuery('');
          setSearchResults(null);
          return;
        }
        void window.druz9.windows.hide('history');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query]);

  // Debounced search. При query='' — показываем paginated list; иначе
  // полный поиск через searchLocalHistory (cap=100 conversations →
  // мгновенно даже без debounce, но 150ms сглаживает type-flicker).
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    const handle = window.setTimeout(() => {
      setSearchResults(searchLocalHistory(query, 50));
    }, 150);
    return () => window.clearTimeout(handle);
  }, [query]);

  const visibleItems = searchResults ?? items;
  const renameRow = (id: string, newTitle: string) => {
    if (!renameLocalConversation(id, newTitle)) return;
    // Обновим обе модели чтобы UI sync'ился без полного reload'а.
    setItems((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: newTitle.trim() || c.title } : c)),
    );
    if (searchResults) {
      setSearchResults((prev) =>
        prev?.map((c) => (c.id === id ? { ...c, title: newTitle.trim() || c.title } : c)) ?? null,
      );
    }
  };

  const open = async (id: string) => {
    try {
      const detail = getLocalConversation(id);
      if (!detail) throw new Error('Диалог не найден в локальной истории');
      // КРИТИЧНО: history и expanded — РАЗНЫЕ BrowserWindow'ы, каждый
      // имеет свой renderer process и свой instance zustand store'а.
      // Hydrate'нуть store внутри history-процесса бесполезно: expanded
      // загружается с пустым store'ом и видит 0 messages.
      //
      // Handoff через localStorage (shared между BrowserWindow'ами в
      // одном Electron app): пишем conversationId как «pending open»
      // marker. ExpandedScreen на mount'е читает marker, делает свой
      // hydrate из getLocalConversation, и стирает marker.
      window.localStorage.setItem('cue.pendingOpenConversation', id);
      // Hydrate'им и тут — на случай если history-window остался открыт
      // и юзер вернётся: store consistent.
      useConversationStore
        .getState()
        .hydrate(detail.conversation.id, detail.conversation.model, detail.messages);
      await window.druz9.windows.show('expanded');
      // Auto-close compact (welcome) когда юзер открыл конкретный чат —
      // welcome-state больше не нужен пока юзер в чате. Compact можно
      // вернуть через ⌘⇧D хоткей.
      await window.druz9.windows.hide('compact');
      await window.druz9.windows.hide('history');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    const prev = items;
    setItems((s) => s.filter((c) => c.id !== id));
    try {
      deleteLocalConversation(id);
    } catch (err) {
      // restore on failure
      setItems(prev);
      setError((err as Error).message);
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(10, 10, 10, var(--d9-window-alpha))',
        border: '0.5px solid var(--d9-hairline-b)',
        borderRadius: 'var(--d9-r-xl)',
        boxShadow: 'var(--d9-shadow-win)',
        overflow: 'hidden',
        color: 'var(--d9-ink)',
        fontFamily: 'var(--d9-font-sans)',
      }}
      className="d9-root"
    >
      {/* Header */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px 0 14px',
          gap: 10,
          borderBottom: '1px solid var(--d9-hairline)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <BrandMark size={22} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>История</div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: 10,
            fontFamily: 'var(--d9-font-mono)',
            color: 'var(--d9-ink-mute)',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {items.length} {pluralize(items.length, 'диалог', 'диалога', 'диалогов')}
        </div>
        <button
          title="Очистить всю локальную историю — используется когда content испорчен (видны странные символы вместо текста)"
          onClick={() => {
            if (!window.confirm('Удалить всю локальную историю чатов? Действие необратимо.')) return;
            clearLocalHistory();
            setItems([]);
            setCursor('');
            setHasMore(false);
          }}
          style={{
            WebkitAppRegion: 'no-drag',
            background: 'transparent',
            border: '1px solid var(--d9-hairline)',
            color: 'var(--d9-ink-mute)',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 'var(--radius-inner)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          } as React.CSSProperties}
        >
          Очистить
        </button>
        <IconButton
          title="Закрыть"
          onClick={() => void window.druz9.windows.hide('history')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <IconClose size={15} />
        </IconButton>
      </div>

      {/* Search */}
      <div
        style={{
          padding: 'var(--pad-inline) 12px',
          borderBottom: '1px solid var(--d9-hairline)',
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по заголовку и содержимому…"
          aria-label="Поиск по истории"
          className="focus-ring"
          style={{
            width: '100%',
            padding: '6px 0',
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--d9-hairline-b)',
            color: 'var(--d9-ink)',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--d9-ink)')}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--d9-hairline-b)')}
        />
      </div>

      {/* List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {visibleItems.length === 0 && !loading && (
          searchResults !== null
            ? <SearchEmptyState query={query} />
            : <EmptyState />
        )}
        {visibleItems.map((c) => (
          <HistoryRow
            key={c.id}
            c={c}
            isActive={c.id === activeConversationId}
            onOpen={() => void open(c.id)}
            onDelete={() => void remove(c.id)}
            onRename={(newTitle) => renameRow(c.id, newTitle)}
          />
        ))}

        {!searchResults && hasMore && (
          <button
            onClick={() =>
              void loadPage(cursor, setItems, setCursor, setHasMore, setLoading, setError, false)
            }
            disabled={loading}
            style={{
              marginTop: 8,
              padding: 10,
              background: 'transparent',
              border: '1px dashed var(--d9-hairline)',
              borderRadius: 8,
              color: 'var(--d9-ink-dim)',
              fontSize: 12,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Загрузка…' : 'Показать ещё'}
          </button>
        )}

        {error && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              margin: '8px 0',
              padding: 'var(--pad-inline) 12px',
              fontSize: 11,
              color: 'var(--d9-accent)',
              background: 'transparent',
              border: '1px solid rgba(255, 59, 48, 0.4)',
              borderRadius: 'var(--radius-inner, 6px)',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-block', width: 1.5, minHeight: 14, background: 'var(--d9-accent)', marginTop: 3, flex: '0 0 auto' }} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: 'var(--pad-inline) 14px',
          borderTop: '1px solid var(--d9-hairline)',
          fontSize: 10.5,
          color: 'var(--d9-ink-mute)',
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--d9-font-mono)',
        }}
      >
        <span>
          <Kbd size="sm">Esc</Kbd> — закрыть
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

async function loadPage(
  cursor: string,
  setItems: React.Dispatch<React.SetStateAction<Conversation[]>>,
  setCursor: React.Dispatch<React.SetStateAction<string>>,
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  reset: boolean,
): Promise<void> {
  setLoading(true);
  try {
    const page = listLocalHistory(cursor, 20);
    setItems((prev) => (reset ? page.conversations : [...prev, ...page.conversations]));
    setCursor(page.nextCursor);
    setHasMore(!!page.nextCursor);
    setError(null);
  } catch (err) {
    setError((err as Error).message);
  } finally {
    setLoading(false);
  }
}

function HistoryRow({
  c,
  isActive,
  onOpen,
  onDelete,
  onRename,
}: {
  c: Conversation;
  isActive?: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.title || '');

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== (c.title || '').trim()) {
      onRename(draft);
    }
  };

  return (
    <div
      role="button"
      aria-current={isActive ? 'true' : undefined}
      style={{
        position: 'relative',
        padding: '10px 12px',
        background: 'transparent',
        border: '1px solid var(--d9-hairline)',
        borderRadius: 'var(--radius-inner, 8px)',
        display: 'flex',
        gap: 12,
        cursor: editing ? 'text' : 'pointer',
        transition:
          'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
      }}
      onClick={() => {
        if (!editing) onOpen();
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.22)';
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--d9-hairline)';
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <div
        // v2: vertical accent bar — pure white ink (was red→white gradient
        // which violates b/w + red rule by leaking red into decorative space).
        style={{
          width: 2,
          alignSelf: 'stretch',
          borderRadius: 2,
          background: 'rgba(255, 255, 255, 0.55)',
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(c.title || '');
                setEditing(false);
              }
            }}
            style={{
              width: '100%',
              padding: '2px 0',
              background: 'transparent',
              border: 0,
              borderBottom: '1px solid var(--d9-ink)',
              color: 'var(--d9-ink)',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        ) : (
          <div
            // Tooltip полным текстом — title-row truncate'ит overflow с
            // ellipsis. Без native title='...' юзер вынужден open chat
            // чтобы прочитать длинный заголовок.
            title={c.title || '(без названия)'}
            style={{
              fontSize: 13,
              color: 'var(--d9-ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.title || '(без названия)'}
          </div>
        )}
        <div
          style={{
            marginTop: 3,
            fontSize: 10.5,
            fontFamily: 'var(--d9-font-mono)',
            color: 'var(--d9-ink-mute)',
            display: 'flex',
            gap: 'var(--pad-inline)',
          }}
        >
          <span>{c.messageCount} сообщ.</span>
          <span>·</span>
          <span>{c.model}</span>
          <span>·</span>
          <span>{formatDate(c.updatedAt)}</span>
        </div>
      </div>
      <IconButton
        title="Переименовать"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(c.title || '');
          setEditing(true);
        }}
        style={{ alignSelf: 'center' }}
      >
        <PencilIcon />
      </IconButton>
      <IconButton
        title="Удалить"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        style={{ alignSelf: 'center' }}
      >
        <IconClose size={13} />
      </IconButton>
    </div>
  );
}

function SearchEmptyState({ query }: { query: string }) {
  return (
    <div
      style={{
        padding: 30,
        textAlign: 'center',
        color: 'var(--d9-ink-mute)',
        fontSize: 12,
      }}
    >
      Ничего не найдено по «{query}»
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: 40,
        textAlign: 'center',
        color: 'var(--d9-ink-mute)',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          padding: 14,
          borderRadius: 'var(--radius-inner, 12px)',
          background: 'transparent',
          border: '1px solid var(--d9-hairline-b)',
          color: 'var(--d9-ink-dim)',
          marginBottom: 12,
        }}
      >
        <IconHistory size={20} />
      </div>
      <div style={{ fontSize: 13, color: 'var(--d9-ink-dim)' }}>Диалогов пока нет</div>
      <div style={{ marginTop: 4, fontSize: 11 }}>
        Сделай скриншот или задай вопрос в compact-окне
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Formatting

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
