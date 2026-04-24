// SummaryModal — Cluely-style Session Summary view, rendered as a
// modal overlay inside the expanded window. Three tabs:
//   Summary   — TLDR · key topics · action items · decisions · terminology · open questions
//   Transcript — the full conversation(s) that fed the analyzer
//   Usage     — turns · tokens in/out · wall time · score breakdown
//
// Rather than adding a new BrowserWindow (more infrastructure: build
// branch + hashFor + bounds persistence), we render over the existing
// expanded window's root. Escape / click-outside closes. The copy-as-
// markdown reuses exportConversationAsMarkdown over the same messages
// the expanded chat already has loaded (no extra fetch).
//
// "Share" opens the server-side web report URL externally — `reportUrl`
// is always set unless the session was BYOK. "Resume session" just
// closes the modal so the user can keep chatting in the same thread.

import { useEffect, useMemo, useState } from 'react';

import type { SessionAnalysis } from '@shared/types';
import {
  D9IconClose,
  D9IconCopy,
  IconButton,
  Kbd,
  Tag,
} from '../../components/d9';
import { exportConversationAsMarkdown } from '../../lib/export-markdown';
import { useConversationStore } from '../../stores/conversation';

type Tab = 'summary' | 'transcript' | 'usage';

interface Props {
  analysis: SessionAnalysis;
  modelLabel?: string;
  onClose: () => void;
}

