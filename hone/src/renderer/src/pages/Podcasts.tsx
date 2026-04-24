// Podcasts — страница прослушивания подкастов из Codex'а.
//
// Лево — список каталога, право — плеер с аудио + description. Прогресс
// пушим на бэк через throttled `UpdateProgress` (раз в 5 секунд + при
// pause/seek/ended). Auto-complete флиппается бекендом когда осталось
// <10 секунд.
//
// Audio URL'ы — MinIO presigned, TTL 45 мин. Если юзер слушает длинный
// подкаст > 45 мин без скипа — рефетчим catalog (silent refresh).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

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

// Throttle — не чаще раз в 5 сек пушим прогресс. Паузе / seek / ended
// обходят throttle и пушат сразу.
const PROGRESS_THROTTLE_MS = 5000;
// Presigned URL TTL (45 мин) — refresh'им catalog за 5 мин до.
const CATALOG_STALE_MS = 40 * 60 * 1000;

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

export function PodcastsPage() {
  const [state, setState] = useState<FetchState>(INITIAL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(Section.UNSPECIFIED);
  const [fetchedAt, setFetchedAt] = useState(0);

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

  // Authom-select первый подкаст в списке после загрузки.
  useEffect(() => {
    if (!selectedId && state.items.length > 0) {
      setSelectedId(state.items[0]!.id);
    }
  }, [state.items, selectedId]);

  // Stale-URL refresh: если catalog был загружен давно, при каждом
  // select'е проверяем и рефетчим если > CATALOG_STALE_MS.
  useEffect(() => {
    if (!selected) return;
    if (Date.now() - fetchedAt > CATALOG_STALE_MS) {
      void load(section);
    }
  }, [selected, fetchedAt, section, load]);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        paddingTop: 80,
        paddingBottom: 120,
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
      }}
    >
      <aside
        style={{
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: '0 10px',
          overflowY: 'auto',
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
        {state.items.map((p) => {
          const active = selectedId === p.id;
          const ratio = p.durationSec > 0 ? p.progressSec / p.durationSec : 0;
          return (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '12px 14px',
                margin: '1px 0',
                borderRadius: 7,
                color: active ? 'var(--ink)' : 'var(--ink-60)',
                background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13.5, lineHeight: 1.3, flex: 1 }}>{p.title}</span>
                {p.completed && (
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
                <span>{sectionLabel(p.section)}</span>
                <span>·</span>
                <span>{formatTime(p.durationSec)}</span>
              </div>
              {ratio > 0 && !p.completed && (
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
                    }}
                  />
                </div>
              )}
            </button>
          );
        })}
      </aside>

      <section style={{ padding: '10px 56px', overflowY: 'auto' }}>
        {selected ? (
          <Player podcast={selected} />
        ) : state.status === 'ok' && state.items.length === 0 ? (
          <p style={{ color: 'var(--ink-40)', fontSize: 14 }}>
            No podcasts in this section yet.
          </p>
        ) : null}
      </section>
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
            className="focus-ring mono"
            style={{
              padding: '5px 10px',
              fontSize: 10,
              letterSpacing: '.12em',
              borderRadius: 6,
              color: active ? 'var(--ink)' : 'var(--ink-40)',
              background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
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

  // Restore saved progress при смене подкаста.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (seededRef.current === podcast.id) return;
    seededRef.current = podcast.id;
    // Небольшая задержка — ждём metadata для корректного currentTime.
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
      }).catch(() => {
        // не роняем UI — следующий push попробует снова
      });
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
        // пользователь не нажал — autoplay policy, игнорируем
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
    <div>
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
            marginTop: 6,
          }}
        >
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration || podcast.durationSec)}</span>
        </div>

        <div
          style={{
            marginTop: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
          }}
        >
          <TransportBtn label="-15s" onClick={() => skip(-15)} />
          <button
            onClick={() => void toggle()}
            className="focus-ring"
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              background: '#fff',
              color: '#000',
              fontSize: 20,
              fontWeight: 500,
            }}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <TransportBtn label="+30s" onClick={() => skip(30)} />
        </div>
      </div>
    </div>
  );
}

function Seekbar({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div style={{ position: 'relative', height: 4 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 2,
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
          borderRadius: 2,
          transition: 'width 120ms linear',
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
      className="focus-ring mono"
      style={{
        padding: '8px 12px',
        fontSize: 11,
        letterSpacing: '.14em',
        color: 'var(--ink-60)',
        borderRadius: 8,
        background: 'transparent',
      }}
    >
      {label}
    </button>
  );
}
