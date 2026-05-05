// Listening — Wave 6.1 of docs/feature/plan.md.
//
// Two-pane layout, mirrors the Reading page:
//   - left (260px): library (newest-first), "+" header → Add modal
//   - right: welcome OR add-form OR player
//
// Player surface:
//   * native <audio> with custom transport (play/pause + speed picker)
//   * transcript with click-on-word → vocab popover (reuses addVocab)
//
// Click-on-word reuses api/reading.ts addVocab — vocab queue is shared
// across Reading and Listening surfaces (same hone_vocab_queue table).
//
// No session log for V1: we don't track «I listened 12 minutes». If
// analytics value materialises we'll add hone_listening_sessions.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { addVocab } from '../api/reading';
import {
  addListeningMaterial,
  ingestYouTubeListening,
  archiveListeningMaterial,
  getListeningMaterial,
  listListeningMaterials,
  type ListeningMaterial,
} from '../api/listening';

type Mode =
  | { kind: 'library' }
  | { kind: 'adding' }
  | { kind: 'player'; material: ListeningMaterial };

interface State {
  status: 'loading' | 'ok' | 'error';
  materials: ListeningMaterial[];
  error: string | null;
}

const INITIAL: State = { status: 'loading', materials: [], error: null };

const SPEED_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatRelative(d: Date | null): string {
  if (!d) return '';
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ListeningPage() {
  const [state, setState] = useState<State>(INITIAL);
  const [mode, setMode] = useState<Mode>({ kind: 'library' });
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const materials = await listListeningMaterials();
      setState({ status: 'ok', materials, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', materials: [], error: msg });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleOpen = useCallback(async (m: ListeningMaterial) => {
    try {
      const full = await getListeningMaterial(m.id);
      setMode({ kind: 'player', material: full });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      window.alert(`Не удалось открыть материал: ${msg}`);
    }
  }, []);

  const handleArchive = useCallback(async (id: string) => {
    if (!window.confirm('Архивировать этот материал?')) return;
    try {
      await archiveListeningMaterial(id);
      setRefreshKey((k) => k + 1);
      setMode({ kind: 'library' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      window.alert(`Не получилось архивировать: ${msg}`);
    }
  }, []);

  const handleAdded = useCallback(() => {
    setMode({ kind: 'library' });
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        animationDuration: '320ms',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      <LibraryPane
        state={state}
        activeId={mode.kind === 'player' ? mode.material.id : null}
        onAdd={() => setMode({ kind: 'adding' })}
        onOpen={(m) => void handleOpen(m)}
        onArchive={(id) => void handleArchive(id)}
      />
      <main style={{ flex: 1, minWidth: 0, position: 'relative', overflowY: 'auto', paddingTop: 64 }}>
        {mode.kind === 'library' && <WelcomePane onAdd={() => setMode({ kind: 'adding' })} />}
        {mode.kind === 'adding' && (
          <AddForm onCancel={() => setMode({ kind: 'library' })} onAdded={handleAdded} />
        )}
        {mode.kind === 'player' && (
          <Player material={mode.material} onExit={() => setMode({ kind: 'library' })} />
        )}
      </main>
    </div>
  );
}

// ─── Library pane ──────────────────────────────────────────────────────

interface LibraryPaneProps {
  state: State;
  activeId: string | null;
  onAdd: () => void;
  onOpen: (m: ListeningMaterial) => void;
  onArchive: (id: string) => void;
}

function LibraryPane({ state, activeId, onAdd, onOpen, onArchive }: LibraryPaneProps) {
  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 56,
      }}
    >
      <header
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)' }}>
          LISTENING · LIBRARY
        </div>
        <button
          type="button"
          aria-label="Add material"
          onClick={onAdd}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--ink)',
            width: 22,
            height: 22,
            borderRadius: 6,
            fontSize: 14,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          +
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 16px' }}>
        {state.status === 'loading' && (
          <p style={{ color: 'var(--ink-40)', fontSize: 12, padding: '8px 12px' }}>Loading…</p>
        )}
        {state.status === 'error' && (
          <p style={{ color: 'var(--ink-60)', fontSize: 12, padding: '8px 12px' }}>{state.error}</p>
        )}
        {state.status === 'ok' && state.materials.length === 0 && (
          <div style={{ padding: '12px 12px', color: 'var(--ink-40)', fontSize: 12 }}>
            Пока пусто.
            <br />
            <span style={{ color: 'var(--ink-60)' }}>+ — добавить аудио + transcript</span>
          </div>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {state.materials.map((m) => {
            const isActive = activeId === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpen(m)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                    border: '1px solid transparent',
                    borderRadius: 8,
                    padding: '10px 12px',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    display: 'block',
                    margin: '2px 0',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {m.title || '(untitled)'}
                  </div>
                  <div
                    className="mono"
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      color: 'var(--ink-40)',
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <span>AUDIO</span>
                    <span>·</span>
                    <span>{formatRelative(m.updatedAt ?? m.createdAt)}</span>
                  </div>
                </button>
                {isActive && (
                  <button
                    type="button"
                    onClick={() => onArchive(m.id)}
                    style={{
                      margin: '2px 12px 6px',
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 6,
                      color: 'var(--ink-40)',
                      fontSize: 10,
                      padding: '3px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    Archive
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

// ─── Welcome pane ──────────────────────────────────────────────────────

function WelcomePane({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{ width: 720, maxWidth: '92%', margin: '32px auto 0', padding: '0 24px' }}>
      <div
        className="mono"
        style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)', marginBottom: 4 }}
      >
        LISTENING
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: 40,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          color: 'var(--ink)',
        }}
      >
        Listen with a transcript
      </h1>
      <p style={{ margin: '12px 0 24px', fontSize: 14, color: 'var(--ink-60)', maxWidth: 520 }}>
        Положи аудио + transcript в библиотеку. Кликай по словам в transcript'е —
        они уйдут в общую SRS-очередь (та же, что у Reading).
      </p>
      <button
        type="button"
        onClick={onAdd}
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10,
          color: 'var(--ink)',
          padding: '10px 16px',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        + Add material
      </button>
    </div>
  );
}

// ─── Add form ──────────────────────────────────────────────────────────

function AddForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: () => void }) {
  // Source-tab: 'youtube' (default — самый частый источник) или 'manual'
  // (paste audio URL + transcript). Раньше был только manual — Sergey
  // 2026-05-03: «listening странный, надо самому транскрибацию искать
  // хотя видео из тюба». Backend yt-dlp pulls auto-captions.
  const [source, setSource] = useState<'youtube' | 'manual'>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [title, setTitle] = useState('');
  const [audioURL, setAudioURL] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitYoutube = useCallback(async () => {
    setError(null);
    const url = youtubeUrl.trim();
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      setError('Нужен URL вида https://youtube.com/... или https://youtu.be/...');
      return;
    }
    setBusy(true);
    try {
      await ingestYouTubeListening(url);
      onAdded();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      // Тонкое сообщение для типовых ошибок.
      if (msg.includes('no captions')) {
        setError('У этого видео нет субтитров. Переключись на Manual и вставь транскрипт сам.');
      } else if (msg.includes('not wired')) {
        setError('Backend не настроен (нет yt-dlp). Используй Manual paste.');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }, [youtubeUrl, onAdded]);

  const submit = useCallback(async () => {
    setError(null);
    // Frontend gate against URLs we know <audio> can't render. Backend
    // takes the string flat — the gate lives here so the user gets a
    // local error instead of a row that won't play.
    const url = audioURL.trim();
    if (!isPlayableAudioUrl(url)) {
      setError('URL должен указывать на mp3/m4a/ogg/wav (или file://). YouTube/Spotify пока не поддерживаем.');
      return;
    }
    setBusy(true);
    try {
      await addListeningMaterial({
        title: title.trim(),
        audioUrl: url,
        transcriptMd: transcript.trim(),
      });
      onAdded();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [title, audioURL, transcript, onAdded]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (source === 'youtube') void submitYoutube();
        else void submit();
      }}
      style={{ width: 720, maxWidth: '92%', margin: '32px auto 0', padding: '0 24px' }}
    >
      <div
        className="mono"
        style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)', marginBottom: 4 }}
      >
        LISTENING · ADD
      </div>
      <h1
        style={{
          margin: 0,
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
        }}
      >
        New audio
      </h1>

      {/* Source tabs: YouTube (auto-captions) vs Manual (paste URL+transcript) */}
      <div style={{ marginTop: 18, display: 'flex', gap: 4 }}>
        <SourceTab active={source === 'youtube'} onClick={() => setSource('youtube')}>
          🎥 YouTube
        </SourceTab>
        <SourceTab active={source === 'manual'} onClick={() => setSource('manual')}>
          ✍ Manual
        </SourceTab>
      </div>

      {source === 'youtube' ? (
        <>
          <label style={labelStyle}>
            <span style={labelTextStyle}>YOUTUBE URL</span>
            <input
              type="url"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              style={inputStyle}
              required
            />
          </label>
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.5 }}>
            Paste YouTube ссылку — backend pull'нет auto-captions через yt-dlp.
            Title + transcript заполнятся автоматически. Если у видео нет
            субтитров — переключись на Manual.
          </p>
          {error && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 12 }}>{error}</p>}
          <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
            <button type="submit" disabled={busy} style={primaryBtnStyle}>
              {busy ? 'Pulling…' : 'Pull from YouTube'}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} style={secondaryBtnStyle}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <label style={labelStyle}>
            <span style={labelTextStyle}>TITLE</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lex Fridman ep 400 — Sam Altman"
              style={inputStyle}
              required
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>AUDIO URL</span>
            <input
              type="url"
              value={audioURL}
              onChange={(e) => setAudioURL(e.target.value)}
              placeholder="https://example.com/ep400.mp3"
              style={inputStyle}
              required
            />
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>TRANSCRIPT (markdown)</span>
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Paste the full transcript here…"
              rows={14}
              style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13, lineHeight: 1.6 }}
              required
            />
          </label>

          {error && <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 12 }}>{error}</p>}

          <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
            <button type="submit" disabled={busy} style={primaryBtnStyle}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} style={secondaryBtnStyle}>
              Cancel
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function SourceTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        fontSize: 12,
        background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 999,
        color: active ? 'var(--ink-90)' : 'var(--ink-60)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function isPlayableAudioUrl(s: string): boolean {
  if (!s) return false;
  if (s.startsWith('file://')) return true;
  // Accept any http(s) URL ending in a known audio extension.
  // Permissive on purpose — some CDNs append query strings.
  if (!/^https?:\/\//i.test(s)) return false;
  return /\.(mp3|m4a|ogg|oga|wav|aac|flac)(\?.*)?$/i.test(s);
}

