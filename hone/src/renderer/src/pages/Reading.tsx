// Reading — Wave 4.1f. Hone English Reading-модуль (см docs/feature/english.md).
//
// Layout: two-pane.
//   - left (260px): library list, newest first; "+" header кнопка → Add modal.
//   - right: либо welcome/empty, либо reader (full-bleed text), либо add-form.
//
// Reader does three things:
//   1. Renders body markdown как plain читаемый текст (single column ~720px).
//   2. Splits content into clickable word-tokens. Click → vocab popover →
//      AddVocab + сохранение surrounding sentence как context_md. Idempotent
//      на бэке (UpsertVocab).
//   3. Tracks chars_read через scroll position и shipдает в EndSession при
//      выходе из reader'а.
//
// SRS daily review widget — отдельный компонент <SrsReviewWidget/> внизу
// library pane; собирает due-карточки и предлагает correct/incorrect tick.
//
// Hotkey R открывает страницу. Click-on-word слышит только plain alphanumeric
// слова, punctuation/HTML/markdown-syntax не реагируют.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  addReadingMaterial,
  addVocab,
  archiveReadingMaterial,
  endReadingSession,
  getReadingMaterial,
  listReadingMaterials,
  listVocabBySourceMaterial,
  listVocabDue,
  reviewVocab,
  startReadingSession,
  type ReadingMaterial,
  type ReadingSession,
  type ReadingSourceKind,
  type VocabEntry,
} from '../api/reading';
import { AICoachPill } from '../components/AICoachPill';
import { ReadingSelectionPill } from '../components/ReadingSelectionPill';
import { useTrackStore } from '../stores/track';

type Mode =
  | { kind: 'library' }
  | { kind: 'adding' }
  | { kind: 'reader'; material: ReadingMaterial; session: ReadingSession };

interface State {
  status: 'loading' | 'ok' | 'error';
  materials: ReadingMaterial[];
  error: string | null;
}

const INITIAL: State = { status: 'loading', materials: [], error: null };

