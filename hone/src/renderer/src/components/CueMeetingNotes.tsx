// CueMeetingNotes — light Cluely-style card на тёмном Hone-фоне.
//
// Layout 1:1 повторяет Cluely meeting summary:
//   - Top-right: «Follow-up email» (с blue dot) + «Share ▾»
//   - Date eyebrow (Monday, Nov 3) + большой жирный title
//   - Tab pills (Summary | Transcript | Usage) + «General ▾» persona
//   - Sections: Action Items, Terminology — buleted, bold inline keywords
//   - Floating bottom: «▶ Resume Session» + ask-input + ↗ submit
//
// Карточка светлая (white card), визуально живёт поверх dark Hone shell —
// тот же контраст что Cluely в их фрейме. Отдельные стили локализованы
// в этом файле, не мутируем globals.css (карточка — единственное светлое
// место в Hone).
import { useEffect, useRef, useState } from 'react';
import type { CueSessionAnalysis, CueAnalysisItem, CueAnalysisTerm } from '@shared/ipc';

interface Props {
  analysis: CueSessionAnalysis;
  filePath: string;
  // sessionId — id из backend hone_cue_sessions. Если задан — кнопка
  // «Follow-up TG» зовёт sendCueSessionToTelegram(sessionId). null, когда
  // карточка открыта на свежем deep-link'е до того как Import RPC отдал
  // объект (короткое окно — UI просто disabled).
  sessionId?: string | null;
}

type Tab = 'summary' | 'transcript' | 'usage';

// ─── Inline-bold parser ─────────────────────────────────────────────────────
//
// Cluely action-items имеют **жирные** ключевые слова inline. Source-mode
// keep'аем, но в render UI парсим **…** → <strong>. Минимальный инлайн-md
// (без вложений), достаточно для бекендового output'а.
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  const re = /\*\*(.+?)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > i) out.push(<span key={key++}>{text.slice(i, m.index)}</span>);
    out.push(<strong key={key++} style={{ fontWeight: 700, color: '#0d0d0d' }}>{m[1]}</strong>);
    i = m.index + m[0].length;
  }
  if (i < text.length) out.push(<span key={key++}>{text.slice(i)}</span>);
  return out;
}

