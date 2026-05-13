// ConnectionPanel — persistent right-sidebar AI-link surface for Notes.
//
// Different from the legacy modal ConnectionsPanel (Notes.tsx) that opens on
// ⌘J: this panel is always-on (collapsible, persisted via localStorage) and
// lives inside the Notes layout grid. It is the main differentiator vs
// Obsidian/Notion AI — visible, ambient retrieval without a hotkey.
//
// Data sources (all existing RPCs, no proto changes):
//   • Related notes — `suggestNoteLinks` (LLM-reranked) merged with
//     `getNoteConnectionsStream` (fast cosine; only kind='note').
//   • Atlas resources — `searchAtlasTopics` driven by a token extracted
//     from the note title (best-effort; SearchAtlasTopics is prefix-based,
//     not free-text — we extract the longest non-stopword token).
//   • Codex — placeholder filter; no Codex retrieval RPC exists yet, so
//     the chip surfaces non-note Connection items (kind!='note'/'atlas'),
//     which today is empty corpus-wide in Hone. TODO marked inline.
//
// UX:
//   • Filter chips (All / Notes / Atlas / Codex) top-mounted.
//   • Each item: title + 2-line preview + score (mono, --ink-40).
//   • Hover preview card: tooltip-style, B/W, 320px max, with full snippet.
//   • Click — note → onPickNote; atlas → window.hone.shell.openExternal
//     into the web /atlas?focus=<id>.
//   • Empty state: "No related notes yet. Write more to build connections."
//   • Loading: hairline skeletons.
//   • Debounced fetch on noteId change (350ms) — avoids storm-fetches
//     during keyboard nav через note list.
//   • Keyboard nav: ↑/↓ moves focus through items, Enter activates,
//     Esc collapses (parent owns collapsed state).
//
// Design tokens (globals.css): --ink, --ink-60/40, --hair, --hair-2, --red.
// Only --red usage: 1.5px stripe on the top-ranked AI suggestion. Never
// in backgrounds or fills.
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { analytics, ANALYTICS_EVENTS } from '../../lib/analytics';
import { ConnectError } from '@connectrpc/connect';

import {
  getNoteConnectionsStream,
  suggestNoteLinks,
  type NoteConnection,
  type NoteLinkSuggestion,
} from '../../api/hone';
import { searchAtlasTopics, type AtlasTopicSuggestion } from '../../api/external';
import { WEB_BASE_URL } from '../../api/config';
import { SkeletonLine } from '../Skeleton';

// ── Public surface ─────────────────────────────────────────────────────────

export type ConnectionFilter = 'all' | 'notes' | 'atlas' | 'codex';

export interface ConnectionPanelProps {
  /** Currently open note id, or null if no note selected. */
  noteId: string | null;
  /** Optional preview text (title/body) used to fuel Atlas keyword search. */
  noteTitle?: string;
  noteBody?: string;
  /** Click handler when a related Note is picked. */
  onPickNote: (id: string) => void;
  /** Collapsed state — owned by parent so it can persist + control via shortcut. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

// ── Internal item model ────────────────────────────────────────────────────

interface PanelItem {
  /** Stable key for React reconciliation. */
  key: string;
  kind: 'note' | 'atlas' | 'codex';
  title: string;
  snippet: string;
  /** 0..1 — relevance/cosine. Atlas items don't have a score → -1. */
  score: number;
  /** Why this surfaced (LLM rationale for AI links; empty otherwise). */
  reason: string;
  /** Action — note id or external URL. */
  target: string;
  /** True when this row should render the red stripe (top-ranked AI sugg). */
  isAccent: boolean;
}

// ── Tokenizer for Atlas keyword search ─────────────────────────────────────

