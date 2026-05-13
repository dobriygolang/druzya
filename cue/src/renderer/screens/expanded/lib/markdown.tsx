// Mini markdown renderer used inside assistant MessageBubble's:
//   - triple-backtick fences → CodeBlock with copy button
//   - single backticks → inline <code>
//
// Plus a `truncate` helper for short chip labels (InterviewPrepChip).
//
// We deliberately avoid a full markdown lib until UX demands it; this
// covers 90% of LLM outputs for MVP.

import { useState } from 'react';

import { D9IconCopy } from '../../../components/d9';

export function renderMiniMarkdown(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const parts = text.split(/(```[\s\S]*?```)/g);
  parts.forEach((part, i) => {
    if (part.startsWith('```')) {
      const closed = part.endsWith('```') && part.length > 6;
      const body = closed ? part.slice(3, -3) : part.slice(3);
      const firstNl = body.indexOf('\n');
      const lang = firstNl >= 0 ? body.slice(0, firstNl).trim() : '';
      const code = firstNl >= 0 ? body.slice(firstNl + 1) : body;
      nodes.push(<CodeBlock key={i} lang={lang} code={code.trimEnd()} />);
    } else {
      nodes.push(<InlineText key={i} text={part} />);
    }
  });
  return nodes;
}

export function InlineText({ text }: { text: string }) {
  const segments = text.split(/(`[^`]+`)/g);
  return (
    <>
      {segments.map((s, i) =>
        s.startsWith('`') && s.endsWith('`') && s.length > 2 ? (
          <code
            key={i}
            style={{
              fontFamily: 'var(--d9-font-mono)',
              fontSize: 12,
              padding: '1px 5px',
              background: 'rgba(255, 255, 255, 0.06)',
              borderRadius: 4,
              color: 'var(--d9-ink)',
            }}
          >
            {s.slice(1, -1)}
          </code>
        ) : (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {s}
          </span>
        ),
      )}
    </>
  );
}

export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        margin: '8px 0 12px',
        borderRadius: 'var(--radius-outer)',
        // Code-block shell — deeper than the surrounding surface.
        // Pure black 75% alpha lets the scrim show through slightly.
        background: 'rgba(0, 0, 0, 0.6)',
        border: '0.5px solid var(--d9-hairline)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 8px 6px 12px',
          borderBottom: '0.5px solid var(--d9-hairline)',
          background: 'rgba(255, 255, 255, 0.02)',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--d9-font-mono)',
            fontSize: 10.5,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--d9-ink-ghost)',
          }}
        >
          {lang || 'code'}
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard denied — silent */
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--gap-row)',
            padding: '3px 7px',
            borderRadius: 5,
            color: 'var(--d9-ink-mute)',
            fontSize: 10.5,
            letterSpacing: '0.02em',
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <D9IconCopy size={11} />
          {copied ? 'Скопировано' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px 12px',
          overflowX: 'auto',
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 12,
          lineHeight: 1.65,
          color: 'var(--d9-ink-dim)',
          whiteSpace: 'pre',
        }}
      >
        {code}
      </pre>
    </div>
  );
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