// formatRelative — "today", "3d ago", "Mar 14"; matches the visual ноты в
// существующих Hone listings (Notes, Coach feed).
function formatRelative(d: Date | null): string {
  if (!d) return '';
  const now = Date.now();
  const ms = now - d.getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ReadingPage() {
  const [state, setState] = useState<State>(INITIAL);
  const [mode, setMode] = useState<Mode>({ kind: 'library' });
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const materials = await listReadingMaterials();
      setState({ status: 'ok', materials, error: null });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setState({ status: 'error', materials: [], error: msg });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleOpenMaterial = useCallback(async (m: ReadingMaterial) => {
    try {
      // List endpoint strips body_md to save bandwidth; refetch with full body.
      const full = await getReadingMaterial(m.id);
      const session = await startReadingSession(m.id);
      setMode({ kind: 'reader', material: full, session });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      // Reading-page non-fatal — fallback to library with banner-like alert.
      // Использовать window.alert чтобы не таскать toast-store ради edge case'а.
      window.alert(`Не удалось открыть материал: ${msg}`);
    }
  }, []);

  const handleArchive = useCallback(async (id: string) => {
    if (!window.confirm('Архивировать этот материал? Его не будет в библиотеке.')) return;
    try {
      await archiveReadingMaterial(id);
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      window.alert(`Не получилось архивировать: ${msg}`);
    }
  }, []);

  const handleAdded = useCallback(() => {
    setMode({ kind: 'library' });
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSessionExit = useCallback(() => {
    setMode({ kind: 'library' });
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div
      className="fadein"
      style={{
        position: 'absolute',
        inset: 0,
        animationDuration: 'var(--motion-dur-large)',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      <LibraryPane
        state={state}
        activeId={mode.kind === 'reader' ? mode.material.id : null}
        onAdd={() => setMode({ kind: 'adding' })}
        onOpen={(m) => void handleOpenMaterial(m)}
        onArchive={(id) => void handleArchive(id)}
        onRefresh={() => setRefreshKey((k) => k + 1)}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
          overflowY: 'auto',
          paddingTop: 64,
        }}
      >
        {mode.kind === 'library' && <WelcomePane onAdd={() => setMode({ kind: 'adding' })} />}
        {mode.kind === 'adding' && (
          <AddMaterialForm onCancel={() => setMode({ kind: 'library' })} onAdded={handleAdded} />
        )}
        {mode.kind === 'reader' && (
          <Reader
            material={mode.material}
            session={mode.session}
            onExit={handleSessionExit}
          />
        )}
      </main>
    </div>
  );
}

// ─── Library pane ──────────────────────────────────────────────────────────

interface LibraryPaneProps {
  state: State;
  activeId: string | null;
  onAdd: () => void;
  onOpen: (m: ReadingMaterial) => void;
  onArchive: (id: string) => void;
  onRefresh: () => void;
}

function LibraryPane({ state, activeId, onAdd, onOpen, onArchive, onRefresh }: LibraryPaneProps) {
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
        <div
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--ink-40)',
          }}
        >
          READING · LIBRARY
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
          <ul
            aria-busy="true"
            aria-label="Loading materials"
            style={{ listStyle: 'none', padding: 0, margin: 0 }}
          >
            {/* CI1: height-stable skeleton matching the .reading-item layout
             * (одна строка title + одна строка meta) — нет CLS прыжка между
             * loading→ok состояниями. */}
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} style={{ padding: '10px 12px', margin: '2px 0' }}>
                <div
                  style={{
                    height: 13,
                    width: '70%',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 4,
                    marginBottom: 8,
                  }}
                />
                <div
                  style={{
                    height: 10,
                    width: '40%',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 4,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {state.status === 'error' && (
          // CI1: stripe + retry button (was plain text label — silent dead end).
          <div className="data-loader-error" style={{ margin: '8px 12px' }}>
            <div className="data-loader-error-stripe" />
            <div className="data-loader-error-body">
              <div className="data-loader-error-label">Library не загрузилась</div>
              <div className="data-loader-error-detail">{state.error}</div>
              <button
                type="button"
                className="data-loader-error-retry focus-ring motion-press"
                onClick={onRefresh}
              >
                retry
              </button>
            </div>
          </div>
        )}
        {state.status === 'ok' && state.materials.length === 0 && (
          <div style={{ padding: '12px 12px', color: 'var(--ink-40)', fontSize: 12 }}>
            Пока пусто.
            <br />
            <span style={{ color: 'var(--ink-60)' }}>+ — добавить первый материал</span>
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
                  aria-current={isActive ? 'page' : undefined}
                  aria-pressed={isActive}
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
                      letterSpacing: '0.08em',
                      color: 'var(--ink-40)',
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <span style={{ textTransform: 'uppercase' }}>{m.sourceKind}</span>
                    <span>·</span>
                    <span>{Math.round(m.totalChars / 1000)}k chars</span>
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

      <SrsReviewWidget onChanged={onRefresh} />
    </aside>
  );
}

// ─── Welcome pane (when nothing is open) ───────────────────────────────────

function WelcomePane({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{ width: 720, maxWidth: '92%', margin: '32px auto 0', padding: '0 24px' }}>
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--ink-40)',
          marginBottom: 4,
        }}
      >
        READING
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
        Read a chapter
      </h1>
      <p style={{ margin: '12px 0 24px', fontSize: 14, color: 'var(--ink-60)', maxWidth: 520 }}>
        Положи статью или главу в библиотеку. Кликай по словам — они уйдут в SRS-очередь.
        5 минут review каждое утро снизу слева.
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

// ─── Add-material form ────────────────────────────────────────────────────

interface AddMaterialFormProps {
  onCancel: () => void;
  onAdded: () => void;
}

function AddMaterialForm({ onCancel, onAdded }: AddMaterialFormProps) {
  const [sourceKind, setSourceKind] = useState<ReadingSourceKind>('paste');
  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [bookChapter, setBookChapter] = useState<string>('');
  const [bookTotal, setBookTotal] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const args: Parameters<typeof addReadingMaterial>[0] = {
        sourceKind,
        title: title.trim(),
        bodyMd: bodyMd.trim(),
        sourceUrl: sourceUrl.trim(),
      };
      if (sourceKind === 'book') {
        const ch = parseInt(bookChapter, 10);
        const tot = parseInt(bookTotal, 10);
        if (Number.isFinite(ch)) args.bookChapter = ch;
        if (Number.isFinite(tot)) args.bookTotalChapters = tot;
      }
      await addReadingMaterial(args);
      onAdded();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [sourceKind, title, bodyMd, sourceUrl, bookChapter, bookTotal, onAdded]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ width: 720, maxWidth: '92%', margin: '32px auto 0', padding: '0 24px' }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--ink-40)',
          marginBottom: 4,
        }}
      >
        READING · ADD
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
        New material
      </h1>

      <fieldset style={{ border: 'none', padding: 0, margin: '24px 0 12px' }}>
        <legend
          className="mono"
          style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--ink-40)', marginBottom: 8 }}
        >
          SOURCE
        </legend>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['paste', 'url', 'book'] as ReadingSourceKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSourceKind(k)}
              className="mono"
              style={{
                background: sourceKind === k ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: '1px solid rgba(255,255,255,0.08)',
                color: sourceKind === k ? 'var(--ink)' : 'var(--ink-60)',
                padding: '4px 12px',
                borderRadius: 999,
                fontSize: 10,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {k}
            </button>
          ))}
          {/* pdf/epub backend supports but UI пока не парсит — поэтому не показываем. */}
        </div>
      </fieldset>

      <label style={labelStyle}>
        <span style={labelTextStyle}>TITLE</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Chapter 4 — The Black Swan"
          style={inputStyle}
          required
        />
      </label>

      {sourceKind === 'url' && (
        <label style={labelStyle}>
          <span style={labelTextStyle}>SOURCE URL</span>
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://example.com/article"
            style={inputStyle}
          />
        </label>
      )}

      {sourceKind === 'book' && (
        <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
          <label style={{ flex: 1 }}>
            <span style={labelTextStyle}>CURRENT CHAPTER</span>
            <input
              type="number"
              min={0}
              value={bookChapter}
              onChange={(e) => setBookChapter(e.target.value)}
              placeholder="3"
              style={inputStyle}
            />
          </label>
          <label style={{ flex: 1 }}>
            <span style={labelTextStyle}>TOTAL CHAPTERS</span>
            <input
              type="number"
              min={1}
              value={bookTotal}
              onChange={(e) => setBookTotal(e.target.value)}
              placeholder="20"
              style={inputStyle}
            />
          </label>
        </div>
      )}

      <label style={labelStyle}>
        <span style={labelTextStyle}>
          {sourceKind === 'book' ? 'NOTES (optional)' : 'BODY (markdown)'}
        </span>
        <textarea
          value={bodyMd}
          onChange={(e) => setBodyMd(e.target.value)}
          placeholder={
            sourceKind === 'book'
              ? 'Заметки по книге — что важно запомнить (можно оставить пустым)'
              : 'Paste the full text here…'
          }
          rows={sourceKind === 'book' ? 6 : 14}
          style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13, lineHeight: 1.6 }}
          required={sourceKind !== 'book'}
        />
      </label>

      {error && (
        <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 12 }}>{error}</p>
      )}

      <div style={{ marginTop: 18, display: 'flex', gap: 8 }}>
        <button type="submit" disabled={busy} style={primaryBtnStyle}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={secondaryBtnStyle}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', marginTop: 14 };
const labelTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10,
  letterSpacing: '0.08em',
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

// ─── Reader ──────────────────────────────────────────────────────────────

interface ReaderProps {
  material: ReadingMaterial;
  session: ReadingSession;
  onExit: () => void;
}

interface VocabPopover {
  word: string;
  context: string;
  anchor: { x: number; y: number };
}

// GradingState — what we're showing in the bottom panel after the user
// clicks Finish. Decoupled from the loading flag so the «scored» panel
// can hang around until the user dismisses it (auto-close timer too).
type GradingState =
  | { kind: 'idle' }
  | { kind: 'grading' }
  | { kind: 'scored'; score: number }
  | { kind: 'no_score' }; // grader was offline / timed out — exit immediately

function Reader({ material, session, onExit }: ReaderProps) {
  const [popover, setPopover] = useState<VocabPopover | null>(null);
  const [summary, setSummary] = useState('');
  const [grading, setGrading] = useState<GradingState>({ kind: 'idle' });
  // Wave 4.2 — vocab saved from THIS material. Refetched on mount + after
  // each successful popover save so the «saved here» panel stays current.
  const [savedVocab, setSavedVocab] = useState<VocabEntry[]>([]);
  const charsReadRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const refreshSavedVocab = useCallback(async () => {
    try {
      const items = await listVocabBySourceMaterial(material.id);
      setSavedVocab(items);
    } catch {
      // Non-critical surface; silently keep the previous snapshot.
    }
  }, [material.id]);

  useEffect(() => {
    void refreshSavedVocab();
  }, [refreshSavedVocab]);

  // Estimate chars_read из scroll position. body height ~ totalChars (rough),
  // scroll fraction × totalChars даёт upper bound прочитанного. Save в ref'е,
  // финальный value уйдёт в EndSession при exit'е.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const denom = Math.max(1, scrollHeight - clientHeight);
    const frac = Math.min(1, Math.max(0, scrollTop / denom));
    charsReadRef.current = Math.round(frac * material.totalChars);
  }, [material.totalChars]);

  // finishWithoutGrade — fast path used by the «Close» button and by Esc.
  // We don't wait for the server response visually; the EndSession call
  // is awaited but UI navigates back immediately on success or failure.
  const finishWithoutGrade = useCallback(async () => {
    try {
      await endReadingSession({
        sessionId: session.id,
        charsRead: charsReadRef.current,
        summaryMd: '', // explicitly skip grading — even if user typed something
      });
    } catch {
      /* silent */
    }
    onExit();
  }, [session.id, onExit]);

  // submitForGrading — used by «Finish & save» when there IS a summary.
  // Shows a «grading…» panel; on response either pivots to the score
  // result panel (user dismisses to exit) or exits silently.
  const submitForGrading = useCallback(async () => {
    const trimmed = summary.trim();
    if (trimmed === '') {
      void finishWithoutGrade();
      return;
    }
    setGrading({ kind: 'grading' });
    try {
      const resp = await endReadingSession({
        sessionId: session.id,
        charsRead: charsReadRef.current,
        summaryMd: trimmed,
      });
      if (resp.aiSummaryScore !== null) {
        setGrading({ kind: 'scored', score: resp.aiSummaryScore });
      } else {
        setGrading({ kind: 'no_score' });
        // grader not available — no point holding the user; exit shortly.
        window.setTimeout(() => onExit(), 350);
      }
    } catch {
      // Server flaked — just close so the user isn't stuck.
      onExit();
    }
  }, [summary, session.id, onExit, finishWithoutGrade]);

  // Esc → exit. Letter-shortcuts (T/N/B/…) на этой странице срабатывают
  // только если фокус не в input — App'овский global handler это уже фильтрует.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (grading.kind === 'scored') {
          onExit();
          return;
        }
        if (grading.kind === 'idle') {
          void finishWithoutGrade();
        }
        // While grading: ignore Esc — we're mid-request.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [grading.kind, finishWithoutGrade, onExit]);

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
          sourceMaterial: material.id,
        });
        // Wave 4.2 — refresh sidebar so the «saved here» panel reflects
        // the new entry without waiting for the user to navigate away
        // and back.
        void refreshSavedVocab();
      } catch {
        /* silent — UI не блокируется на vocab fail'е */
      }
      setPopover(null);
    },
    [popover, material.id, refreshSavedVocab],
  );

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
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
              style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                color: 'var(--ink-40)',
                marginBottom: 4,
              }}
            >
              READING · {material.sourceKind.toUpperCase()}
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
            {material.sourceUrl && (
              <a
                href={material.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-block',
                  marginTop: 6,
                  fontSize: 12,
                  color: 'var(--ink-40)',
                  textDecoration: 'none',
                }}
              >
                {material.sourceUrl}
              </a>
            )}
          </header>

          <ReaderPillRow material={material} />

          <ReaderBody bodyMd={material.bodyMd} onWordClick={handleWordClick} />
          <ReadingSelectionPill containerRef={scrollRef} materialTitle={material.title} />

          {savedVocab.length > 0 && <SavedVocabPanel items={savedVocab} />}

          <section style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                color: 'var(--ink-40)',
                marginBottom: 8,
              }}
            >
              SUMMARY {grading.kind === 'idle' ? '(optional — AI will grade if you write one)' : ''}
            </div>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Briefly: what was this chapter about?"
              rows={4}
              style={{ ...inputStyle, fontSize: 14 }}
              disabled={grading.kind !== 'idle'}
            />
            {grading.kind === 'idle' && (
              <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => void submitForGrading()} style={primaryBtnStyle}>
                  Finish & save
                </button>
                <button type="button" onClick={() => void finishWithoutGrade()} style={secondaryBtnStyle}>
                  Close
                </button>
              </div>
            )}
            {grading.kind === 'grading' && (
              <div
                style={{
                  marginTop: 14,
                  fontSize: 12,
                  color: 'var(--ink-60)',
                  fontStyle: 'italic',
                }}
              >
                AI grading your summary…
              </div>
            )}
            {grading.kind === 'no_score' && (
              <div
                style={{
                  marginTop: 14,
                  fontSize: 12,
                  color: 'var(--ink-40)',
                }}
              >
                Saved. (AI grader is offline — no score this time.)
              </div>
            )}
            {grading.kind === 'scored' && (
              <ScoreResultPanel score={grading.score} onClose={onExit} />
            )}
          </section>
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