// Tiny English+Russian stopword list — we don't want to query "the", "и", etc.
const STOP_WORDS = new Set<string>([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'can', 'may', 'might', 'this', 'that', 'these', 'those', 'it',
  'its', 'as', 'about', 'into', 'over', 'under', 'untitled', 'note', 'notes',
  // Russian
  'и', 'в', 'на', 'с', 'по', 'для', 'из', 'к', 'о', 'у', 'не', 'но', 'а',
  'это', 'что', 'как', 'если', 'или', 'же', 'бы', 'так',
]);

function pickAtlasQuery(title: string, body: string): string {
  // Strategy: take the longest non-stopword token from title; fall back to
  // body. Atlas only does prefix-search, so a single strong term is better
  // than a multi-word phrase.
  const source = `${title} ${body.slice(0, 400)}`.toLowerCase();
  const tokens = source
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  if (tokens.length === 0) return '';
  // Pick the longest (heuristic for "domain term"); ties → first occurrence.
  tokens.sort((a, b) => b.length - a.length);
  return tokens[0];
}

// ── Component ──────────────────────────────────────────────────────────────

export function ConnectionPanel({
  noteId,
  noteTitle = '',
  noteBody = '',
  onPickNote,
  collapsed,
  onToggleCollapsed,
}: ConnectionPanelProps): React.ReactElement {
  const [filter, setFilter] = useState<ConnectionFilter>('all');
  const [aiSuggs, setAiSuggs] = useState<NoteLinkSuggestion[]>([]);
  const [cosineConns, setCosineConns] = useState<NoteConnection[]>([]);
  const [atlas, setAtlas] = useState<AtlasTopicSuggestion[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [loadingAtlas, setLoadingAtlas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // ── Fetch ────────────────────────────────────────────────────────────────
  // Debounced fetch on noteId change. We deliberately do NOT depend on
  // noteTitle/body for the refetch — the panel would re-fire on every
  // keystroke otherwise (note body changes constantly via autosave). Atlas
  // keyword is recomputed only when noteId flips.
  useEffect(() => {
    if (!noteId || collapsed) {
      setAiSuggs([]);
      setCosineConns([]);
      setAtlas([]);
      setError(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      void fetchAll();
    }, 350);

    async function fetchAll() {
      if (cancelled || !noteId) return;
      setLoadingNotes(true);
      setLoadingAtlas(true);
      setError(null);

      // Notes — AI rerank + cosine stream merged.
      const aiPromise = suggestNoteLinks(noteId, 5)
        .then((s) => {
          if (!cancelled) setAiSuggs(s);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const ce = ConnectError.from(e);
          // AI rerank is best-effort — we surface error inline only when
          // BOTH AI and cosine fail. For now record but don't crash.
          console.warn('suggestNoteLinks failed', ce.rawMessage || ce.message);
        });

      const accCosine: NoteConnection[] = [];
      const cosinePromise = getNoteConnectionsStream(noteId, (c) => {
        if (cancelled) return;
        accCosine.push(c);
        setCosineConns([...accCosine]);
      }).catch((e: unknown) => {
        if (cancelled) return;
        const ce = ConnectError.from(e);
        // Embeddings may not exist yet — silent.
        console.warn('getNoteConnectionsStream failed', ce.rawMessage || ce.message);
      });

      await Promise.allSettled([aiPromise, cosinePromise]);
      if (!cancelled) setLoadingNotes(false);

      // Atlas — single best-token prefix search. Empty token → skip.
      const atlasQuery = pickAtlasQuery(noteTitle, noteBody);
      if (!atlasQuery) {
        if (!cancelled) {
          setAtlas([]);
          setLoadingAtlas(false);
        }
        return;
      }
      try {
        const items = await searchAtlasTopics(atlasQuery, 3);
        if (!cancelled) setAtlas(items);
      } catch (e) {
        if (!cancelled) {
          const ce = ConnectError.from(e);
          console.warn('searchAtlasTopics failed', ce.rawMessage || ce.message);
          setAtlas([]);
        }
      } finally {
        if (!cancelled) setLoadingAtlas(false);
      }
    }

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
    // noteTitle/body intentionally NOT in deps — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, collapsed]);

  // ── Derived: merged + filtered items ─────────────────────────────────────
  const items = useMemo<PanelItem[]>(() => {
    if (!noteId) return [];

    // AI sugg = the authoritative "Related Notes" list. We dedupe cosine
    // links against AI's targetNoteId set so we don't show the same note
    // twice. Cosine items act as "more like this" fallback when AI is empty.
    const aiIds = new Set(aiSuggs.map((s) => s.targetNoteId));

    const noteItems: PanelItem[] = [
      ...aiSuggs.map<PanelItem>((s, i) => ({
        key: `ai:${s.targetNoteId}`,
        kind: 'note' as const,
        title: s.targetTitle || '(untitled)',
        snippet: s.reason || s.snippet || '',
        score: s.score,
        reason: s.reason,
        target: s.targetNoteId,
        isAccent: i === 0,
      })),
      ...cosineConns
        .filter((c) => c.kind === 'note' && !aiIds.has(c.targetId))
        .slice(0, 3)
        .map<PanelItem>((c) => ({
          key: `cos:${c.targetId}`,
          kind: 'note' as const,
          title: c.displayTitle || '(untitled)',
          snippet: c.snippet,
          score: c.similarity,
          reason: '',
          target: c.targetId,
          isAccent: false,
        })),
    ];

    const atlasItems: PanelItem[] = atlas.map<PanelItem>((a) => ({
      key: `atlas:${a.atlasNodeId}`,
      kind: 'atlas' as const,
      title: a.title,
      snippet: a.section ? `Atlas · ${a.section}` : 'Atlas',
      score: -1, // no score for prefix-matched Atlas results
      reason: '',
      target: `${WEB_BASE_URL}/atlas?focus=${encodeURIComponent(a.atlasNodeId)}`,
      isAccent: false,
    }));

    // Codex — TODO: no Codex retrieval RPC exists in proto/druz9/v1/codex.proto
    // for "related to this note content". Repurpose for non-note Connection
    // kinds (pr/task/session/book) to keep the chip useful. Empty in
    // practice today — that's fine, the chip just shows the empty-state.
    const codexItems: PanelItem[] = cosineConns
      .filter((c) => c.kind !== 'note')
      .slice(0, 3)
      .map<PanelItem>((c) => ({
        key: `cod:${c.kind}:${c.targetId}`,
        kind: 'codex' as const,
        title: c.displayTitle || `(${c.kind})`,
        snippet: c.snippet,
        score: c.similarity,
        reason: '',
        target: c.targetId,
        isAccent: false,
      }));

    const all = [...noteItems, ...atlasItems, ...codexItems];

    switch (filter) {
      case 'notes':
        return all.filter((it) => it.kind === 'note');
      case 'atlas':
        return all.filter((it) => it.kind === 'atlas');
      case 'codex':
        return all.filter((it) => it.kind === 'codex');
      default:
        return all;
    }
  }, [aiSuggs, cosineConns, atlas, filter, noteId]);

  // Reset focus when items change.
  useEffect(() => {
    setFocusedIndex(-1);
  }, [items.length, noteId]);

  // ── Keyboard nav: ↑/↓/Enter on the panel root ────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < items.length) {
        e.preventDefault();
        activate(items[focusedIndex]);
      } else if (e.key === 'Escape') {
        // Esc collapses the panel — graceful exit hatch.
        e.preventDefault();
        onToggleCollapsed();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, focusedIndex],
  );

  const activate = useCallback(
    (it: PanelItem) => {
      analytics.track(ANALYTICS_EVENTS.note_link_clicked, { kind: it.kind });
      if (it.kind === 'note' || it.kind === 'codex') {
        // Codex items today are session/pr/task — they share id namespace
        // with notes for the 'note' kind only; other kinds we don't route
        // anywhere (no deep link spec) — open as note id if shaped like
        // one. Safest: only open as note.
        if (it.kind === 'note') onPickNote(it.target);
      } else if (it.kind === 'atlas') {
        // External URL → system browser via preload bridge.
        void window.hone?.shell.openExternal(it.target);
      }
    },
    [onPickNote],
  );

  // ── Collapsed state — render a thin re-open rail ─────────────────────────
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="focus-ring"
        title="Show connections (⌘⇧J)"
        aria-label="Show connections panel"
        style={{
          width: 28,
          height: '100%',
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          borderLeft: '1px solid var(--hair)',
          color: 'var(--ink-40)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingTop: 96,
          gap: 6,
          transition: 'color var(--t-fast), background var(--t-fast)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-40)';
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 9,
            letterSpacing: '0.16em',
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            textTransform: 'uppercase',
          }}
        >
          Connections
        </span>
      </button>
    );
  }

  // ── Expanded panel ───────────────────────────────────────────────────────
  return (
    <aside
      className="fadein"
      onKeyDown={onKeyDown}
      tabIndex={-1}
      aria-label="Note connections"
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg)',
        borderLeft: '1px solid var(--hair)',
        overflow: 'hidden',
      }}
    >
      {/* Header — flush with Notes top padding so it reads as part of the layout. */}
      <header
        style={{
          padding: '92px 18px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          borderBottom: '1px solid var(--hair)',
          flex: '0 0 auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              color: 'var(--ink-40)',
              textTransform: 'uppercase',
            }}
          >
            Connections
          </span>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="focus-ring"
            title="Hide panel (⌘⇧J)"
            aria-label="Hide connections panel"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ink-40)',
              cursor: 'pointer',
              fontSize: 14,
              lineHeight: 1,
              padding: 4,
              borderRadius: 4,
              transition: 'color var(--t-fast)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-40)';
            }}
          >
            ›
          </button>
        </div>

        {/* Filter chips — wrap on narrow widths. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
          {(['all', 'notes', 'atlas', 'codex'] as ConnectionFilter[]).map((f) => (
            <FilterChip
              key={f}
              label={f}
              active={filter === f}
              onClick={() => setFilter(f)}
            />
          ))}
        </div>
      </header>

      {/* Body — items list. */}
      <div
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          padding: '14px 14px 28px',
          minWidth: 0,
        }}
      >
        {!noteId && <EmptyState text="Pick a note to see related ideas." />}
        {noteId && error && (
          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              color: 'var(--red)',
              textTransform: 'uppercase',
              padding: '8px 0',
            }}
          >
            {error}
          </div>
        )}
        {noteId && !error && (loadingNotes || loadingAtlas) && items.length === 0 && (
          <LoadingSkeletons />
        )}
        {noteId && !error && !loadingNotes && !loadingAtlas && items.length === 0 && (
          <EmptyState text="No related notes yet. Write more to build connections." />
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((it, idx) => (
            <ConnectionItemRow
              key={it.key}
              item={it}
              focused={idx === focusedIndex}
              hovered={hoveredKey === it.key}
              onHover={(k) => setHoveredKey(k)}
              onActivate={() => activate(it)}
              onFocus={() => setFocusedIndex(idx)}
            />
          ))}
        </ul>
      </div>

      {/* Footer — shortcut hint. */}
      <footer
        className="mono"
        style={{
          padding: '10px 18px 12px',
          borderTop: '1px solid var(--hair)',
          flex: '0 0 auto',
          fontSize: 9,
          letterSpacing: '0.12em',
          color: 'var(--ink-40)',
          textTransform: 'uppercase',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>⌘⇧J · toggle</span>
        <span>↑↓ Enter</span>
      </footer>
    </aside>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

interface FilterChipProps {
  label: ConnectionFilter;
  active: boolean;
  onClick: () => void;
}

const FilterChip = memo(function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring mono"
      aria-pressed={active}
      style={{
        padding: '4px 10px',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        background: active ? 'var(--hair-2)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-60)',
        border: '1px solid',
        borderColor: active ? 'var(--hair-2)' : 'var(--hair)',
        borderRadius: 4,
        cursor: 'pointer',
        minWidth: 0,
        transition: 'background var(--t-fast), color var(--t-fast), border-color var(--t-fast)',
      }}
    >
      {label}
    </button>
  );
});

interface ConnectionItemRowProps {
  item: PanelItem;
  focused: boolean;
  hovered: boolean;
  onHover: (key: string | null) => void;
  onActivate: () => void;
  onFocus: () => void;
}

const ConnectionItemRow = memo(function ConnectionItemRow({
  item,
  focused,
  hovered,
  onHover,
  onActivate,
  onFocus,
}: ConnectionItemRowProps) {
  const showPreview = hovered && item.snippet.length > 80;
  return (
    <li
      style={{
        position: 'relative',
        padding: '10px 12px 10px 12px',
        marginBottom: 4,
        borderRadius: 4,
        borderLeft: item.isAccent ? '1.5px solid var(--red)' : '1.5px solid transparent',
        background: focused
          ? 'var(--hair-2)'
          : hovered
          ? 'var(--hair)'
          : 'transparent',
        transition: 'background var(--t-fast)',
        cursor: item.kind === 'codex' ? 'default' : 'pointer',
        minWidth: 0,
      }}
      onMouseEnter={() => onHover(item.key)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        type="button"
        onClick={onActivate}
        onFocus={onFocus}
        className="focus-ring"
        disabled={item.kind === 'codex'}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'inherit',
          cursor: item.kind === 'codex' ? 'default' : 'pointer',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            alignItems: 'baseline',
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 13,
              color: 'var(--ink)',
              lineHeight: 1.35,
              minWidth: 0,
              flex: '1 1 auto',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.title}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 9,
              color: 'var(--ink-40)',
              flexShrink: 0,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {item.kind === 'atlas'
              ? 'atlas'
              : item.score >= 0
              ? `${(item.score * 100).toFixed(0)}%`
              : ''}
          </span>
        </div>
        {item.snippet && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: 'var(--ink-60)',
              lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontStyle: item.reason ? 'italic' : 'normal',
            }}
          >
            {item.snippet}
          </div>
        )}
      </button>

      {/* Hover preview card — only when content extends beyond the 2-line clamp. */}
      {showPreview && <PreviewCard item={item} />}
    </li>
  );
});

