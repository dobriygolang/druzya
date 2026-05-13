// Opens via the english_polish hotkey (default ⌃⇧L). Reads the system
// clipboard on mount, calls window.druz9.english.polish (which proxies
// to /hone/writing/grade in main), and renders the structured feedback.
// Click "Apply" on any issue to copy the suggested rewrite to the
// clipboard so the user can paste it back wherever they came from.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  EnglishPolishCategory,
  EnglishPolishIssue,
  EnglishPolishResult,
} from '@shared/ipc';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; original: string; result: EnglishPolishResult }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

const CATEGORY_LABEL: Record<EnglishPolishCategory, string> = {
  grammar: 'GRAMMAR',
  vocab: 'VOCAB',
  style: 'STYLE',
  clarity: 'CLARITY',
};

// B/W + red rule: категорийные семантики через ink-ramp opacities
// (4 уровня прозрачности вместо 4 hue). Same pattern as Hone Writing.tsx.
const CATEGORY_STRIPE: Record<EnglishPolishCategory, string> = {
  grammar: 'rgba(255, 255, 255, 0.75)',
  vocab: 'rgba(255, 255, 255, 0.55)',
  style: 'rgba(255, 255, 255, 0.65)',
  clarity: 'rgba(255, 255, 255, 0.45)',
};

const monoFont = "'JetBrains Mono', ui-monospace, monospace";

const captionMonoTiny: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--d9-ink-mute)',
};

export function EnglishPolishScreen() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const ranOnceRef = useRef(false);

  const grade = useCallback(async () => {
    setStatus({ kind: 'loading' });
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Clipboard read can fail if the app doesn't have focus — Cue's
      // panel is focusable, but Electron sometimes denies the first
      // call. Fall through to «empty» state with a hint.
      setStatus({
        kind: 'error',
        message:
          'Не удалось прочитать буфер обмена. Открой панель ещё раз — иногда первый запрос macOS отклоняет.',
      });
      return;
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      setStatus({ kind: 'empty' });
      return;
    }
    try {
      const result = await window.druz9.english.polish(trimmed);
      setStatus({ kind: 'ok', original: trimmed, result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown';
      setStatus({ kind: 'error', message });
    }
  }, []);

  // Auto-run on mount + on every hotkey-fired event so re-pressing the
  // hotkey while the panel is open re-grades whatever's currently in the
  // clipboard (without dismissing-and-reopening).
  useEffect(() => {
    if (ranOnceRef.current) return;
    ranOnceRef.current = true;
    void grade();
  }, [grade]);

  useEffect(() => {
    return window.druz9.on('event:hotkey-fired', (payload: { action: string }) => {
      if (payload.action === 'english_polish') {
        void grade();
      }
    });
  }, [grade]);

  // Esc closes the window. We hide() rather than close() — keeps the
  // process warm so the next ⌃⇧L press is instant.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void window.druz9.windows.hide('english-polish');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const score = status.kind === 'ok' ? status.result.overallScore : null;
  const tier =
    score === null ? null : score >= 80 ? 'strong' : score >= 50 ? 'mid' : 'weak';
  // B/W + red rule: weak = var(--d9-accent) canonical, strong/mid via ink-ramp.
  const stripe =
    tier === 'strong'
      ? 'rgba(255, 255, 255, 0.85)'
      : tier === 'mid'
        ? 'rgba(255, 255, 255, 0.55)'
        : tier === 'weak'
          ? 'var(--d9-accent)'
          : 'rgba(255, 255, 255, 0.2)';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20, 20, 24, 0.96)',
        color: 'var(--d9-ink)',
        fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--d9-hairline)',
      }}
    >
      <Header score={score} tier={tier} stripe={stripe} onRegrade={() => void grade()} />

      <main style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px' }}>
        {status.kind === 'idle' && (
          <Hint text="Жми ⌃⇧L снова чтобы обработать буфер обмена." />
        )}
        {status.kind === 'loading' && <Hint text="Grading…" />}
        {status.kind === 'empty' && (
          <Hint text="Буфер обмена пуст. Скопируй текст и нажми ⌃⇧L." />
        )}
        {status.kind === 'error' && <Hint text={status.message} tone="error" />}
        {status.kind === 'ok' && (
          <ResultBody original={status.original} result={status.result} />
        )}
      </main>
    </div>
  );
}

