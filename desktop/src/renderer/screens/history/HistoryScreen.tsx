// History panel — paginated list of past conversations. Click one:
//   → hydrate conversation store from server detail
//   → show the expanded chat window
//   → hide this window
// BYOK turns aren't in this list by design (the server doesn't know
// about them).

import { useEffect, useState } from 'react';

import type { Conversation } from '@shared/types';

import { IconClose, IconCopy, IconHistory } from '../../components/icons';
import { BrandMark } from '../../components/d9';
import { IconButton, Kbd } from '../../components/primitives';
import { useConversationStore } from '../../stores/conversation';

export function HistoryScreen() {
  const [items, setItems] = useState<Conversation[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadPage('', setItems, setCursor, setHasMore, setLoading, setError, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void window.druz9.windows.hide('history');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const open = async (id: string) => {
    try {
      const detail = await window.druz9.history.get(id);
      useConversationStore
        .getState()
        .hydrate(detail.conversation.id, detail.conversation.model, detail.messages);
      await window.druz9.windows.show('expanded');
      await window.druz9.windows.hide('history');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    const prev = items;
    setItems((s) => s.filter((c) => c.id !== id));
    try {
      await window.druz9.history.delete(id);
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
        background: 'oklch(0.14 0.035 280 / var(--d9-window-alpha))',
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
          borderBottom: '1px solid var(--d-line)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <BrandMark size={22} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>История</div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: 10,
            fontFamily: 'var(--f-mono)',
            color: 'var(--d-text-3)',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {items.length} {pluralize(items.length, 'диалог', 'диалога', 'диалогов')}
        </div>
        <IconButton
          title="Закрыть"
          onClick={() => void window.druz9.windows.hide('history')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <IconClose size={15} />
        </IconButton>
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
        {items.length === 0 && !loading && <EmptyState />}
        {items.map((c) => (
          <HistoryRow key={c.id} c={c} onOpen={() => void open(c.id)} onDelete={() => void remove(c.id)} />
        ))}

        {hasMore && (
          <button
            onClick={() =>
              void loadPage(cursor, setItems, setCursor, setHasMore, setLoading, setError, false)
            }
            disabled={loading}
            style={{
              marginTop: 8,
              padding: 10,
              background: 'transparent',
              border: '1px dashed var(--d-line)',
              borderRadius: 8,
              color: 'var(--d-text-2)',
              fontSize: 12,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {loading ? 'Загрузка…' : 'Показать ещё'}
          </button>
        )}

        {error && (
          <div
            style={{
              margin: '8px 0',
              padding: '8px 10px',
              fontSize: 11,
              color: 'var(--d-red)',
              background: 'rgba(255, 69, 58, 0.08)',
              border: '1px solid rgba(255, 69, 58, 0.3)',
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--d-line)',
          fontSize: 10.5,
          color: 'var(--d-text-3)',
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'var(--f-mono)',
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
    const page = await window.druz9.history.list(cursor, 20);
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
  onOpen,
  onDelete,
}: {
  c: Conversation;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        padding: '10px 12px',
        background: 'var(--d-bg-2)',
        border: '1px solid var(--d-line)',
        borderRadius: 8,
        display: 'flex',
        gap: 12,
        cursor: 'pointer',
        transition: 'background 120ms, border-color 120ms',
      }}
      onClick={onOpen}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--d-line-strong)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--d-line)';
      }}
    >
      <div
        style={{
          width: 4,
          alignSelf: 'stretch',
          borderRadius: 2,
          background: 'var(--d-gradient-hero)',
          opacity: 0.7,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: 'var(--d-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {c.title || '(без названия)'}
        </div>
        <div
          style={{
            marginTop: 3,
            fontSize: 10.5,
            fontFamily: 'var(--f-mono)',
            color: 'var(--d-text-3)',
            display: 'flex',
            gap: 8,
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

function EmptyState() {
  return (
    <div
      style={{
        padding: 40,
        textAlign: 'center',
        color: 'var(--d-text-3)',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          padding: 14,
          borderRadius: 12,
          background: 'var(--d-bg-2)',
          border: '1px solid var(--d-line)',
          color: 'var(--d-text-2)',
          marginBottom: 12,
        }}
      >
        <IconHistory size={20} />
      </div>
      <div style={{ fontSize: 13, color: 'var(--d-text-2)' }}>Диалогов пока нет</div>
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

// Avoid unused-import warning if the design lands without this icon later.
void IconCopy;