// ─── Player ────────────────────────────────────────────────────────────

interface VocabPopover {
  word: string;
  context: string;
  anchor: { x: number; y: number };
}

function Player({ material, onExit }: { material: ListeningMaterial; onExit: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [popover, setPopover] = useState<VocabPopover | null>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // Esc → exit. Letter shortcuts are filtered by App's global handler
  // when an input/textarea is focused; the player has neither, so we
  // duplicate the Esc binding here to be explicit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  }, []);

  const handleWordClick = useCallback(
    (word: string, context: string, e: React.MouseEvent<HTMLSpanElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setPopover({
        word,
        context,
        anchor: { x: rect.left + rect.width / 2, y: rect.bottom + 6 },
      });
    },
    [],
  );

  const handlePopoverSave = useCallback(
    async (translation: string) => {
      if (!popover) return;
      try {
        await addVocab({
          word: popover.word,
          translation: translation.trim(),
          contextMd: popover.context,
          // Listening doesn't have its own source_material yet — we
          // omit it; backend stores empty string. Vocab queue still
          // records the click for SRS.
        });
      } catch {
        /* silent — UI не блокируется на vocab fail'е */
      }
      setPopover(null);
    },
    [popover],
  );

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          paddingTop: 64,
          paddingBottom: 96,
          overflowY: 'auto',
        }}
      >
        <div style={{ width: 720, maxWidth: '92%', margin: '0 auto', padding: '0 24px' }}>
          <header style={{ marginBottom: 24 }}>
            <div
              className="mono"
              style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-40)', marginBottom: 4 }}
            >
              LISTENING
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 500,
                letterSpacing: '-0.01em',
                color: 'var(--ink)',
              }}
            >
              {material.title}
            </h1>
          </header>

          <PlayerTransport
            audioRef={audioRef}
            audioUrl={material.audioUrl}
            playing={playing}
            speed={speed}
            onPlayingChange={setPlaying}
            onSpeedChange={setSpeed}
            onTogglePlay={togglePlay}
          />

          {material.transcriptMd ? (
            <TranscriptBody transcriptMd={material.transcriptMd} onWordClick={handleWordClick} />
          ) : (
            <p style={{ marginTop: 32, color: 'var(--ink-60)', fontSize: 14 }}>
              Без transcript'а — кликабельные слова недоступны. Можешь добавить
              transcript позже, отредактировав материал в библиотеке.
            </p>
          )}
        </div>
      </div>

      {popover && (
        <VocabPopoverInput
          popover={popover}
          onSave={(t) => void handlePopoverSave(t)}
          onCancel={() => setPopover(null)}
        />
      )}
    </>
  );
}

