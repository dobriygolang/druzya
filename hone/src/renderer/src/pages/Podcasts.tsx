// Podcasts — страница прослушивания подкастов из Codex'а.
//
// Лево — resizable sidebar (drag-handle сохраняет ширину в localStorage).
// Право — плеер с аудио + description + animated transport. Прогресс
// пушим throttled UpdateProgress (раз в 5 сек + при pause/seek/ended).
// Auto-complete флиппается бекендом когда осталось <10 сек.
//
// Audio URL'ы — MinIO presigned, TTL 45 мин. Если юзер слушает длинный
// подкаст > 45 мин без скипа — рефетчим catalog (silent refresh).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import { Icon } from '../components/primitives/Icon';
import {
  listPodcasts,
  updatePodcastProgress,
  Section,
  type Podcast,
} from '../api/podcast';

interface FetchState {
  status: 'loading' | 'ok' | 'error';
  items: Podcast[];
  error: string | null;
  errorCode: Code | null;
}

const INITIAL: FetchState = { status: 'loading', items: [], error: null, errorCode: null };

const PROGRESS_THROTTLE_MS = 5000;
const CATALOG_STALE_MS = 40 * 60 * 1000;

const SIDEBAR_KEY = 'hone:podcasts:sidebar-w';
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 320;

function sectionLabel(s: Section): string {
  switch (s) {
    case Section.ALGORITHMS:
      return 'Algorithms';
    case Section.SQL:
      return 'SQL';
    case Section.GO:
      return 'Go';
    case Section.SYSTEM_DESIGN:
      return 'System Design';
    case Section.BEHAVIORAL:
      return 'Behavioral';
    default:
      return '';
  }
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Стабильно-весёлые empty-state'ы — выбираем по hash секции/времени,
// чтобы не дёргалось на каждом render'е.
const EMPTY_LINES = [
  'Тут пробегал тушканчик. Унёс все эпизоды.',
  'Студия пустая. Микрофон скучает.',
  'Тишина — тоже подкаст. Самый длинный.',
  'Кошка села на mute. Ничего не слышно.',
  'Эпизоды ушли в отпуск. Без даты возвращения.',
];
function emptyLine(seed: number): string {
  return EMPTY_LINES[Math.abs(seed) % EMPTY_LINES.length]!;
}

export function PodcastsPage() {
  const [state, setState] = useState<FetchState>(INITIAL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(Section.UNSPECIFIED);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [sidebarW, setSidebarW] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT;
    const raw = window.localStorage.getItem(SIDEBAR_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return SIDEBAR_DEFAULT;
    return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n));
  });

  const load = useCallback(async (s: Section) => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const items = await listPodcasts(s);
      setState({ status: 'ok', items, error: null, errorCode: null });
      setFetchedAt(Date.now());
    } catch (err: unknown) {
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
    void load(section);
  }, [section, load]);

  const selected = useMemo(
    () => state.items.find((p) => p.id === selectedId) ?? null,
    [state.items, selectedId],
  );

  useEffect(() => {
    if (!selectedId && state.items.length > 0) {
      setSelectedId(state.items[0]!.id);
    }
  }, [state.items, selectedId]);

  useEffect(() => {
    if (!selected) return;
    if (Date.now() - fetchedAt > CATALOG_STALE_MS) {
      void load(section);
    }
  }, [selected, fetchedAt, section, load]);

  // Persist sidebar width.
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, String(sidebarW));
    } catch {
      /* ignore quota */
    }
  }, [sidebarW]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 120,
        display: 'grid',
        gridTemplateColumns: `${sidebarW}px 6px 1fr`,
      }}
    >
      <aside
        className="slide-from-left"
        style={{
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: '0 10px',
          overflowY: 'auto',
          animationDuration: '320ms',
        }}
      >
        <SectionFilter value={section} onChange={setSection} />
        {state.status === 'loading' && (
          <p style={{ padding: '12px 14px', fontSize: 12, color: 'var(--ink-40)' }}>Loading…</p>
        )}
        {state.status === 'error' && (
          <p style={{ padding: '12px 14px', fontSize: 12, color: 'var(--ink-40)' }}>
            {state.errorCode === Code.Unauthenticated ? 'Sign in to listen' : 'Catalog offline'}
          </p>
        )}
        {state.items.map((p, i) => (
          <PodcastRow
            key={p.id}
            podcast={p}
            active={selectedId === p.id}
            onSelect={() => setSelectedId(p.id)}
            stagger={i}
          />
        ))}
      </aside>

      <ResizeHandle width={sidebarW} onChange={setSidebarW} />

      <section
        style={{
          padding: '10px 56px',
          overflowY: 'auto',
          minWidth: 0,
        }}
      >
        {selected ? (
          <Player podcast={selected} />
        ) : state.status === 'ok' ? (
          <EmptyState seed={section} />
        ) : null}
      </section>
    </div>
  );
}