export function CueMeetingNotes({ analysis, filePath, sessionId }: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const [persona, setPersona] = useState('General');
  const [askDraft, setAskDraft] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgToast, setTgToast] = useState<string | null>(null);
  const askRef = useRef<HTMLInputElement>(null);

  // Start Cue: открывает Cue desktop'а на этой же сессии. Fallback на
  // веб-копилот если Cue не установлен (deeplink registration упадёт
  // silently → useradata: страница откроется в default browser).
  const handleStartCue = () => {
    const url = filePath
      ? `druz9://cue/open?file=${encodeURIComponent(filePath)}`
      : 'https://druz9.online/copilot';
    void window.hone?.shell.openExternal(url).catch(() => {
      // Если protocol handler не зарегистрирован — открываем web-fallback.
      void window.hone?.shell.openExternal('https://druz9.online/copilot');
    });
  };

  // Follow-up TG: отправляет markdown-сводку в личный TG чат через
  // sendCueSessionToTelegram RPC. Реакция:
  //   - sessionId null  → toast «session not synced yet»
  //   - ok=false        → toast = backend message (например «telegram not linked»)
  //   - ok=true         → toast «Sent to Telegram»
  const handleFollowupTG = async () => {
    if (!sessionId) {
      setTgToast('Session not synced yet');
      window.setTimeout(() => setTgToast(null), 2400);
      return;
    }
    if (tgBusy) return;
    setTgBusy(true);
    try {
      const { sendCueSessionToTelegram } = await import('../api/hone');
      const r = await sendCueSessionToTelegram(sessionId);
      setTgToast(r.ok ? 'Sent to Telegram' : (r.message || 'Telegram not linked'));
    } catch (e) {
      setTgToast(`Send failed: ${(e as Error).message}`);
    } finally {
      setTgBusy(false);
      window.setTimeout(() => setTgToast(null), 2800);
    }
  };

  const dateStr = formatDate(analysis.startedAt);

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
    // wire to Copilot context later
    setAskDraft('');
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        // Light gradient subtle на dark canvas — emulates Cluely's window frame
        background: 'linear-gradient(135deg, #d8e3ff 0%, #f4f6ff 40%, #ffffff 100%)',
        padding: '24px',
        position: 'relative',
      }}
    >
      <div
        style={{
          flex: 1,
          background: '#ffffff',
          borderRadius: 18,
          boxShadow:
            '0 24px 60px -12px rgba(20,30,80,0.18), 0 0 0 1px rgba(20,30,80,0.06)',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top bar: search-stub + start-cluely + avatar */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 20px',
            borderBottom: '1px solid rgba(20,30,80,0.06)',
          }}
        >
          <span style={{ width: 44 }} />
          <div
            style={{
              flex: 1,
              maxWidth: 460,
              margin: '0 auto',
              padding: '7px 14px',
              border: '1px solid rgba(20,30,80,0.08)',
              borderRadius: 999,
              background: 'rgba(245,247,251,0.6)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: '#7a8295',
            }}
          >
            <SearchIcon />
            <span>Search or ask anything…</span>
          </div>
          <button
            onClick={handleStartCue}
            title="Open this session in Cue desktop"
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              background: 'rgba(48,128,255,0.08)',
              color: '#3b82f6',
              fontSize: 13,
              fontWeight: 500,
              border: '1px solid rgba(48,128,255,0.14)',
              cursor: 'pointer',
            }}
          >
            Start Cue
          </button>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#dfe5f0',
              flexShrink: 0,
            }}
          />
        </header>

        {/* Action buttons row (Follow-up email + Share) */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '14px 32px 0',
            gap: 8,
          }}
        >
          <button
            onClick={handleFollowupTG}
            disabled={tgBusy}
            title={sessionId ? 'Send markdown summary to your Telegram' : 'Sync session first'}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid rgba(20,30,80,0.10)',
              background: '#ffffff',
              color: '#1f2233',
              fontSize: 12.5,
              cursor: tgBusy ? 'progress' : 'pointer',
              opacity: tgBusy ? 0.6 : 1,
            }}
          >
            <TelegramIcon />
            {tgBusy ? 'Sending…' : 'Follow-up TG'}
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 8,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#3b82f6',
              }}
            />
          </button>
          {tgToast && (
            <span
              style={{
                position: 'absolute',
                top: -28,
                right: 32,
                background: '#0d0d0d',
                color: '#fff',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11.5,
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 50,
              }}
            >
              {tgToast}
            </span>
          )}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShareOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px 6px 12px',
                borderRadius: 8,
                border: '1px solid rgba(20,30,80,0.10)',
                background: '#ffffff',
                color: '#1f2233',
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              <LinkIcon />
              Share
              <span style={{ marginLeft: 4, opacity: 0.5, fontSize: 9 }}>▼</span>
            </button>
            {shareOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  zIndex: 20,
                  minWidth: 160,
                  padding: 4,
                  borderRadius: 8,
                  background: '#ffffff',
                  border: '1px solid rgba(20,30,80,0.10)',
                  boxShadow: '0 12px 28px -6px rgba(20,30,80,0.18)',
                }}
              >
                <ShareItem label="Copy public link" />
                <ShareItem label="Export markdown" />
              </div>
            )}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
          <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 56px 32px' }}>
            <div
              style={{
                fontSize: 13,
                color: '#7a8295',
                marginBottom: 6,
              }}
            >
              {dateStr}
            </div>
            <h1
              style={{
                fontSize: 30,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
                color: '#0d0d0d',
                margin: '0 0 18px',
              }}
            >
              {analysis.title || 'Meeting notes'}
            </h1>

            {/* Tab pills + persona dropdown */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 28,
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  background: 'rgba(20,30,80,0.05)',
                  borderRadius: 8,
                  padding: 3,
                }}
              >
                {(['summary', 'transcript', 'usage'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: tab === t ? 600 : 400,
                      background: tab === t ? '#ffffff' : 'transparent',
                      color: tab === t ? '#0d0d0d' : '#5a6478',
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: tab === t ? '0 1px 2px rgba(20,30,80,0.06)' : 'none',
                      transition: 'background 120ms',
                    }}
                  >
                    {t === 'summary' ? 'Summary' : t === 'transcript' ? 'Transcript' : 'Usage'}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setPersona((p) => (p === 'General' ? 'Technical' : 'General'))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(20,30,80,0.10)',
                  background: '#ffffff',
                  color: '#1f2233',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <SwapIcon />
                {persona}
                <span style={{ marginLeft: 2, opacity: 0.5, fontSize: 9 }}>▼</span>
              </button>
            </div>

            {tab === 'summary' && <SummaryTab analysis={analysis} />}
            {tab === 'transcript' && <TranscriptTab analysis={analysis} />}
            {tab === 'usage' && <UsageTab analysis={analysis} />}
          </div>
        </div>

        {/* Floating bottom bar — Resume + ask */}
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '8px 8px 8px 16px',
            background: '#ffffff',
            borderRadius: 999,
            border: '1px solid rgba(20,30,80,0.08)',
            boxShadow: '0 18px 40px -8px rgba(20,30,80,0.18)',
            minWidth: 540,
          }}
        >
          <button
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px 6px 12px',
              borderRadius: 999,
              background: '#0d0d0d',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <PlayIcon />
            Resume Session
          </button>
          <form onSubmit={handleAsk} style={{ flex: 1, display: 'flex', gap: 8 }}>
            <input
              ref={askRef}
              value={askDraft}
              onChange={(e) => setAskDraft(e.target.value)}
              placeholder="Ask Cue about this meeting…"
              style={{
                flex: 1,
                padding: '6px 0',
                fontSize: 13,
                color: '#0d0d0d',
                background: 'transparent',
                border: 'none',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: askDraft.trim() ? '#0d0d0d' : 'rgba(20,30,80,0.06)',
                color: askDraft.trim() ? '#ffffff' : '#5a6478',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: askDraft.trim() ? 'pointer' : 'default',
                transition: 'background 120ms, color 120ms',
                flexShrink: 0,
              }}
            >
              <ArrowUpRightIcon />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

