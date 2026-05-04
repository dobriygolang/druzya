// TrackSwitcher — header dropdown для active study mode.
//
// Persist'ится в hone_user_settings via api/hone.setActiveTrack. Контент
// Today / Tasks / Reading фильтруется по выбранному track'у (см. useTrackFilter).
import { useEffect, useState } from 'react';

import type { ActiveTrack } from '../api/hone';
import { TRACK_LABELS, useTrackStore } from '../stores/track';

// Sergey 2026-05-03: ML — drop'аем как hardcoded track (custom tracks
// заменят). English — orthogonal modifier (toggle в Settings), не trackmode.
// Switcher остаётся: general / dev / go.
const ORDER: ActiveTrack[] = ['general', 'dev', 'go'];

export function TrackSwitcher() {
  const activeTrack = useTrackStore((s) => s.activeTrack);
  const hydrated = useTrackStore((s) => s.hydrated);
  const hydrate = useTrackStore((s) => s.hydrate);
  const setTrack = useTrackStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const onPick = async (t: ActiveTrack) => {
    setOpen(false);
    if (t === activeTrack || busy) return;
    setBusy(true);
    try {
      await setTrack(t);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        left: 110,
        zIndex: 10,
        // @ts-expect-error — Electron CSS extension
        WebkitAppRegion: 'no-drag',
      }}
      className="no-select"
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="mono focus-ring"
        style={{
          fontSize: 10,
          letterSpacing: '0.18em',
          color: 'var(--ink-60)',
          background: 'transparent',
          padding: '4px 8px',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 4,
          textTransform: 'uppercase',
          cursor: 'pointer',
          opacity: busy ? 0.5 : 1,
        }}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {TRACK_LABELS[activeTrack]} ▾
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 28,
            left: 0,
            background: 'var(--bg-elevated, #161616)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 4,
            minWidth: 160,
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {ORDER.map((t) => (
            <button
              key={t}
              role="option"
              aria-selected={t === activeTrack}
              onClick={() => void onPick(t)}
              className="mono focus-ring"
              style={{
                fontSize: 10,
                letterSpacing: '0.16em',
                color: t === activeTrack ? 'var(--ink-90)' : 'var(--ink-60)',
                background: t === activeTrack ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: 'none',
                padding: '6px 8px',
                textAlign: 'left',
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {TRACK_LABELS[t]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