function PodcastRow({
  podcast,
  active,
  onSelect,
  stagger,
}: {
  podcast: Podcast;
  active: boolean;
  onSelect: () => void;
  stagger: number;
}) {
  const ratio = podcast.durationSec > 0 ? podcast.progressSec / podcast.durationSec : 0;
  return (
    <button
      onClick={onSelect}
      className="row slide-from-left"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '12px 14px',
        margin: '1px 0',
        borderRadius: 7,
        color: active ? 'var(--ink)' : 'var(--ink-60)',
        background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
        border: 'none',
        cursor: 'pointer',
        animationDelay: `${Math.min(stagger * 30, 300)}ms`,
        animationDuration: '280ms',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 13.5, lineHeight: 1.3, flex: 1 }}>{podcast.title}</span>
        {podcast.completed && (
          <span
            className="mono"
            style={{ fontSize: 9, letterSpacing: '.14em', color: 'var(--ink-40)' }}
          >
            ✓
          </span>
        )}
      </div>
      <div
        className="mono"
        style={{
          marginTop: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 10,
          color: 'var(--ink-40)',
          letterSpacing: '.08em',
        }}
      >
        <span>{sectionLabel(podcast.section)}</span>
        <span>·</span>
        <span>{formatTime(podcast.durationSec)}</span>
      </div>
      {ratio > 0 && !podcast.completed && (
        <div
          style={{
            marginTop: 6,
            height: 2,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, ratio * 100)}%`,
              height: '100%',
              background: 'rgba(255,255,255,0.4)',
              transition: 'width var(--t-base)',
            }}
          />
        </div>
      )}
    </button>
  );
}

function ResizeHandle({
  width,
  onChange,
}: {
  width: number;
  onChange: (w: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, w: 0 });

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startRef.current.x;
      const next = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startRef.current.w + dx));
      onChange(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, onChange]);

  return (
    <div
      onMouseDown={(e) => {
        startRef.current = { x: e.clientX, w: width };
        setDragging(true);
      }}
      style={{
        position: 'relative',
        cursor: 'col-resize',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 2,
          top: 0,
          bottom: 0,
          width: 2,
          background: dragging ? 'rgba(255,255,255,0.18)' : 'transparent',
          transition: 'background-color var(--t-fast)',
        }}
      />
    </div>
  );
}

function EmptyState({ seed }: { seed: number }) {
  return (
    <div
      className="fadein"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 9.5,
          letterSpacing: '.24em',
          color: 'var(--ink-40)',
        }}
      >
        EMPTY
      </div>
      <p
        style={{
          fontSize: 16,
          color: 'var(--ink-60)',
          textAlign: 'center',
          maxWidth: 400,
          lineHeight: 1.5,
        }}
      >
        {emptyLine(seed)}
      </p>
    </div>
  );
}

function SectionFilter({
  value,
  onChange,
}: {
  value: Section;
  onChange: (s: Section) => void;
}) {
  const items: { id: Section; label: string }[] = [
    { id: Section.UNSPECIFIED, label: 'All' },
    { id: Section.ALGORITHMS, label: 'Algo' },
    { id: Section.SQL, label: 'SQL' },
    { id: Section.GO, label: 'Go' },
    { id: Section.SYSTEM_DESIGN, label: 'System' },
    { id: Section.BEHAVIORAL, label: 'Behavioral' },
  ];
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        padding: '6px 12px 14px',
      }}
    >
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className="focus-ring mono row"
            style={{
              padding: '5px 10px',
              fontSize: 10,
              letterSpacing: '.12em',
              borderRadius: 6,
              color: active ? 'var(--ink)' : 'var(--ink-40)',
              background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent';
            }}
          >
            {it.label.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

function Player({ podcast }: { podcast: Podcast }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(podcast.progressSec);
  const [duration, setDuration] = useState(podcast.durationSec);
  const [playing, setPlaying] = useState(false);
  const lastPushedAt = useRef(0);
  const seededRef = useRef<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (seededRef.current === podcast.id) return;
    seededRef.current = podcast.id;
    const onMeta = () => {
      if (audio.duration && Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
      if (podcast.progressSec > 0 && !podcast.completed) {
        audio.currentTime = podcast.progressSec;
        setCurrentTime(podcast.progressSec);
      }
      audio.removeEventListener('loadedmetadata', onMeta);
    };
    audio.addEventListener('loadedmetadata', onMeta);
  }, [podcast.id, podcast.progressSec, podcast.completed]);

  const pushProgress = useCallback(
    (sec: number, forceCompleted?: boolean) => {
      const now = Date.now();
      if (!forceCompleted && now - lastPushedAt.current < PROGRESS_THROTTLE_MS) return;
      lastPushedAt.current = now;
      void updatePodcastProgress({
        podcastId: podcast.id,
        progressSec: Math.floor(sec),
        completed: forceCompleted,
      }).catch(() => {});
    },
    [podcast.id],
  );

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    pushProgress(audio.currentTime);
  };

  const onPlay = () => setPlaying(true);
  const onPauseEvt = () => {
    setPlaying(false);
    const audio = audioRef.current;
    if (audio) pushProgress(audio.currentTime);
  };
  const onEnded = () => {
    setPlaying(false);
    pushProgress(duration, true);
  };
  const onSeeked = () => {
    const audio = audioRef.current;
    if (audio) pushProgress(audio.currentTime);
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        /* autoplay policy */
      }
    } else {
      audio.pause();
    }
  };

  const skip = (deltaSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + deltaSec));
  };

  return (
    <div
      key={podcast.id}
      className="fadein"
      style={{ animationDuration: '320ms' }}
    >
      <div
        className="mono"
        style={{ fontSize: 10, letterSpacing: '.22em', color: 'var(--ink-40)' }}
      >
        {sectionLabel(podcast.section).toUpperCase()} · PODCAST
      </div>
      <h1
        style={{
          margin: '12px 0 18px',
          fontSize: 30,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
        }}
      >
        {podcast.title}
      </h1>
      {podcast.description && (
        <p
          style={{
            fontSize: 14,
            color: 'var(--ink-60)',
            lineHeight: 1.7,
            margin: '0 0 32px',
            maxWidth: 640,
          }}
        >
          {podcast.description}
        </p>
      )}

      <audio
        ref={audioRef}
        src={podcast.audioUrl}
        onTimeUpdate={onTimeUpdate}
        onPlay={onPlay}
        onPause={onPauseEvt}
        onEnded={onEnded}
        onSeeked={onSeeked}
        preload="metadata"
        style={{ display: 'none' }}
      />

      <div style={{ maxWidth: 640 }}>
        <Seekbar
          value={currentTime}
          max={duration || podcast.durationSec}
          playing={playing}
          onChange={(v) => {
            const audio = audioRef.current;
            if (audio) {
              audio.currentTime = v;
              setCurrentTime(v);
            }
          }}
        />
        <div
          className="mono"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 10,
            letterSpacing: '.1em',
            color: 'var(--ink-40)',
            marginTop: 8,
          }}
        >
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration || podcast.durationSec)}</span>
        </div>

        <div
          style={{
            marginTop: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 22,
          }}
        >
          <TransportBtn label="−15" onClick={() => skip(-15)} />
          <PlayButton playing={playing} onClick={() => void toggle()} />
          <TransportBtn label="+30" onClick={() => skip(30)} />
        </div>
      </div>
    </div>
  );
}

function PlayButton({ playing, onClick }: { playing: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="focus-ring surface"
      style={{
        width: 64,
        height: 64,
        borderRadius: 999,
        background: '#fff',
        color: '#000',
        display: 'grid',
        placeItems: 'center',
        border: 'none',
        cursor: 'pointer',
        boxShadow: hover
          ? '0 12px 30px -8px rgba(255,255,255,0.25)'
          : '0 6px 18px -6px rgba(255,255,255,0.15)',
        transform: hover ? 'scale(1.04)' : 'scale(1)',
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.96)')}
      onMouseUp={(e) =>
        (e.currentTarget.style.transform = hover ? 'scale(1.04)' : 'scale(1)')
      }
    >
      <div
        style={{
          position: 'relative',
          width: 18,
          height: 18,
        }}
      >
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            opacity: playing ? 0 : 1,
            transform: playing ? 'scale(0.6) rotate(-30deg)' : 'scale(1) rotate(0)',
            transition: 'opacity var(--t-fast), transform var(--t-base)',
          }}
        >
          <Icon name="play" size={18} />
        </span>
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            opacity: playing ? 1 : 0,
            transform: playing ? 'scale(1) rotate(0)' : 'scale(0.6) rotate(30deg)',
            transition: 'opacity var(--t-fast), transform var(--t-base)',
          }}
        >
          <Icon name="pause" size={18} />
        </span>
      </div>
    </button>
  );
}

function Seekbar({
  value,
  max,
  playing,
  onChange,
}: {
  value: number;
  max: number;
  playing: boolean;
  onChange: (v: number) => void;
}) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        height: hover || playing ? 6 : 4,
        transition: 'height var(--t-fast)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 3,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${ratio * 100}%`,
          background: 'var(--ink)',
          borderRadius: 3,
          transition: 'width 120ms linear',
        }}
      />
      {/* draggable thumb on hover */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `${ratio * 100}%`,
          width: 12,
          height: 12,
          borderRadius: 999,
          background: '#fff',
          transform: `translate(-50%, -50%) scale(${hover ? 1 : 0})`,
          opacity: hover ? 1 : 0,
          transition: 'transform var(--t-fast), opacity var(--t-fast)',
          pointerEvents: 'none',
        }}
      />
      <input
        type="range"
        min={0}
        max={max || 1}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          cursor: 'pointer',
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}

function TransportBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="focus-ring mono surface"
      style={{
        padding: '9px 14px',
        fontSize: 11,
        letterSpacing: '.14em',
        color: 'var(--ink-60)',
        borderRadius: 999,
        background: 'transparent',
        border: '1px solid rgba(255,255,255,0.06)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
        e.currentTarget.style.color = 'var(--ink)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ink-60)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = 'translateY(0) scale(0.96)')}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
    >
      {label}
    </button>
  );
}