function SummaryTab({ analysis }: { analysis: CueSessionAnalysis }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
      {analysis.actionItems?.length > 0 && (
        <Section
          title="Action Items"
          rightSlot={<CopyFullSummary analysis={analysis} />}
        >
          <BulletList items={analysis.actionItems} />
        </Section>
      )}
      {analysis.decisions?.length > 0 && (
        <Section title="Decisions">
          <BulletList items={analysis.decisions} />
        </Section>
      )}
      {analysis.openQuestions?.length > 0 && (
        <Section title="Open Questions">
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {analysis.openQuestions.map((q, i) => (
              <li
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  fontSize: 15.5,
                  lineHeight: 1.6,
                  color: '#1f2233',
                }}
              >
                <Bullet />
                <span>{renderInlineMarkdown(q)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {analysis.terminology?.length > 0 && (
        <Section title="Terminology">
          <TermList items={analysis.terminology} />
        </Section>
      )}
      {analysis.tldr && (
        <Section title="Summary">
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: '#3b3f55', margin: 0 }}>
            {renderInlineMarkdown(analysis.tldr)}
          </p>
        </Section>
      )}
    </div>
  );
}

function TranscriptTab({ analysis }: { analysis: CueSessionAnalysis }) {
  if (analysis.reportMarkdown) {
    return (
      <pre
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.7,
          color: '#3b3f55',
          fontFamily: "'JetBrains Mono', monospace",
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {analysis.reportMarkdown}
      </pre>
    );
  }
  return (
    <div style={{ color: '#7a8295', fontSize: 14, paddingTop: 12 }}>
      Transcript not captured for this session.
    </div>
  );
}

function UsageTab({ analysis }: { analysis: CueSessionAnalysis }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 14,
      }}
    >
      <UsageCard label="Started" value={formatDate(analysis.startedAt) || '—'} />
      <UsageCard label="Action items" value={String(analysis.actionItems?.length ?? 0)} />
      <UsageCard label="Decisions" value={String(analysis.decisions?.length ?? 0)} />
      <UsageCard label="Terminology" value={String(analysis.terminology?.length ?? 0)} />
    </div>
  );
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function Section({
  title,
  rightSlot,
  children,
}: {
  title: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <h2
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: '#0d0d0d',
            margin: 0,
            letterSpacing: '-0.01em',
          }}
        >
          {title}
        </h2>
        {rightSlot}
      </div>
      {children}
    </section>
  );
}

