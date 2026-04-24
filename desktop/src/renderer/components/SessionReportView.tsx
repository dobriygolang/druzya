// Inline report viewer for the BYOK path. The server path opens a
// Druzya web page instead — this component only exists because BYOK
// reports have no URL and still need to be displayed somewhere.
//
// Rendering is deliberately minimal: overall score card + section
// scores + weaknesses/recommendations bullets + the free-form
// markdown appended verbatim (mini-renderer reused from the chat
// bubble).

import type { SessionAnalysis } from '@shared/types';

export interface SessionReportViewProps {
  analysis: SessionAnalysis;
}

const SECTION_LABELS: Record<string, string> = {
  algorithms: 'Алгоритмы',
  sql: 'SQL',
  go: 'Go',
  system_design: 'System Design',
  behavioral: 'Behavioral',
};

export function SessionReportView({ analysis }: SessionReportViewProps) {
  if (analysis.status === 'failed') {
    return (
      <div
        style={{
          padding: 16,
          background: 'rgba(255, 69, 58, 0.08)',
          border: '1px solid rgba(255, 69, 58, 0.3)',
          borderRadius: 10,
          color: 'var(--d-red)',
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Анализ не удался</div>
        <div style={{ opacity: 0.85 }}>{analysis.errorMessage || 'неизвестная ошибка'}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Overall score card */}
      <div
        style={{
          padding: 14,
          background: 'var(--d-gradient-hero-soft)',
          border: '1px solid var(--d-line)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: 'var(--d-gradient-hero)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            fontWeight: 700,
            fontFamily: 'var(--f-display)',
          }}
        >
          {analysis.overallScore}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Общая уверенность</div>
          <div style={{ fontSize: 11, color: 'var(--d-text-3)' }}>по 100-балльной шкале</div>
        </div>
      </div>

      {/* Section scores */}
      {Object.keys(analysis.sectionScores).length > 0 && (
        <Block title="По секциям">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(analysis.sectionScores).map(([key, value]) => (
              <SectionBar key={key} label={SECTION_LABELS[key] ?? key} value={value} />
            ))}
          </div>
        </Block>
      )}

      {analysis.weaknesses.length > 0 && (
        <Block title="Слабые места">
          <BulletList items={analysis.weaknesses} bulletColor="var(--d-red)" />
        </Block>
      )}

      {analysis.recommendations.length > 0 && (
        <Block title="Что повторить">
          <BulletList items={analysis.recommendations} bulletColor="var(--d-green)" />
        </Block>
      )}

      {analysis.reportMarkdown && (
        <Block title="Развёрнутый разбор">
          <MiniMarkdown text={analysis.reportMarkdown} />
        </Block>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3
        style={{
          margin: '0 0 8px',
          fontSize: 11,
          color: 'var(--d-text-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          fontFamily: 'var(--f-mono)',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function SectionBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 110, fontSize: 12, color: 'var(--d-text)' }}>{label}</div>
      <div
        style={{
          flex: 1,
          height: 8,
          borderRadius: 4,
          background: 'var(--d-bg-2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            height: '100%',
            background: 'var(--d-gradient-hero)',
          }}
        />
      </div>
      <div
        style={{
          width: 30,
          textAlign: 'right',
          fontSize: 11,
          fontFamily: 'var(--f-mono)',
          color: 'var(--d-text-2)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BulletList({ items, bulletColor }: { items: string[]; bulletColor: string }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((b, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--d-text)', lineHeight: 1.5 }}>
          <span style={{ color: bulletColor, fontWeight: 700 }}>•</span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

function MiniMarkdown({ text }: { text: string }) {
  // Minimum viable rendering: paragraph split on blank lines, ## as h3.
  return (
    <div style={{ fontSize: 13, color: 'var(--d-text)', lineHeight: 1.55 }}>
      {text.split(/\n\n+/).map((para, i) => {
        const trimmed = para.trim();
        if (trimmed.startsWith('## ')) {
          return (
            <h4
              key={i}
              style={{
                margin: '10px 0 6px',
                fontSize: 13,
                color: 'var(--d-text)',
                fontFamily: 'var(--f-display)',
              }}
            >
              {trimmed.replace(/^##\s*/, '')}
            </h4>
          );
        }
        return (
          <p key={i} style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}
