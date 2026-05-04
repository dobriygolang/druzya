// DeveloperToolsSection — Phase 7 §7a (Sergey 2026-05-04 Path C low-key).
//
// Collapsed-by-default section в Settings. Single manual entry-point для
// standalone collab rooms (code/whiteboard). NO palette / nav / promo —
// см memory/feedback_path_c_rooms.md.
//
// Free-tier 3 active · 24h TTL · 3 ppl max. После create — открывает
// share URL в new tab.
import { useEffect, useState } from 'react';

import {
  createStandaloneRoom,
  deleteRoom,
  listMyRooms,
  restoreRoom,
  type Room,
  type RoomKind,
  type RoomQuota,
} from '../api/rooms';

export function DeveloperToolsSection() {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [quota, setQuota] = useState<RoomQuota | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await listMyRooms('all');
      setRooms(r.rooms);
      setQuota(r.quota);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (open && quota === null) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function doCreate(kind: RoomKind) {
    setBusy(kind);
    setError(null);
    try {
      const r = await createStandaloneRoom(kind, '');
      // Open share URL в new tab — Hone-renderer использует electron <a target>.
      if (r.shareUrl) {
        window.open(r.shareUrl, '_blank', 'noopener,noreferrer');
      }
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('quota') || msg.includes('exceeded')) {
        setError('free-tier limit reached (3 active). delete or upgrade.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(null);
    }
  }

  async function doDelete(r: Room) {
    setBusy(r.id);
    try {
      await deleteRoom(r.kind, r.id);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function doRestore(r: Room) {
    setBusy(r.id);
    try {
      await restoreRoom(r.kind, r.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const now = Date.now();
  const active = rooms.filter((r) => !r.archivedAt && (r.expiresAt?.getTime() ?? 0) > now);
  const past = rooms.filter((r) => r.archivedAt || (r.expiresAt?.getTime() ?? 0) <= now);

  return (
    <section style={{ margin: '0 0 44px' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="power user feature"
        className="mono"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.55)',
          fontSize: 10,
          letterSpacing: '.24em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>developer tools</span>
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>· optional · advanced</span>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              padding: '14px 16px',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 6,
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div className="mono" style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>
              collaboration rooms
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 12 }}>
              {quota
                ? `active ${quota.activeCount} of ${quota.maxActive} · tier ${quota.tier}`
                : 'loading…'}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => void doCreate('code')}
                disabled={busy === 'code'}
                className="mono"
                style={btn()}
              >
                {busy === 'code' ? 'creating…' : '+ code room'}
              </button>
              <button
                type="button"
                onClick={() => void doCreate('whiteboard')}
                disabled={busy === 'whiteboard'}
                className="mono"
                style={btn()}
              >
                {busy === 'whiteboard' ? 'creating…' : '+ whiteboard'}
              </button>
            </div>

            {error && (
              <div className="mono" style={{ fontSize: 11, color: '#FF3B30', marginBottom: 10 }}>
                {error}
              </div>
            )}

            {active.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="mono" style={hdr()}>active · {active.length}</div>
                {active.map((r) => (
                  <RoomRow key={r.id} room={r} busy={busy === r.id} onDelete={() => void doDelete(r)} />
                ))}
              </div>
            )}

            {past.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="mono" style={hdr()}>past · {past.length} · 30d restore window</div>
                {past.map((r) => (
                  <RoomRow
                    key={r.id}
                    room={r}
                    past
                    busy={busy === r.id}
                    onRestore={() => void doRestore(r)}
                  />
                ))}
              </div>
            )}

            <div className="mono" style={{ marginTop: 14, fontSize: 9.5, color: 'rgba(255,255,255,0.35)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
              free tier: 3 active · 24h ttl · 3 ppl max
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RoomRow({
  room,
  past,
  busy,
  onDelete,
  onRestore,
}: {
  room: Room;
  past?: boolean;
  busy: boolean;
  onDelete?: () => void;
  onRestore?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        marginTop: 6,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 4,
      }}
    >
      <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
        {room.kind}
      </span>
      <a
        href={room.kind === 'code' ? `/editor/room/${room.id}` : `/whiteboard/room/${room.id}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.85)',
          textDecoration: 'none',
          borderBottom: '1px dashed rgba(255,255,255,0.18)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {room.title || `${room.kind} · ${room.id.slice(0, 8)}`}
      </a>
      <span className="mono" style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.3)' }}>
        {room.expiresAt ? formatExpiry(room.expiresAt) : ''}
      </span>
      {past && onRestore && (
        <button type="button" disabled={busy} onClick={onRestore} className="mono" style={btnSmall()}>
          restore
        </button>
      )}
      {!past && onDelete && (
        <button type="button" disabled={busy} onClick={onDelete} className="mono" style={btnSmall()}>
          delete
        </button>
      )}
    </div>
  );
}

function formatExpiry(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / (1000 * 60 * 60));
  if (h < 24) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

function hdr(): React.CSSProperties {
  return {
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    marginBottom: 4,
  };
}

function btn(): React.CSSProperties {
  return {
    padding: '6px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.85)',
    borderRadius: 4,
    fontSize: 11,
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

function btnSmall(): React.CSSProperties {
  return {
    padding: '3px 8px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.55)',
    borderRadius: 3,
    fontSize: 9.5,
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
