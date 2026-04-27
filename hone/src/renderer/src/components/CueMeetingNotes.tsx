// CueMeetingNotes — full-page Cluely-style meeting notes viewer.
// Rendered when a Cue session is selected in the Notes sidebar.
// Read-only document layout: date · title · tabs · sections + bottom ask bar.

import { useEffect, useRef, useState } from 'react';
import type { CueSessionAnalysis, CueAnalysisItem, CueAnalysisTerm } from '@shared/ipc';

interface Props {
  analysis: CueSessionAnalysis;
  filePath: string;
}

type Tab = 'summary' | 'actions' | 'raw';

export function CueMeetingNotes({ analysis, filePath: _filePath }: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const [askDraft, setAskDraft] = useState('');
  const [copyHint, setCopyHint] = useState(false);
  const askRef = useRef<HTMLInputElement>(null);

  const dateStr = formatDate(analysis.startedAt);

  const copyFullSummary = async () => {
    const md = buildCueMarkdown(analysis);
    await navigator.clipboard.writeText(md);
    setCopyHint(true);
    setTimeout(() => setCopyHint(false), 1800);
  };

  // ⌘K focuses the ask bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'k') {
        e.preventDefault();
        askRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!askDraft.trim()) return;
    // Future: wire to Copilot with meeting context
    setAskDraft('');
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
      background: 'var(--surface)',
      position: 'relative',
    }}>
      {/* Scrollable content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        paddingBottom: 80,
      }}>
        <div style={{
          maxWidth: 740,
          margin: '0 auto',
          padding: '40px 48px 32px',
        }}>
          {/* Date */}
          <div style={{
            fontSize: 12,
            color: 'var(--ink-40)',
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.04em',
            marginBottom: 10,
          }}>
            {dateStr}
          </div>

          {/* Title */}
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.2,
            color: 'var(--ink)',
            margin: '0 0 20px',
          }}>
            {analysis.title || 'Meeting notes'}
          </h1>

          {/* Tab bar + Copy */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            marginBottom: 28,
            borderBottom: '1px solid var(--hair)',
            paddingBottom: 12,
          }}>
            {(['summary', 'actions', 'raw'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: tab === t ? 500 : 400,
                  background: tab === t ? 'rgba(255,255,255,0.08)' : 'transparent',
                  color: tab === t ? 'var(--ink-90)' : 'var(--ink-40)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 120ms, color 120ms',
                }}
              >
                {t === 'summary' ? 'Summary' : t === 'actions' ? 'Action Items' : 'Raw'}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button
              onClick={() => void copyFullSummary()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                borderRadius: 6,
                fontSize: 12,
                color: copyHint ? '#4ade80' : 'var(--ink-40)',
                border: 'none',
                cursor: 'pointer',
                transition: 'color 120ms',
              }}
            >
              <CopyIcon />
              {copyHint ? 'Copied!' : 'Copy full summary'}
            </button>
          </div>

          {/* Tab content */}
          {tab === 'summary' && <SummaryTab analysis={analysis} />}
          {tab === 'actions' && <ActionsTab analysis={analysis} />}
          {tab === 'raw' && <RawTab analysis={analysis} />}
        </div>
      </div>

      {/* Bottom floating bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '12px 48px',
        background: 'linear-gradient(to top, var(--surface) 60%, transparent)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <form onSubmit={handleAsk} style={{ flex: 1, display: 'flex', gap: 10 }}>
          <input
            ref={askRef}
            value={askDraft}
            onChange={(e) => setAskDraft(e.target.value)}
            placeholder="Ask about this meeting…  ⌘K"
            style={{
              flex: 1,
              height: 38,
              padding: '0 14px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'var(--ink)',
              fontSize: 13,
              outline: 'none',
              transition: 'border-color 150ms',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)')}
          />
          <button
            type="submit"
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: askDraft.trim() ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: askDraft.trim() ? 'var(--ink-90)' : 'var(--ink-40)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: askDraft.trim() ? 'pointer' : 'default',
              transition: 'background 120ms, color 120ms',
            }}
          >
            <SendIcon />
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function SummaryTab({ analysis }: { analysis: CueSessionAnalysis }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* TLDR */}
      {analysis.tldr && (
        <section>
          <SectionHeader>Summary</SectionHeader>
          <p style={{
            fontSize: 14.5,
            lineHeight: 1.65,
            color: 'var(--ink-90)',
            margin: 0,
          }}>
            {analysis.tldr}
          </p>
        </section>
      )}

      {/* Key Topics */}
      {analysis.keyTopics?.length > 0 && (
        <section>
          <SectionHeader>Key Topics</SectionHeader>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {analysis.keyTopics.map((t, i) => (
              <span key={i} style={{
                padding: '3px 10px',
                borderRadius: 20,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.10)',
                fontSize: 12.5,
                color: 'var(--ink-60)',
              }}>
                {t}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Action Items */}
      {analysis.actionItems?.length > 0 && (
        <section>
          <SectionHeader>Action Items</SectionHeader>
          <BulletList items={analysis.actionItems} />
        </section>
      )}

      {/* Decisions */}
      {analysis.decisions?.length > 0 && (
        <section>
          <SectionHeader>Decisions</SectionHeader>
          <BulletList items={analysis.decisions} />
        </section>
      )}

      {/* Open Questions */}
      {analysis.openQuestions?.length > 0 && (
        <section>
          <SectionHeader>Open Questions</SectionHeader>
          <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {analysis.openQuestions.map((q, i) => (
              <li key={i} style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-90)' }}>
                {q}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Terminology */}
      {analysis.terminology?.length > 0 && (
        <section>
          <SectionHeader>Terminology</SectionHeader>
          <TermList items={analysis.terminology} />
        </section>
      )}
    </div>
  );
}

function ActionsTab({ analysis }: { analysis: CueSessionAnalysis }) {
  const all = [...(analysis.actionItems ?? []), ...(analysis.decisions ?? [])];
  if (!all.length) {
    return (
      <div style={{ color: 'var(--ink-40)', fontSize: 14, paddingTop: 12 }}>
        No action items recorded.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {analysis.actionItems?.length > 0 && (
        <section>
          <SectionHeader>Action Items</SectionHeader>
          <BulletList items={analysis.actionItems} />
        </section>
      )}
      {analysis.decisions?.length > 0 && (
        <section>
          <SectionHeader>Decisions</SectionHeader>
          <BulletList items={analysis.decisions} />
        </section>
      )}
    </div>
  );
}

function RawTab({ analysis }: { analysis: CueSessionAnalysis }) {
  if (analysis.reportMarkdown) {
    return (
      <pre style={{
        margin: 0,
        fontSize: 12.5,
        lineHeight: 1.65,
        color: 'var(--ink-60)',
        fontFamily: "'JetBrains Mono', monospace",
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {analysis.reportMarkdown}
      </pre>
    );
  }
  return (
    <pre style={{
      margin: 0,
      fontSize: 11.5,
      lineHeight: 1.6,
      color: 'var(--ink-40)',
      fontFamily: "'JetBrains Mono', monospace",
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    }}>
      {JSON.stringify(analysis, null, 2)}
    </pre>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--ink-40)',
      margin: '0 0 12px',
    }}>
      {children}
    </h2>
  );
}

function BulletList({ items }: { items: CueAnalysisItem[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{
            marginTop: 6,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.35)',
            flexShrink: 0,
          }} />
          <div>
            <span style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-90)', fontWeight: 500 }}>
              {item.title}
            </span>
            {item.detail && (
              <span style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-60)' }}>
                {' '}— {item.detail}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TermList({ items }: { items: CueAnalysisTerm[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{
            marginTop: 6,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.35)',
            flexShrink: 0,
          }} />
          <div>
            <span style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-90)', fontWeight: 600 }}>
              {item.term}
            </span>
            {item.definition && (
              <span style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-60)' }}>
                {' '}— {item.definition}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function buildCueMarkdown(a: CueSessionAnalysis): string {
  const lines: string[] = [`# ${a.title || 'Meeting notes'}`, ''];
  if (a.tldr) lines.push(a.tldr, '');
  if (a.actionItems?.length) {
    lines.push('## Action Items', '');
    a.actionItems.forEach((it) => lines.push(`- **${it.title}**${it.detail ? ` — ${it.detail}` : ''}`));
    lines.push('');
  }
  if (a.decisions?.length) {
    lines.push('## Decisions', '');
    a.decisions.forEach((it) => lines.push(`- **${it.title}**${it.detail ? ` — ${it.detail}` : ''}`));
    lines.push('');
  }
  if (a.openQuestions?.length) {
    lines.push('## Open Questions', '');
    a.openQuestions.forEach((q) => lines.push(`- ${q}`));
    lines.push('');
  }
  if (a.terminology?.length) {
    lines.push('## Terminology', '');
    a.terminology.forEach((t) => lines.push(`- **${t.term}** — ${t.definition}`));
    lines.push('');
  }
  return lines.join('\n');
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="8" height="8" rx="1.5" />
      <path d="M1 9V2a1 1 0 0 1 1-1h7" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 7H2M8 3l4 4-4 4" />
    </svg>
  );
}