export function SummaryModal({ analysis, modelLabel, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const [hint, setHint] = useState<string | null>(null);
  const messages = useConversationStore((s) => s.messages);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const markdown = useMemo(
    () =>
      exportConversationAsMarkdown(messages, {
        title: analysis.title || 'Druz9 Copilot — session summary',
        modelLabel,
      }),
    [messages, modelLabel, analysis.title],
  );

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(summaryToMarkdown(analysis) + '\n\n---\n\n' + markdown);
      setHint('✓ Скопировано');
      setTimeout(() => setHint(null), 1800);
    } catch {
      setHint('Не удалось скопировать');
      setTimeout(() => setHint(null), 2200);
    }
  };

  const share = () => {
    if (!analysis.reportUrl) return;
    void window.druz9.shell.openExternal(analysis.reportUrl);
  };

  const headerTitle = analysis.title || 'Session summary';

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'oklch(0.05 0.015 280 / 0.55)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)' as unknown as string,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        className="d9-root"
        style={{
          flex: 1,
          maxWidth: 720,
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 'var(--d9-r-xl)',
          background:
            'linear-gradient(180deg, rgba(22, 22, 22, 0.92), rgba(10, 10, 10, 0.96))',
          boxShadow: 'var(--d9-shadow-pop)',
          border: '0.5px solid var(--d9-hairline-b)',
          color: 'var(--d9-ink)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 12px 10px 16px',
            borderBottom: '0.5px solid var(--d9-hairline)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--d9-font-display)',
                fontStyle: 'italic',
                fontSize: 22,
                letterSpacing: '-0.01em',
                lineHeight: 1.15,
                color: 'var(--d9-ink)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {headerTitle}
            </div>
            {analysis.tldr && (
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--d9-ink-mute)',
                  marginTop: 2,
                  letterSpacing: '-0.005em',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {analysis.tldr}
              </div>
            )}
          </div>
          <IconButton title={hint || 'Скопировать summary как Markdown'} onClick={() => void copyMarkdown()}>
            <D9IconCopy size={14} />
          </IconButton>
          {analysis.reportUrl && (
            <button
              onClick={share}
              style={{
                padding: '5px 10px',
                borderRadius: 7,
                background: 'oklch(1 0 0 / 0.06)',
                border: '0.5px solid var(--d9-hairline)',
                color: 'var(--d9-ink)',
                fontSize: 11.5,
                letterSpacing: '-0.005em',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Открыть в браузере
            </button>
          )}
          <IconButton title="Закрыть (Esc)" onClick={onClose}>
            <D9IconClose size={12} />
          </IconButton>
        </div>

        {/* Tab bar */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 12px',
            borderBottom: '0.5px solid var(--d9-hairline)',
          }}
        >
          {([
            ['summary', 'Summary'],
            ['transcript', 'Transcript'],
            ['usage', 'Usage'],
          ] as Array<[Tab, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                padding: '6px 12px',
                borderRadius: 7,
                background: tab === id ? 'oklch(1 0 0 / 0.08)' : 'transparent',
                border: '0.5px solid ' + (tab === id ? 'var(--d9-hairline-b)' : 'transparent'),
                color: tab === id ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
                fontSize: 12,
                letterSpacing: '-0.005em',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              padding: '6px 10px',
              borderRadius: 7,
              background: 'transparent',
              border: 0,
              color: 'var(--d9-ink-mute)',
              fontSize: 11.5,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Продолжить сессию <Kbd size="sm">Esc</Kbd>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }}>
          {tab === 'summary' && <SummaryTab a={analysis} />}
          {tab === 'transcript' && <TranscriptTab />}
          {tab === 'usage' && <UsageTab a={analysis} />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────────────

function SummaryTab({ a }: { a: SessionAnalysis }) {
  const hasAnything =
    a.tldr ||
    (a.keyTopics?.length ?? 0) > 0 ||
    (a.actionItems?.length ?? 0) > 0 ||
    (a.decisions?.length ?? 0) > 0 ||
    (a.terminology?.length ?? 0) > 0 ||
    (a.openQuestions?.length ?? 0) > 0 ||
    a.reportMarkdown;

  if (!hasAnything) {
    return (
      <EmptySection
        title="Summary пока не готов"
        hint="Анализатор ещё обрабатывает сессию. Это занимает 10–30 секунд после её окончания."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {a.keyTopics && a.keyTopics.length > 0 && (
        <Section title="Key topics">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {a.keyTopics.map((t, i) => (
              <Tag key={i}>{t}</Tag>
            ))}
          </div>
        </Section>
      )}

      {a.actionItems && a.actionItems.length > 0 && (
        <Section title="Action items">
          <ItemList items={a.actionItems} />
        </Section>
      )}

      {a.decisions && a.decisions.length > 0 && (
        <Section title="Decisions">
          <ItemList items={a.decisions} />
        </Section>
      )}

      {a.terminology && a.terminology.length > 0 && (
        <Section title="Terminology">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {a.terminology.map((t, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 12px',
                  borderRadius: 9,
                  background: 'oklch(1 0 0 / 0.03)',
                  border: '0.5px solid var(--d9-hairline)',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--d9-font-mono)',
                    fontSize: 11.5,
                    color: 'var(--d9-accent-hi)',
                    letterSpacing: '0.02em',
                  }}
                >
                  {t.term}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: 'var(--d9-ink-dim)',
                    marginTop: 2,
                    letterSpacing: '-0.005em',
                  }}
                >
                  {t.definition}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {a.openQuestions && a.openQuestions.length > 0 && (
        <Section title="Open questions">
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--d9-ink-dim)',
              letterSpacing: '-0.005em',
            }}
          >
            {a.openQuestions.map((q, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {q}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(a.weaknesses?.length ?? 0) + (a.recommendations?.length ?? 0) > 0 && (
        <Section title="Rubric notes">
          {a.weaknesses && a.weaknesses.length > 0 && (
            <SubBlock label="Weaknesses">
              <ul style={ulStyle}>
                {a.weaknesses.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </SubBlock>
          )}
          {a.recommendations && a.recommendations.length > 0 && (
            <SubBlock label="Recommendations">
              <ul style={ulStyle}>
                {a.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </SubBlock>
          )}
        </Section>
      )}

      {a.reportMarkdown && (
        <Section title="Full report">
          <pre
            style={{
              margin: 0,
              padding: '12px 14px',
              borderRadius: 9,
              background: 'rgba(0, 0, 0, 0.6)',
              border: '0.5px solid var(--d9-hairline)',
              color: 'var(--d9-ink-dim)',
              fontFamily: 'var(--d9-font-sans)',
              fontSize: 12.5,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              letterSpacing: '-0.005em',
            }}
          >
            {a.reportMarkdown}
          </pre>
        </Section>
      )}
    </div>
  );
}

function TranscriptTab() {
  const messages = useConversationStore((s) => s.messages);
  if (messages.length === 0) {
    return (
      <EmptySection
        title="Нет сообщений"
        hint="Транскрипт недоступен — в текущем окне нет загруженной сессии."
      />
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {messages.map((m) => (
        <div
          key={m.id}
          style={{
            padding: '10px 12px',
            borderRadius: 9,
            background:
              m.role === 'user'
                ? 'oklch(0.38 0.18 298 / 0.16)'
                : 'oklch(1 0 0 / 0.03)',
            border: '0.5px solid var(--d9-hairline)',
          }}
        >
          <div
            style={{
              fontSize: 10.5,
              fontFamily: 'var(--d9-font-mono)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: m.role === 'user' ? 'var(--d9-accent-hi)' : 'var(--d9-ink-ghost)',
              marginBottom: 4,
            }}
          >
            {m.role}
            {m.hasScreenshot && ' · screenshot'}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--d9-ink)',
              lineHeight: 1.55,
              letterSpacing: '-0.005em',
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.content || (m.pending ? '(стримится…)' : '(пусто)')}
          </div>
        </div>
      ))}
    </div>
  );
}

function UsageTab({ a }: { a: SessionAnalysis }) {
  const u = a.usage;
  const sections = Object.entries(a.sectionScores ?? {});
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Section title="Tokens & timing">
        {u ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 10,
            }}
          >
            <Stat label="Turns" value={formatNum(u.turns)} />
            <Stat label="Wall time" value={formatDuration(u.totalLatencyMs)} />
            <Stat label="Tokens in" value={formatNum(u.tokensIn)} />
            <Stat label="Tokens out" value={formatNum(u.tokensOut)} />
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: 'var(--d9-ink-mute)' }}>
            Данные о токенах недоступны для этой сессии.
          </div>
        )}
      </Section>

      <Section title="Rubric scores">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ScoreBar label="Overall" value={a.overallScore} />
          {sections.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--d9-ink-mute)' }}>
              Section scores не рассчитаны — анализатор не нашёл явных тем.
            </div>
          )}
          {sections.map(([k, v]) => (
            <ScoreBar key={k} label={labelize(k)} value={v} />
          ))}
        </div>
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Bits
// ─────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontFamily: 'var(--d9-font-mono)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--d9-ink-ghost)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function SubBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: 'var(--d9-ink-dim)',
          letterSpacing: '-0.005em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function ItemList({ items }: { items: Array<{ title: string; detail?: string }> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            padding: '10px 12px',
            borderRadius: 9,
            background: 'oklch(1 0 0 / 0.03)',
            border: '0.5px solid var(--d9-hairline)',
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--d9-ink)',
              letterSpacing: '-0.005em',
            }}
          >
            {it.title}
          </div>
          {it.detail && (
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--d9-ink-dim)',
                marginTop: 4,
                lineHeight: 1.5,
                letterSpacing: '-0.005em',
              }}
            >
              {it.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 9,
        background: 'oklch(1 0 0 / 0.03)',
        border: '0.5px solid var(--d9-hairline)',
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontFamily: 'var(--d9-font-mono)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--d9-ink-ghost)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontFamily: 'var(--d9-font-display)',
          fontStyle: 'italic',
          color: 'var(--d9-ink)',
          marginTop: 2,
          letterSpacing: '-0.01em',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        style={{
          width: 120,
          fontSize: 12,
          color: 'var(--d9-ink-dim)',
          letterSpacing: '-0.005em',
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: 'oklch(1 0 0 / 0.08)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--d9-accent-lo), var(--d9-accent-hi))',
            boxShadow: '0 0 8px var(--d9-accent-glow)',
          }}
        />
      </span>
      <span
        style={{
          width: 42,
          textAlign: 'right',
          fontFamily: 'var(--d9-font-mono)',
          fontSize: 11.5,
          color: 'var(--d9-ink-dim)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {pct}
      </span>
    </div>
  );
}

function EmptySection({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      style={{
        padding: 40,
        textAlign: 'center',
        color: 'var(--d9-ink-mute)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--d9-font-display)',
          fontStyle: 'italic',
          fontSize: 18,
          color: 'var(--d9-ink-dim)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12.5, letterSpacing: '-0.005em' }}>{hint}</div>
    </div>
  );
}

const ulStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  fontSize: 12.5,
  lineHeight: 1.55,
  color: 'var(--d9-ink-dim)',
  letterSpacing: '-0.005em',
};

function formatNum(n: number): string {
  return n.toLocaleString('ru-RU');
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function labelize(key: string): string {
  // "system_design" → "System design"
  return key
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * summaryToMarkdown — render just the structured summary as markdown
 * (for Copy-as-Markdown). The full transcript is appended by the caller
 * via exportConversationAsMarkdown.
 */
function summaryToMarkdown(a: SessionAnalysis): string {
  const lines: string[] = [];
  const title = a.title || 'Druz9 Copilot — session summary';
  lines.push(`# ${title}`);
  if (a.tldr) {
    lines.push('');
    lines.push(`_${a.tldr}_`);
  }
  if (a.keyTopics && a.keyTopics.length) {
    lines.push('');
    lines.push('## Key topics');
    lines.push(a.keyTopics.map((t) => `\`${t}\``).join(' · '));
  }
  if (a.actionItems && a.actionItems.length) {
    lines.push('');
    lines.push('## Action items');
    for (const it of a.actionItems) {
      lines.push(`- **${it.title}**${it.detail ? ` — ${it.detail}` : ''}`);
    }
  }
  if (a.decisions && a.decisions.length) {
    lines.push('');
    lines.push('## Decisions');
    for (const it of a.decisions) {
      lines.push(`- **${it.title}**${it.detail ? ` — ${it.detail}` : ''}`);
    }
  }
  if (a.terminology && a.terminology.length) {
    lines.push('');
    lines.push('## Terminology');
    for (const t of a.terminology) {
      lines.push(`- \`${t.term}\` — ${t.definition}`);
    }
  }
  if (a.openQuestions && a.openQuestions.length) {
    lines.push('');
    lines.push('## Open questions');
    for (const q of a.openQuestions) {
      lines.push(`- ${q}`);
    }
  }
  if (a.weaknesses && a.weaknesses.length) {
    lines.push('');
    lines.push('## Weaknesses');
    for (const w of a.weaknesses) {
      lines.push(`- ${w}`);
    }
  }
  if (a.recommendations && a.recommendations.length) {
    lines.push('');
    lines.push('## Recommendations');
    for (const r of a.recommendations) {
      lines.push(`- ${r}`);
    }
  }
  if (a.reportMarkdown) {
    lines.push('');
    lines.push('## Full report');
    lines.push('');
    lines.push(a.reportMarkdown);
  }
  return lines.join('\n');
}