interface PlayerTransportProps {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  audioUrl: string;
  playing: boolean;
  speed: number;
  onPlayingChange: (p: boolean) => void;
  onSpeedChange: (s: number) => void;
  onTogglePlay: () => void;
}

function PlayerTransport({
  audioRef,
  audioUrl,
  playing,
  speed,
  onPlayingChange,
  onSpeedChange,
  onTogglePlay,
}: PlayerTransportProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
      }}
    >
      <button
        type="button"
        onClick={onTogglePlay}
        style={{
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.16)',
          color: 'var(--ink)',
          width: 36,
          height: 36,
          borderRadius: 999,
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      {/* Native <audio> with controls — gives the user a familiar seekbar
          without us reimplementing time-display, buffering, scrubbing.
          The custom button above just toggles play/pause for keyboard. */}
      <audio
        ref={audioRef}
        src={audioUrl}
        controls
        onPlay={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
        onEnded={() => onPlayingChange(false)}
        style={{ flex: 1, minWidth: 0 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          className="mono"
          style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--ink-40)' }}
        >
          SPEED
        </span>
        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'var(--ink)',
            padding: '2px 6px',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {SPEED_PRESETS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── Transcript body (click-on-word) ──────────────────────────────────

interface TranscriptBodyProps {
  transcriptMd: string;
  onWordClick: (word: string, context: string, e: React.MouseEvent<HTMLSpanElement>) => void;
}

const WORD_RE = /[\p{L}\p{M}'’]+/gu;

function TranscriptBody({ transcriptMd, onWordClick }: TranscriptBodyProps) {
  const paragraphs = useMemo(() => transcriptMd.split(/\n\s*\n/), [transcriptMd]);
  return (
    <div
      style={{
        marginTop: 28,
        fontSize: 17,
        lineHeight: 1.7,
        color: 'var(--ink)',
        fontFamily: 'ui-serif, Georgia, "Times New Roman", serif',
      }}
    >
      {paragraphs.map((p, i) => (
        <Paragraph key={i} text={p} onWordClick={onWordClick} />
      ))}
    </div>
  );
}

function Paragraph({ text, onWordClick }: { text: string; onWordClick: TranscriptBodyProps['onWordClick'] }) {
  const sentences = useMemo(() => splitSentences(text), [text]);
  const tokens = useMemo(() => tokenize(text), [text]);
  return (
    <p style={{ margin: '0 0 1.2em' }}>
      {tokens.map((tok, i) => {
        if (tok.kind === 'word') {
          const ctx = findSentenceFor(sentences, tok.start);
          const word = tok.text.toLowerCase();
          return (
            <span
              key={i}
              role="button"
              tabIndex={-1}
              onClick={(e) => onWordClick(word, ctx, e)}
              style={{
                cursor: 'pointer',
                borderRadius: 3,
                padding: '0 1px',
                transition: 'background 80ms',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {tok.text}
            </span>
          );
        }
        return <span key={i}>{tok.text}</span>;
      })}
    </p>
  );
}

interface Token {
  kind: 'word' | 'gap';
  text: string;
  start: number;
}

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let lastIdx = 0;
  for (const m of s.matchAll(WORD_RE)) {
    const start = m.index ?? 0;
    if (start > lastIdx) out.push({ kind: 'gap', text: s.slice(lastIdx, start), start: lastIdx });
    out.push({ kind: 'word', text: m[0], start });
    lastIdx = start + m[0].length;
  }
  if (lastIdx < s.length) out.push({ kind: 'gap', text: s.slice(lastIdx), start: lastIdx });
  return out;
}

interface SentenceSpan {
  start: number;
  end: number;
  text: string;
}

function splitSentences(s: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let start = 0;
  const re = /[.!?]+\s+/g;
  for (const m of s.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    out.push({ start, end, text: s.slice(start, end).trim() });
    start = end;
  }
  if (start < s.length) out.push({ start, end: s.length, text: s.slice(start).trim() });
  return out;
}

function findSentenceFor(sentences: SentenceSpan[], pos: number): string {
  for (const s of sentences) {
    if (pos >= s.start && pos < s.end) return s.text;
  }
  return sentences.length > 0 ? sentences[0].text : '';
}

// ─── Vocab popover ────────────────────────────────────────────────────

interface VocabPopoverInputProps {
  popover: VocabPopover;
  onSave: (translation: string) => void;
  onCancel: () => void;
}

function VocabPopoverInput({ popover, onSave, onCancel }: VocabPopoverInputProps) {
  const [translation, setTranslation] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const left = Math.min(popover.anchor.x - 140, window.innerWidth - 300);
  const top = Math.min(popover.anchor.y, window.innerHeight - 180);

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        left,
        top,
        width: 280,
        background: 'rgba(15,15,18,0.96)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 10,
        padding: 12,
        zIndex: 500,
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--ink-40)' }}>
        ADD TO SRS
      </div>
      <div style={{ marginTop: 4, fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
        {popover.word}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={translation}
        onChange={(e) => setTranslation(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSave(translation);
          }
        }}
        placeholder="translation (optional)"
        style={{ ...inputStyle, marginTop: 8, fontSize: 13, padding: '6px 10px' }}
      />
      <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={() => onSave(translation)}
          style={{ ...primaryBtnStyle, padding: '6px 12px', fontSize: 12 }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ ...secondaryBtnStyle, padding: '6px 12px', fontSize: 12 }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

// ─── Shared atoms (mirror Reading.tsx) ─────────────────────────────────

const labelStyle: React.CSSProperties = { display: 'block', marginTop: 14 };
const labelTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  letterSpacing: '0.16em',
  color: 'var(--ink-40)',
  marginBottom: 6,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: 'var(--ink)',
  padding: '8px 12px',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};
const primaryBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.1)',
  border: '1px solid rgba(255,255,255,0.16)',
  color: 'var(--ink)',
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
};
const secondaryBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)',
  color: 'var(--ink-60)',
  padding: '8px 16px',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
};