function CopyFullSummary({ analysis }: { analysis: CueSessionAnalysis }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(buildCueMarkdown(analysis));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={() => void onCopy()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 6,
        background: 'transparent',
        color: copied ? '#10b981' : '#5a6478',
        border: 'none',
        fontSize: 12.5,
        cursor: 'pointer',
        transition: 'color 120ms',
      }}
    >
      <CopyIcon />
      {copied ? 'Copied' : 'Copy full summary'}
    </button>
  );
}

function BulletList({ items }: { items: CueAnalysisItem[] }) {
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {items.map((item, i) => (
        <li
          key={i}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            fontSize: 15.5,
            lineHeight: 1.6,
            color: '#1f2233',
          }}
        >
          <Bullet />
          <span>
            {renderInlineMarkdown(item.title)}
            {item.detail && (
              <>
                {' '}
                <span style={{ color: '#3b3f55' }}>— {renderInlineMarkdown(item.detail)}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TermList({ items }: { items: CueAnalysisTerm[] }) {
  return (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {items.map((item, i) => (
        <li
          key={i}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            fontSize: 15.5,
            lineHeight: 1.6,
            color: '#1f2233',
          }}
        >
          <Bullet />
          <span>
            <strong style={{ fontWeight: 700, color: '#0d0d0d' }}>{item.term}</strong>
            {item.definition && (
              <span style={{ color: '#3b3f55' }}> — {renderInlineMarkdown(item.definition)}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Bullet() {
  return (
    <span
      style={{
        marginTop: 8,
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: '#0d0d0d',
        flexShrink: 0,
      }}
    />
  );
}

function UsageCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        background: 'rgba(20,30,80,0.04)',
        border: '1px solid rgba(20,30,80,0.06)',
      }}
    >
      <div style={{ fontSize: 11, color: '#7a8295', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#0d0d0d' }}>{value}</div>
    </div>
  );
}

function ShareItem({ label }: { label: string }) {
  return (
    <button
      style={{
        display: 'block',
        width: '100%',
        padding: '7px 10px',
        background: 'transparent',
        color: '#1f2233',
        fontSize: 13,
        textAlign: 'left',
        border: 'none',
        borderRadius: 5,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(20,30,80,0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Icons ──────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function TelegramIcon() {
  // Простой paper-plane silhouette — узнаваемо как TG glyph без ставки
  // на реальный лого (избегаем trademark вопросов).
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 4L3 11l7 3 3 7 8-17z" />
      <path d="M10 14l4-4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4l-3 3 3 3" />
      <path d="M4 7h16" />
      <path d="M17 20l3-3-3-3" />
      <path d="M20 17H4" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5l12 7-12 7V5z" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
