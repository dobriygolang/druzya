// MemoryTimeline — Phase B preview surface для identity «AI-coach с памятью».
//
// Brainstorm 2026-05-12: «memory-as-UX prototype» — единый экран что Coach
// знает про юзера, grouped by source (Hone / Cue / mock / coach). Без этого
// identity «AI-coach с памятью» не materialize'тся в mental model юзера.
//
// Rendering:
//   - header: total count + by-source chips (filter)
//   - timeline: groups by day (today / yesterday / ISO date), within group
//     newest first. Каждая row показывает source chip + content + occurred_at.
//   - empty state: явный CTA «open Cue / write notes / take mock» — entries
//     приходят side-effect'ом этих actions.
//
// Privacy: юзер может soft-delete entry (server hides from coach reads but
// keeps row для audit). Edit ещё не wired здесь — это Phase B+ scope.
import React, { useMemo, useState } from 'react';

import { listMemoryEntries, deleteMemoryEntry, type MemoryEntry } from '../api/intelligence';
import { useDataState } from '../hooks/useDataState';
import { trackEvent } from '../api/events';
import { openWebProfileMemory } from '../lib/cross-app-links';

const monoFont = '"JetBrains Mono", ui-monospace, monospace';

type SourceFilter = 'all' | 'hone' | 'cue' | 'mock' | 'coach';

const SOURCE_LABEL: Record<SourceFilter, string> = {
  all: 'all',
  hone: 'hone',
  cue: 'cue',
  mock: 'mock',
  coach: 'coach',
};

export const MemoryTimelinePage: React.FC = () => {
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [reload, setReload] = useState(0);

  const memoryState = useDataState(
    () => listMemoryEntries({ limit: 100 }),
    [reload],
  );

  const items = memoryState.data?.items ?? [];
  const total = memoryState.data?.total ?? 0;

  // Source counts для chips. Считаем над full result (не filtered) — чипсы
  // показывают сколько в каждой категории, а не сколько отфильтровано.
  const sourceCounts = useMemo(() => {
    const m: Record<string, number> = { all: items.length };
    for (const e of items) {
      const k = e.source || 'coach';
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [items]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((e) => (e.source || 'coach') === filter);
  }, [items, filter]);

  // Group by day bucket: today / yesterday / earlier ISO date.
  const grouped = useMemo(() => groupByDay(filteredItems), [filteredItems]);

  async function handleDelete(id: string) {
    const ok = window.confirm('Удалить из памяти Coach? AI больше не будет ссылаться на этот entry.');
    if (!ok) return;
    try {
      await deleteMemoryEntry(id);
      trackEvent('memory_entry_delete');
      setReload((n) => n + 1);
    } catch {
      // best-effort UX — silent fail; refetch покажет если backend rejected.
      setReload((n) => n + 1);
    }
  }

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        padding: '64px 32px 28px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="mono" style={monoCaption}>memory · timeline</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
          What hone remembers about you
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-60)', margin: 0, maxWidth: 580 }}>
          {total === 0
            ? 'Память пуста. Открой Cue meeting, напиши заметку или пройди mock — Coach начнёт собирать контекст.'
            : `${total} entries · показано ${filteredItems.length}. AI ссылается на это в daily brief / next-action / fork analysis.`}
        </p>
      </header>

      {/* Source filter chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['all', 'hone', 'cue', 'mock', 'coach'] as SourceFilter[]).map((s) => {
          const active = filter === s;
          const count = sourceCounts[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              aria-pressed={active}
              style={{
                fontSize: 11,
                padding: '5px 12px',
                borderRadius: 999,
                border: '1px solid var(--ink-20)',
                background: active ? 'var(--ink)' : 'transparent',
                color: active ? 'var(--bg)' : 'var(--ink-60)',
                cursor: 'pointer',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontFamily: monoFont,
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>{SOURCE_LABEL[s]}</span>
              <span style={{ opacity: 0.5 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {memoryState.status === 'loading' && (
        <div style={dim}>загружается…</div>
      )}

      {memoryState.status === 'error' && (
        <div style={errorPanel}>
          <span>Не удалось загрузить память: {memoryState.error?.message ?? 'unknown'}</span>
          <button type="button" onClick={memoryState.refetch} style={retryBtn}>retry</button>
        </div>
      )}

      {memoryState.status === 'ready' && grouped.length === 0 && (
        <EmptyHint />
      )}

      {grouped.map((group) => (
        <section key={group.label} style={groupSection}>
          <div className="mono" style={groupHeader}>{group.label}</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {group.entries.map((e) => (
              <MemoryRow key={e.id} entry={e} onDelete={() => void handleDelete(e.id)} />
            ))}
          </ul>
        </section>
      ))}

      {/* X5 (Phase J P2 2026-05-12) — bigger context lives on web. Hone
          shows compact timeline + delete; full edit + bulk operations
          require the web profile/memory surface. */}
      {total > 0 && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={() => {
              trackEvent('cross_app_open', { source: 'memory_timeline_footer', target: 'web_profile_memory' });
              openWebProfileMemory();
            }}
            className="mono"
            style={{
              background: 'transparent',
              border: 0,
              padding: 0,
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-60)',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
              cursor: 'pointer',
            }}
          >
            edit full memory on web →
          </button>
        </div>
      )}
    </div>
  );
};

