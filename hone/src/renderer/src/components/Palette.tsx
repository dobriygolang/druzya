// Palette — the ⌘K command surface. Filter-by-prefix over a static set of
// actions; Enter runs the highlighted item, Arrow keys move the highlight,
// Escape closes. Nothing here is async — the whole thing is a router with
// a text filter, intentionally not a fuzzy search.
//
// `items` is kept inline (not a prop) because the set is the product's
// surface area; if a new destination needs to appear in the palette, the
// right change is here, not at the call site.
//
// Recent section (2026-05-12) — last 5 ran commands пишутся в localStorage
// (`hone:palette:recent:v1`) и рендерятся сверху над основным списком
// когда q пустой. Каждый click bumps id на верх рекенди. Кейс: юзер
// часто скачет между Today / Notes / Coach — без recents в палитре
// каждый раз skim'ит весь list.
import { useEffect, useMemo, useRef, useState } from 'react';

import { Icon, type IconName } from './primitives/Icon';
import { trackEvent } from '../api/events';

export type PageId =
  | 'home'
  | 'today'
  | 'coach' // Phase 2 (2026-05-04) — learning-companion surface (mode switcher + fork + hero next-action)
  | 'notes'
  | 'stats'
  // 'podcasts' removed 2026-05-12 (D5) — migrated to web /podcasts.
  // 'editor' / 'shared_boards' removed 2026-05-12 (D4/Stream F) — migrated to web solo.
  // 'english_overview' / 'reading' / 'writing' / 'speaking' / 'listening'
  // removed 2026-05-13 (Phase K Wave 8) — English vertical migrated to
  // web /lingua. Hone теперь pure focus cockpit.
  | 'assignments' // Wave 5.1d — pending tutor-pushed assignments
  | 'calendar' // Wave 5.2b — upcoming tutor-scheduled events
  | 'memory' // Phase B preview (2026-05-12) — what Coach remembers, by source
  | 'settings';
// PaletteAction — то, что палетка может попросить App'а сделать.
// `standup` — переходит на Today page (banner там сам решит показываться
// или нет, см. TodayStandupBanner). Раньше был отдельный overlay,
// теперь интегрирован morning-flow в Today.
export type PaletteAction = PageId | 'copilot';

interface PaletteProps {
  onClose: () => void;
  onOpen: (id: PaletteAction) => void;
}

interface PaletteItem {
  id: string;
  label: string;
  icon: IconName;
  /** Optional shortcut chips; не каждая команда имеет hotkey (e.g. memory). */
  shortcut?: string[];
  run: () => void;
  /** Group label for visual section header. Items with same `section` cluster together. */
  section?: string;
}

// Recent commands persisted via localStorage. Cap = 5; вторичное состояние
// не reactive — палетка перезагружает recents на mount каждый раз.
const RECENT_KEY = 'hone:palette:recent:v1';
const RECENT_CAP = 5;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((v) => typeof v === 'string').slice(0, RECENT_CAP) : [];
  } catch {
    return [];
  }
}

function bumpRecent(id: string): void {
  try {
    const prev = readRecent().filter((v) => v !== id);
    const next = [id, ...prev].slice(0, RECENT_CAP);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — silently drop */
  }
}