const PreviewCard = memo(function PreviewCard({ item }: { item: PanelItem }) {
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        right: 'calc(100% + 8px)',
        top: 0,
        width: 320,
        maxWidth: '60vw',
        background: 'var(--surface)',
        border: '1px solid var(--hair-2)',
        borderRadius: 6,
        padding: '12px 14px',
        zIndex: 30,
        pointerEvents: 'none',
        boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
      }}
    >
      <div
        style={{
          fontSize: 13,
          color: 'var(--ink)',
          marginBottom: 6,
          lineHeight: 1.35,
        }}
      >
        {item.title}
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--ink-60)',
          lineHeight: 1.5,
        }}
      >
        {item.snippet}
      </div>
      {item.score >= 0 && (
        <div
          className="mono"
          style={{
            marginTop: 8,
            fontSize: 9,
            color: 'var(--ink-40)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {item.kind} · {(item.score * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
});

function LoadingSkeletons(): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <SkeletonLine width="70%" height={11} />
          <SkeletonLine width="95%" height={9} />
          <SkeletonLine width="55%" height={9} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }): React.ReactElement {
  return (
    <p
      style={{
        margin: '24px 12px',
        fontSize: 12,
        color: 'var(--ink-60)',
        lineHeight: 1.5,
      }}
    >
      {text}
    </p>
  );
}