const MemoryRow: React.FC<{ entry: MemoryEntry; onDelete: () => void }> = ({ entry, onDelete }) => {
  const source = entry.source || 'coach';
  return (
    <li
      style={{
        display: 'grid',
        gridTemplateColumns: '64px 1fr auto',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 6,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-60)',
          paddingTop: 2,
        }}
      >
        {source}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-90)', lineHeight: 1.45, wordBreak: 'break-word' }}>
          {entry.content}
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-40)', marginTop: 4, letterSpacing: '0.04em' }}>
          {entry.kind}
          {entry.editedAt && <span style={{ marginLeft: 8 }}>· edited</span>}
          {entry.occurredAt && <span style={{ marginLeft: 8 }}>{relTime(entry.occurredAt)}</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        title="Удалить из памяти"
        aria-label="Delete memory entry"
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'var(--ink-60)',
          borderRadius: 4,
          padding: '3px 8px',
          fontSize: 10,
          fontFamily: monoFont,
          cursor: 'pointer',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        del
      </button>
    </li>
  );
};

const EmptyHint: React.FC = () => (
  <div
    style={{
      padding: '20px 18px',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 8,
      color: 'var(--ink-60)',
      fontSize: 13,
      lineHeight: 1.55,
      maxWidth: 600,
    }}
  >
    <div style={{ fontSize: 12, color: 'var(--ink-40)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
      memory empty
    </div>
    Память Coach наполняется side-effect'ом твоих действий:
    <ul style={{ paddingLeft: 18, margin: '8px 0' }}>
      <li>Cue session → ingest → episode kind=cue_session</li>
      <li>Reflection после focus → kind=reflection</li>
      <li>Mock complete → kind=mock_pipeline_finished</li>
      <li>Note create / external activity log → kind=external_activity</li>
    </ul>
    Открой одну из этих surface — entries появятся через минуту.
  </div>
);

interface DayGroup {
  label: string;
  entries: MemoryEntry[];
}

function groupByDay(items: MemoryEntry[]): DayGroup[] {
  if (items.length === 0) return [];
  const today = startOfDay(new Date());
  const yesterday = startOfDay(new Date(today.getTime() - 86_400_000));
  const groups = new Map<string, MemoryEntry[]>();
  for (const e of items) {
    if (!e.occurredAt) continue;
    const day = startOfDay(e.occurredAt);
    const label =
      day.getTime() === today.getTime()
        ? 'today'
        : day.getTime() === yesterday.getTime()
          ? 'yesterday'
          : day.toISOString().slice(0, 10);
    const arr = groups.get(label) ?? [];
    arr.push(e);
    groups.set(label, arr);
  }
  return Array.from(groups.entries()).map(([label, entries]) => ({
    label,
    entries: entries.sort((a, b) => (b.occurredAt?.getTime() ?? 0) - (a.occurredAt?.getTime() ?? 0)),
  }));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function relTime(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

// ── styles ─────────────────────────────────────────────────────────────

const monoCaption: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

const dim: React.CSSProperties = {
  color: 'var(--ink-60)',
  fontSize: 13,
};

const errorPanel: React.CSSProperties = {
  padding: '10px 14px',
  background: 'rgba(255,59,48,0.08)',
  borderTop: '1.5px solid #FF3B30',
  borderRadius: 6,
  color: 'var(--ink-90)',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const retryBtn: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.18)',
  color: 'var(--ink)',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: monoFont,
  cursor: 'pointer',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const groupSection: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const groupHeader: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
  paddingBottom: 4,
  borderBottom: '1px solid rgba(255,255,255,0.05)',
};