// SavedVocabPanel — Wave 4.2 reverse cross-link. Shown below the
// reader body when the user has previously saved any words from THIS
// material. Pure read-only surface; click → open SRS review widget
// is a future hook (currently the daily-review widget in the library
// pane covers it).
function SavedVocabPanel({ items }: { items: VocabEntry[] }) {
  return (
    <section
      style={{
        marginTop: 32,
        padding: '14px 16px 12px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          color: 'var(--ink-40)',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span>WORDS YOU&apos;VE SAVED HERE</span>
        <span style={{ color: 'var(--ink-60)' }}>· {items.length}</span>
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {items.map((v) => (
          <li
            key={v.word}
            title={v.translation || ''}
            style={{
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              fontSize: 12,
              color: 'var(--ink)',
              cursor: 'help',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>{v.word}</span>
            <span
              className="mono"
              style={{
                fontSize: 9,
                color: 'var(--ink-40)',
                letterSpacing: '0.08em',
              }}
            >
              box {v.box}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ScoreResultPanel — shown after a summary was graded. Single number +
// short interpretive label; the detailed feedback is captured server-side
// and we'll surface it in a session-history view in a later wave.
function ScoreResultPanel({ score, onClose }: { score: number; onClose: () => void }) {
  // B/W rule: tier через ink-ramp + #FF3B30 для weak (signal).
  // Strong/mid отличаются opacity и label.
  const tier = score >= 80 ? 'strong' : score >= 50 ? 'mid' : 'weak';
  const stripe =
    tier === 'strong' ? 'rgba(255, 255, 255, 0.85)' : tier === 'mid' ? 'rgba(255, 255, 255, 0.55)' : 'var(--red)';
  const label =
    tier === 'strong' ? 'Solid coverage' : tier === 'mid' ? 'Decent — some gaps' : 'Mostly missed it';

  return (
    <div
      style={{
        marginTop: 14,
        padding: '14px 16px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderLeft: `3px solid ${stripe}`,
        borderRadius: 10,
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--ink-40)', marginBottom: 4 }}
      >
        AI SUMMARY SCORE
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 500, color: 'var(--ink)' }}>{score}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-40)' }}>/ 100</span>
        <span style={{ fontSize: 13, color: 'var(--ink-60)', marginLeft: 8 }}>{label}</span>
      </div>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button type="button" onClick={onClose} style={primaryBtnStyle}>
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Reader body (click-on-word) ──────────────────────────────────────────

interface ReaderBodyProps {
  bodyMd: string;
  onWordClick: (word: string, context: string, e: React.MouseEvent<HTMLSpanElement>) => void;
}

// Tokenizer — split body на абзацы, потом на слова. Markdown-syntax (*, _, #,
// ```) не пытаемся рендерить — текст и так читаемый. Пунктуация сохраняется
// как отдельные не-кликабельные tokens, чтобы visual flow не ломался.
//
// "Слово" = 2+ Unicode-letter подряд (минимум 2 — иначе попадают типа 'a' /
// 'I' что бесполезно для SRS).
const WORD_RE = /[\p{L}\p{M}'’]+/gu;

function ReaderBody({ bodyMd, onWordClick }: ReaderBodyProps) {
  const paragraphs = useMemo(() => bodyMd.split(/\n\s*\n/), [bodyMd]);

  return (
    <div
      style={{
        fontSize: 18,
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

function Paragraph({ text, onWordClick }: { text: string; onWordClick: ReaderBodyProps['onWordClick'] }) {
  // Pass 1: extract все sentence boundaries для context-truncation. Простой
  // sentence split — точка/?/! + space. Не perfect (e.g. — Mr. Smith), но
  // достаточно для контекстной фразы вокруг clicked слова.
  const sentences = useMemo(() => splitSentences(text), [text]);

  // Pass 2: tokenize — слова clickable, всё между ними плоский text.
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
                transition: 'background-color var(--motion-dur-small) var(--motion-ease-standard)',
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
  // Find char positions of sentence endings.
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

// ─── Vocab popover ────────────────────────────────────────────────────────

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

  // Position the popover so it doesn't fly off-screen на правом краю.
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
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--ink-40)' }}>
        ADD TO SRS
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--ink)',
        }}
      >
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

// ─── SRS daily review widget ─────────────────────────────────────────────

interface SrsReviewWidgetProps {
  onChanged: () => void;
}

function SrsReviewWidget({ onChanged }: SrsReviewWidgetProps) {
  const [items, setItems] = useState<VocabEntry[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const due = await listVocabDue(20);
      setItems(due);
      setIdx(0);
      setRevealed(false);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tick = useCallback(
    async (correct: boolean) => {
      const cur = items[idx];
      if (!cur || busy) return;
      setBusy(true);
      try {
        await reviewVocab(cur.word, correct);
      } catch {
        /* swallow */
      }
      setBusy(false);
      setRevealed(false);
      const next = idx + 1;
      if (next >= items.length) {
        await load(); // refill — может появиться новые due cards
        onChanged();
      } else {
        setIdx(next);
      }
    },
    [items, idx, busy, load, onChanged],
  );

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: 12,
          borderTop: '1px solid rgba(255,255,255,0.04)',
          color: 'var(--ink-40)',
          fontSize: 11,
        }}
      >
        <div className="mono" style={{ letterSpacing: '0.08em', fontSize: 9, marginBottom: 4 }}>
          SRS · DAILY
        </div>
        Очередь пуста. Кликай по словам в reader'е чтобы её наполнить.
      </div>
    );
  }

  const cur = items[idx];

  return (
    <div
      style={{
        padding: 12,
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div
        className="mono"
        style={{
          letterSpacing: '0.08em',
          fontSize: 9,
          color: 'var(--ink-40)',
          marginBottom: 8,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>SRS · DAILY</span>
        <span>
          {idx + 1} / {items.length}
        </span>
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--ink)',
          marginBottom: 6,
        }}
      >
        {cur.word}
      </div>
      {revealed ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--ink-60)', marginBottom: 4 }}>
            {cur.translation || '(no translation)'}
          </div>
          {cur.contextMd && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--ink-40)',
                fontStyle: 'italic',
                marginBottom: 8,
                lineHeight: 1.4,
              }}
            >
              «{cur.contextMd}»
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => void tick(false)}
              disabled={busy}
              style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11, flex: 1 }}
            >
              Again
            </button>
            <button
              type="button"
              onClick={() => void tick(true)}
              disabled={busy}
              style={{ ...primaryBtnStyle, padding: '4px 10px', fontSize: 11, flex: 1 }}
            >
              Got it
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          style={{ ...secondaryBtnStyle, padding: '4px 10px', fontSize: 11, width: '100%' }}
        >
          Reveal
        </button>
      )}
    </div>
  );
}

// ─── Reader pill row (Wave: AI-coach inline) ──────────────────────────────
//
// Pill «Спросить coach'а про этот текст» в reading-режиме. Persona по
// active study mode: 'go' → go-coach, 'english' → english-coach, иначе
// algo-coach как универсальный senior-dev фронт. Context-note включает
// тайтл и first-paragraph excerpt, чтобы LLM имел attachment к материалу
// без подгрузки всего body (8KB+ — слишком).

interface ReaderPillRowProps {
  material: ReadingMaterial;
}

function ReaderPillRow({ material }: ReaderPillRowProps) {
  const activeTrack = useTrackStore((s) => s.activeTrack);
  const persona = pickPersonaForReading(activeTrack);
  // First ~600 chars дают coach'у достаточный «taste» материала; больше
  // не имеет смысла — он всё равно не помнит весь body на середине thread'а.
  const excerpt = material.bodyMd.replace(/\s+/g, ' ').trim().slice(0, 600);
  const ctx = `Студент читает: «${material.title}». Источник: ${material.sourceKind}. Excerpt: ${excerpt}${
    material.bodyMd.length > 600 ? '…' : ''
  }`;
  return (
    <div style={{ marginBottom: 24, display: 'flex' }}>
      <AICoachPill
        personaSlug={persona.slug}
        coachName={persona.name}
        contextNote={ctx}
        label="Спросить coach’а про этот текст"
      />
    </div>
  );
}

// Display-name role-only lowercase per memory/feedback_persona_names.md.
// M1 (2026-05-12): 'ml' восстановлен как first-class track → ml-coach
// persona (см. mig 00054_ml_de_personas + mig 00110).
function pickPersonaForReading(
  activeTrack: 'general' | 'dev' | 'ml' | 'english' | 'go',
): { slug: string; name: string } {
  switch (activeTrack) {
    case 'go':
      return { slug: 'go-coach', name: 'go coach' };
    case 'ml':
      return { slug: 'ml-coach', name: 'ml coach' };
    case 'english':
      return { slug: 'english-coach', name: 'english coach' };
    default:
      return { slug: 'algo-coach', name: 'algo coach' };
  }
}