function Header({
  score,
  tier,
  stripe,
  onRegrade,
}: {
  score: number | null;
  tier: 'strong' | 'mid' | 'weak' | null;
  stripe: string;
  onRegrade: () => void;
}) {
  const label =
    tier === 'strong'
      ? 'Strong'
      : tier === 'mid'
        ? 'OK — some gaps'
        : tier === 'weak'
          ? 'Needs work'
          : '—';
  return (
    <header
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--d9-hairline)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderLeft: `3px solid ${stripe}`,
        // Drag-handle: this strip is the only WebKitAppRegion drag area
        // in the panel. Buttons inside opt out via 'no-drag'.
        // @ts-expect-error — Electron-specific CSS prop
        WebkitAppRegion: 'drag',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...captionMonoTiny }}>POLISH ENGLISH · ⌃⇧L</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--pad-inline)', marginTop: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--d9-ink)' }}>
            {score !== null ? score : '—'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--d9-ink-mute)', fontFamily: monoFont }}>/ 100</span>
          <span style={{ fontSize: 12, color: 'var(--d9-ink-dim)', marginLeft: 4 }}>{label}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onRegrade}
        className="focus-ring motion-press"
        style={{
          // @ts-expect-error — Electron-specific CSS prop
          WebkitAppRegion: 'no-drag',
          background: 'transparent',
          border: '1px solid var(--d9-hairline-b)',
          color: 'var(--d9-ink)',
          padding: '5px 12px',
          borderRadius: 'var(--radius-inner, 6px)',
          fontFamily: monoFont,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          transition:
            'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
        }}
      >
        Re-grade
      </button>
      <button
        type="button"
        onClick={() => void window.druz9.windows.hide('english-polish')}
        className="focus-ring motion-press"
        style={{
          // @ts-expect-error — Electron-specific CSS prop
          WebkitAppRegion: 'no-drag',
          background: 'transparent',
          border: '1px solid var(--d9-hairline)',
          color: 'var(--d9-ink-mute)',
          padding: '5px 12px',
          borderRadius: 'var(--radius-inner, 6px)',
          fontFamily: monoFont,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
        }}
      >
        Esc
      </button>
    </header>
  );
}

function ResultBody({
  original,
  result,
}: {
  original: string;
  result: EnglishPolishResult;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <OriginalBlock text={original} />
      {result.issues.length === 0 ? (
        <Hint text="AI didn't flag anything. Looks clean." />
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--pad-inline)',
          }}
        >
          {result.issues.map((issue, i) => (
            <li key={i}>
              <IssueRow issue={issue} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OriginalBlock({ text }: { text: string }) {
  const preview = useMemo(() => {
    const trimmed = text.trim();
    if (trimmed.length <= 240) return trimmed;
    return trimmed.slice(0, 240).trimEnd() + '…';
  }, [text]);
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'transparent',
        border: '1px solid var(--d9-hairline)',
        borderRadius: 'var(--radius-inner, 8px)',
        fontSize: 12,
        lineHeight: 1.55,
        color: 'var(--d9-ink-dim)',
        fontFamily: "'Instrument Serif', ui-serif, Georgia, serif",
        fontStyle: 'italic',
      }}
    >
      «{preview}»
    </div>
  );
}

function IssueRow({ issue }: { issue: EnglishPolishIssue }) {
  const [copied, setCopied] = useState(false);

  const apply = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(issue.suggestion);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* no toast surface on this window — silent */
    }
  }, [issue.suggestion]);

  return (
    <article
      style={{
        padding: '10px 12px',
        background: 'transparent',
        border: '1px solid var(--d9-hairline)',
        borderLeft: `3px solid ${CATEGORY_STRIPE[issue.category]}`,
        borderRadius: 'var(--radius-inner, 8px)',
      }}
    >
      <div className="flex-wrap-row" style={{ alignItems: 'center', gap: 'var(--pad-inline)', marginBottom: 6 }}>
        <span
          style={{
            ...captionMonoTiny,
            color: CATEGORY_STRIPE[issue.category],
          }}
        >
          {CATEGORY_LABEL[issue.category]}
        </span>
        <button
          type="button"
          onClick={() => void apply()}
          className="focus-ring motion-press"
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid var(--d9-hairline-b)',
            color: copied ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
            padding: '2px 10px',
            borderRadius: 999,
            fontFamily: monoFont,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            transition:
              'color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          {copied && (
            <span aria-hidden="true" style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: 'var(--d9-accent)' }} />
          )}
          {copied ? 'Copied' : 'Copy fix'}
        </button>
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--d9-ink-mute)',
          fontFamily: "'Instrument Serif', ui-serif, Georgia, serif",
          fontStyle: 'italic',
          marginBottom: 6,
        }}
      >
        «{issue.excerpt}»
      </div>
      <div style={{ fontSize: 13, color: 'var(--d9-ink)', marginBottom: 4, lineHeight: 1.5 }}>
        {issue.suggestion}
      </div>
      {issue.explanation && (
        <div style={{ fontSize: 11, color: 'var(--d9-ink-mute)', lineHeight: 1.55 }}>
          {issue.explanation}
        </div>
      )}
    </article>
  );
}

function Hint({ text, tone }: { text: string; tone?: 'error' }) {
  if (tone === 'error') {
    return (
      <div
        role="alert"
        style={{
          padding: '12px',
          textAlign: 'left',
          color: 'var(--d9-accent)',
          fontSize: 13,
          lineHeight: 1.55,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--d9-accent)', marginTop: 8, flex: '0 0 auto' }} />
        <span>{text}</span>
      </div>
    );
  }
  return (
    <div
      style={{
        padding: '12px',
        textAlign: 'center',
        color: 'var(--d9-ink-mute)',
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {text}
    </div>
  );
}
