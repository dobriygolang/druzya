// Notes — two-column list/editor. Static mock corpus for MVP; the
// ListNotes RPC exists backend-side and drops in on a prop change.
//
// The design deliberately omits a title input and a toolbar. Two columns,
// markdown rendered as a `<pre>` (no parser yet) — Phase 5c adds the
// markdown renderer and the ⌘J connections panel. Keep the connections
// hint in the corner so the feature is discoverable without requiring
// a visible dead zone.
import { useState } from 'react';

import { Kbd } from '../components/primitives/Kbd';

interface Note {
  id: string;
  t: string;
  body: string;
}

const NOTES: Note[] = [
  {
    id: 'redis',
    t: 'Redis locks · rate limiter',
    body:
      'Race between INCR and EXPIRE. Use a Lua script — atomic INCR + conditional EXPIRE if value == 1.\n\n  local c = redis.call("INCR", KEYS[1])\n  if c == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end\n  return c\n\nOpen: what happens on failover?',
  },
  {
    id: 'english',
    t: 'English — phrasal shadowing',
    body:
      'Daily, 15 min, before standup.\n\n— Shadow one podcast segment, 30 seconds.\n— Chase rhythm, not accent.\n— Weak cluster: conditional + past perfect.',
  },
  {
    id: 'sd',
    t: 'System design refs',
    body:
      "DDIA ch. 7 — transactions.\nMarc Brooker — shuffle sharding.\nAmazon builders' library — timeouts, retries, backoff.",
  },
  {
    id: 'ru',
    t: 'Рейтинг — мысли',
    body:
      'Новичкам не показывать абсолютные числа.\n\nПоказывать «относительно когорты», не глобальный rank.\nСделать A/B.',
  },
  {
    id: 'idea',
    t: 'Idea · focus queue as .ics',
    body: 'Export focus queue as an ICS feed so calendar picks it up automatically.',
  },
];

export function NotesPage() {
  const [sel, setSel] = useState('redis');
  const note = NOTES.find((n) => n.id === sel) ?? NOTES[0]!;

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 120,
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
      }}
    >
      <aside
        style={{
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: '0 10px',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '6px 14px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-40)', flex: 1 }}>Search…</span>
          <Kbd>⌘P</Kbd>
        </div>
        <button
          className="focus-ring"
          style={{
            width: 'calc(100% - 12px)',
            margin: '0 6px 10px',
            padding: '8px 12px',
            borderRadius: 7,
            border: '1px solid rgba(255,255,255,0.06)',
            fontSize: 12.5,
            color: 'var(--ink-60)',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ opacity: 0.6 }}>+</span> New note
          <span style={{ marginLeft: 'auto' }}>
            <Kbd>⌘N</Kbd>
          </span>
        </button>
        {NOTES.map((n) => {
          const active = sel === n.id;
          return (
            <button
              key={n.id}
              onClick={() => setSel(n.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '11px 14px',
                margin: '1px 0',
                borderRadius: 7,
                color: active ? 'var(--ink)' : 'var(--ink-60)',
                background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
                fontSize: 13.5,
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--ink)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--ink-60)';
              }}
            >
              {n.t}
            </button>
          );
        })}
      </aside>
      <section style={{ padding: '10px 56px 0 56px', position: 'relative', overflowY: 'auto' }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 500, letterSpacing: '-0.015em' }}>
          {note.t}
        </h1>
        <pre
          className="mono"
          style={{
            margin: '26px 0 0',
            fontSize: 13,
            lineHeight: 1.75,
            color: 'var(--ink-90)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {note.body}
        </pre>
        <div
          className="mono"
          style={{
            position: 'absolute',
            bottom: 8,
            right: 56,
            fontSize: 10,
            color: 'var(--ink-40)',
          }}
        >
          ⌘J for connections
        </div>
      </section>
    </div>
  );
}
