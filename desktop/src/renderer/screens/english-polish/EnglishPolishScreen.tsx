// EnglishPolishScreen — Wave 6.2.
//
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

const CATEGORY_STRIPE: Record<EnglishPolishCategory, string> = {
  grammar: 'rgb(248, 113, 113)',
  vocab: 'rgb(96, 165, 250)',
  style: 'rgb(251, 191, 36)',
  clarity: 'rgb(167, 139, 250)',
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
  const stripe =
    tier === 'strong'
      ? 'rgb(74, 222, 128)'
      : tier === 'mid'
        ? 'rgb(251, 191, 36)'
        : tier === 'weak'
          ? 'rgb(248, 113, 113)'
          : 'rgba(255,255,255,0.2)';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(20,20,24,0.96)',
        color: '#e6e6e6',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.06)',
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
        {status.kind === 'error' && (
          <Hint text={status.message} tone="error" />
        )}
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
        borderBottom: '1px solid rgba(255,255,255,0.06)',
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
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: 'rgba(255,255,255,0.4)',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          POLISH ENGLISH · ⌃⇧L
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 24, fontWeight: 500 }}>
            {score !== null ? score : '—'}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
            / 100
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginLeft: 4 }}>
            {label}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onRegrade}
        style={{
          // @ts-expect-error — Electron-specific CSS prop
          WebkitAppRegion: 'no-drag',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: '#e6e6e6',
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Re-grade
      </button>
      <button
        type="button"
        onClick={() => void window.druz9.windows.hide('english-polish')}
        style={{
          // @ts-expect-error — Electron-specific CSS prop
          WebkitAppRegion: 'no-drag',
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.6)',
          padding: '4px 10px',
          borderRadius: 6,
          fontSize: 11,
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
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
        padding: '10px 12px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.5,
        color: 'rgba(255,255,255,0.7)',
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
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${CATEGORY_STRIPE[issue.category]}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 9,
            letterSpacing: '0.18em',
            color: CATEGORY_STRIPE[issue.category],
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {CATEGORY_LABEL[issue.category]}
        </span>
        <button
          type="button"
          onClick={() => void apply()}
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.08)',
            color: copied ? 'rgb(74, 222, 128)' : 'rgba(255,255,255,0.6)',
            padding: '2px 8px',
            borderRadius: 5,
            fontSize: 10,
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied →' : 'Copy fix'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', fontStyle: 'italic', marginBottom: 4 }}>
        «{issue.excerpt}»
      </div>
      <div style={{ fontSize: 13, color: '#e6e6e6', marginBottom: 4 }}>{issue.suggestion}</div>
      {issue.explanation && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>
          {issue.explanation}
        </div>
      )}
    </article>
  );
}

function Hint({ text, tone }: { text: string; tone?: 'error' }) {
  return (
    <div
      style={{
        padding: '12px',
        textAlign: 'center',
        color: tone === 'error' ? 'rgb(248, 113, 113)' : 'rgba(255,255,255,0.5)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}