export function Palette({ onClose, onOpen }: PaletteProps) {
  const [idx, setIdx] = useState(0);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Snapshot recents at mount — палетка живёт коротко, не нужно reactivity.
  const recentIds = useMemo(() => readRecent(), []);

  // Phase 11 (Sergey 2026-05-04) — Hone-native only. Palette = focus
  // cockpit shortcuts; web-pages открываются через контекстные deeplinks
  // на конкретных surfaces (Coach hero «start mock», Today step «practice»,
  // step UI «graduation», TaskBoard tutor-card, Notes resource-link, Atlas
  // chip). См memory/project_hone — «Hone consumes, Web produces».
  //
  // Removed: Tutor (assignments + sessions, A·M), Boards · Code rooms (D·B·E),
  // Group events (V), «Stats dashboard» duplicate (G·S), English entry
  // (Phase K Wave 8 — moved to web /lingua).
  const items: PaletteItem[] = useMemo(
    () => [
      { id: 'today', label: 'Today', icon: 'sun', shortcut: ['T'], section: 'Daily', run: () => onOpen('today') },
      { id: 'coach', label: 'Coach', icon: 'sparkle', shortcut: ['C'], section: 'Daily', run: () => onOpen('coach') },
      { id: 'stats', label: 'Stats', icon: 'bars', shortcut: ['S'], section: 'Daily', run: () => onOpen('stats') },

      { id: 'notes', label: 'Notes', icon: 'note', shortcut: ['N'], section: 'Capture', run: () => onOpen('notes') },
      { id: 'memory', label: 'Memory', icon: 'sparkle', section: 'Capture', run: () => onOpen('memory') },
      // 'shared_boards' palette entry removed 2026-05-12 (D4/Stream F) —
      // migrated to web solo. Hone Palette B-shortcut освобождён (см. App.tsx
      // onKey handler — KeyB теперь openExternal('/whiteboard/new')).

      { id: 'settings', label: 'Settings', icon: 'settings', shortcut: [','], section: 'System', run: () => onOpen('settings') },
    ],
    [onOpen],
  );

  // Recents — реcонструируем как PaletteItem'ы из айдишек. Если recent
  // id больше не присутствует в текущем items (например legacy 'reading' /
  // 'english_overview' после Phase K Wave 8 cleanup) — filter mismatch
  // drop'нет его, чтобы клик не привёл к dead-action'у.
  const recentItems = useMemo<PaletteItem[]>(() => {
    if (!recentIds.length) return [];
    const byId = new Map(items.map((i) => [i.id, i] as const));
    return recentIds
      .map((id) => byId.get(id))
      .filter((i): i is PaletteItem => !!i);
  }, [recentIds, items]);

  // Сортировка для рендера: когда q пустой — recents сверху, потом все
  // items минус то что уже было в recents (без дублей). Когда q задан —
  // обычная фильтрация по подстроке, no recents.
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s) return items.filter((i) => i.label.toLowerCase().includes(s));
    if (recentItems.length === 0) return items;
    const recentIdSet = new Set(recentItems.map((i) => i.id));
    return [...recentItems, ...items.filter((i) => !recentIdSet.has(i.id))];
  }, [q, items, recentItems]);

  // Сколько topовых items в filtered относятся к recents — нужно для
  // вставки section header'а перед первым и разделителя после последнего.
  const recentHeadCount = q.trim() ? 0 : recentItems.length;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setIdx(0);
  }, [q]);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[idx];
      if (it) {
        bumpRecent(it.id);
        trackEvent('palette_select', { id: it.id, source: 'keyboard' });
        it.run();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.62)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="scale-pop"
        style={{
          width: 480,
          maxWidth: '92%',
          height: 'fit-content',
          background: 'rgba(12,12,12,0.96)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 40px 100px -20px rgba(0,0,0,0.85)',
        }}
      >
        {/* search input */}
        <div
          style={{
            padding: '11px 14px',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 10,
            alignItems: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <span style={{ color: 'var(--ink-40)', display: 'flex' }}>
            <Icon name="search" size={14} />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command…"
            style={{
              width: '100%',
              fontSize: 13.5,
              color: 'var(--ink)',
              background: 'transparent',
              border: 'none',
              outline: 'none',
            }}
          />
          <Chip>esc</Chip>
        </div>

        {/* items */}
        <div role="listbox" aria-label="Commands" style={{ padding: '4px 0' }}>
          {filtered.map((it, i) => {
            const active = i === idx;
            // Recent section: header вставляем перед первым recent (i===0),
            // separator — перед первым «обычным» (i===recentHeadCount).
            // Sergey 2026-05-03 убрал плоские section labels, но Recent —
            // отдельный case: сигнал «эти команды ты часто запускаешь».
            const isRecentHeader = recentHeadCount > 0 && i === 0;
            const isAllHeader = recentHeadCount > 0 && i === recentHeadCount;
            return (
              <div key={it.id}>
              {isRecentHeader && <SectionHeader>Recent</SectionHeader>}
              {isAllHeader && <SectionHeader>All</SectionHeader>}
              <button
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  bumpRecent(it.id);
                  trackEvent('palette_select', { id: it.id, source: 'click' });
                  it.run();
                  onClose();
                }}
                role="option"
                aria-selected={active}
                className="row"
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: '34px 1fr auto',
                  gap: 4,
                  alignItems: 'center',
                  padding: '7px 12px',
                  background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.04)',
                    color: active ? 'var(--ink)' : 'var(--ink-60)',
                    transition: 'color var(--t-fast), background-color var(--t-fast)',
                  }}
                >
                  <Icon name={it.icon} size={13} />
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: active ? 'var(--ink)' : 'var(--ink-90)',
                    transition: 'color var(--t-fast)',
                  }}
                >
                  {it.label}
                </span>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {(it.shortcut ?? []).map((k, ki) => (
                    <span
                      key={ki}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {ki > 0 && (
                        <span
                          style={{
                            color: 'var(--ink-40)',
                            fontSize: 9,
                            opacity: 0.6,
                          }}
                        >
                          ·
                        </span>
                      )}
                      <Chip>{k}</Chip>
                    </span>
                  ))}
                </span>
              </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div style={{ padding: '18px 16px', color: 'var(--ink-40)', fontSize: 12 }}>
              No matches.
            </div>
          )}
        </div>

        {/* footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '9px 14px',
            borderTop: '1px solid rgba(255,255,255,0.05)',
            fontSize: 10,
            color: 'var(--ink-40)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Chip>↑</Chip>
            <Chip>↓</Chip> select
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Chip>↵</Chip> open
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Chip>⌘</Chip>
            <Chip>K</Chip>
          </span>
        </div>
      </div>
    </div>
  );
}

// SectionHeader — лёгкий разделитель между Recent и All. Mono uppercase
// 9px, обоснованный padding чтобы header не путался с item'ом.
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '8px 14px 4px',
        fontSize: 9,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--ink-40)',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        userSelect: 'none',
      }}
    >
      {children}
    </div>
  );
}

// Chip — мини-кнопка в стиле macOS-keycap. Унифицированный размер +
// rounded-square форма как в Winter / Linear.
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        fontSize: 9.5,
        letterSpacing: '0.04em',
        color: 'var(--ink-60)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 5,
      }}
    >
      {children}
    </span>
  );
}
