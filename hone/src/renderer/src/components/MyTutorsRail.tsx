// Layout: «3 tutors · Alice recently active». Single-line, mono-caption
// rhythm to match the rest of Hone's minimalist language. Hidden when
// student has zero tutors or fetch fails (rail is non-critical).
//
// Differs from the web /today MyTutorsCard:
//  - Web variant is multi-row per-tutor with avatars + status dots.
//  - Hone rail is a one-line summary — the focus surface stays sparse.
//
// B/W rule: no green/red; «recently active» is signalled только by being
// named in the rail (most-recently-active first sort comes from server).
import { useEffect, useState } from 'react';

import { listMyTutorsActivity, type MyTutorActivitySummary } from '../api/tutor';

const ACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface Props {
  /** Hide entirely during focus session — caller passes the running flag. */
  running?: boolean;
}

export function MyTutorsRail({ running = false }: Props) {
  const [items, setItems] = useState<MyTutorActivitySummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyTutorsActivity(7)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]); // Silent on failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hidden during focus, while loading, or when zero tutors.
  if (running) return null;
  if (items === null) return null;
  if (items.length === 0) return null;

  const freshNames = items
    .filter((it) => {
      if (!it.lastActiveAt) return false;
      return Date.now() - it.lastActiveAt.getTime() < ACTIVE_THRESHOLD_MS;
    })
    .map((it) => it.tutorDisplayName || it.tutorUsername || 'tutor')
    .slice(0, 2);

  const total = items.length;
  const tutorWord = total === 1 ? 'tutor' : 'tutors';

  let trailing = '';
  if (freshNames.length === 0) {
    // No tutors active in last 24h — show «N tutors · recently quiet».
    trailing = 'recently quiet';
  } else if (freshNames.length === 1) {
    trailing = `${freshNames[0]} recently active`;
  } else {
    trailing = `${freshNames.join(', ')} active`;
  }

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.4)',
        padding: '6px 12px',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 999,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
      }}
      title="Your active tutors"
    >
      <span>{total} {tutorWord}</span>
      <span aria-hidden="true" style={{ opacity: 0.4 }}>·</span>
      <span>{trailing}</span>
    </div>
  );
}
