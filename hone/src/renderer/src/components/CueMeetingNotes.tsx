// CueMeetingNotes — dark Hone-themed view карточки meeting/chat импорта
// из Cue desktop'а.
//
// Layout (после rewrite'а):
//   - Header: title + дата + action кнопки (Open in Cue / Share / Follow-up TG)
//   - Tabs: Summary | Transcript (Usage интегрирован в Summary как footer)
//   - Body: рендер через MarkdownView (heading/list/code-block работают)
//
// Что было раньше и почему выпилено:
//   - Light theme (white card на тёмном Hone) — резало глаз, не fit'ило
//     в Hone-палитру. Теперь чистый black с Hone-цветами.
//   - Search bar / Ask input / Resume Session — non-functional декорации.
//     Юзер думал что это рабочие фичи; убрал чтобы не путать.
//   - Persona dropdown — placeholder без backend'а; убран.
//   - Custom inline-md parser — заменён на MarkdownView (использует marked,
//     умеет heading/list/code-fence/inline-bold/etc).
import { useEffect, useRef, useState } from 'react';
import type { CueSessionAnalysis } from '@shared/ipc';

import { useT, translate } from '@d9-i18n';

import { MarkdownView } from './MarkdownView';
import { useSessionStore } from '../stores/session';

interface Props {
  analysis: CueSessionAnalysis;
  filePath: string;
  // sessionId — id из backend hone_cue_sessions. Если задан — кнопка
  // «Follow-up TG» зовёт sendCueSessionToTelegram(sessionId).
  sessionId?: string | null;
}

type Tab = 'transcript' | 'summary';

export function CueMeetingNotes({ analysis, filePath, sessionId }: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('transcript');
  const [shareOpen, setShareOpen] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const userId = useSessionStore((s) => s.userId);
  const shareRef = useRef<HTMLDivElement>(null);

  const showToast = (msg: string, ms = 2400) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
  };

  // Click-outside для Share dropdown'а.
  useEffect(() => {
    if (!shareOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [shareOpen]);

  const handleOpenInCue = () => {
    const url = filePath
      ? `druz9-cue://open?file=${encodeURIComponent(filePath)}`
      : 'https://druz9.online/copilot';
    void window.hone?.shell.openExternal(url).catch(() => {
      void window.hone?.shell.openExternal('https://druz9.online/copilot');
    });
  };

  const handleFollowupTG = async () => {
    if (!sessionId) {
      showToast(translate('hone.cue_meet.not_synced'));
      return;
    }
    if (tgBusy) return;
    setTgBusy(true);
    try {
      const { sendCueSessionToTelegram } = await import('../api/hone');
      const r = await sendCueSessionToTelegram(sessionId);
      showToast(r.ok
        ? translate('hone.cue_meet.sent_to_tg')
        : (r.message || translate('hone.cue_meet.tg_not_connected')));
    } catch (e) {
      showToast(translate('hone.cue_meet.err_prefix', { msg: (e as Error).message }));
    } finally {
      setTgBusy(false);
    }
  };

  const handleCopyMarkdown = async () => {
    setShareOpen(false);
    try {
      const md = analysis.reportMarkdown || buildCueMarkdown(analysis);
      await navigator.clipboard.writeText(md);
      showToast('Markdown copied to clipboard');
    } catch {
      showToast(translate('hone.cue_meet.copy_failed'));
    }
  };

  const handleCopyPublicLink = async () => {
    setShareOpen(false);
    // Cue sessions are private (sentry / personal meeting notes). Show
    // user-facing explanation rather than silent failure.
    showToast('Cue sessions are private — public links will arrive after encryption ships');
  };

  const dateStr = formatDate(analysis.startedAt);
  const userInitial = (userId || '?').slice(0, 1).toUpperCase();

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg)',
        color: 'var(--ink-90)',
      }}
    >
      {/* Header — title + date + actions */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          padding: '20px 32px 14px',
          borderBottom: '1px solid var(--hair)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--ink-40)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            {dateStr || 'Cue session'}
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              lineHeight: 1.25,
              color: 'var(--ink-90)',
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {analysis.title || 'Meeting notes'}
          </h1>
        </div>

        {/* Action buttons — Follow-up TG / Share / Open in Cue */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <ActionButton
            onClick={() => void handleFollowupTG()}
            disabled={tgBusy}
            title={sessionId ? t('hone.cue_meet.send_tg_title') : t('hone.cue_meet.not_synced')}
            icon={<TelegramIcon />}
            label={tgBusy ? t('hone.cue_meet.sending_tg') : 'Follow-up TG'}
            badge={sessionId ? true : false}
          />
          <div ref={shareRef} style={{ position: 'relative' }}>
            <ActionButton
              onClick={() => setShareOpen((v) => !v)}
              title={t('hone.cue_meet.share_title')}
              icon={<LinkIcon />}
              label="Share"
              chevron
            />
            {shareOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  zIndex: 20,
                  minWidth: 200,
                  padding: 4,
                  borderRadius: 8,
                  background: 'var(--surface)',
                  border: '1px solid var(--hair)',
                  boxShadow: '0 12px 28px -6px var(--bg)',
                }}
              >
                <ShareItem onClick={() => void handleCopyPublicLink()}>Public link</ShareItem>
                <ShareItem onClick={() => void handleCopyMarkdown()}>Copy markdown</ShareItem>
              </div>
            )}
          </div>
          <ActionButton
            onClick={handleOpenInCue}
            title={t('hone.cue_meet.open_in_cue_title')}
            icon={<ExternalIcon />}
            label="Open in Cue"
          />
          <div
            title={userId || ''}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: 'var(--surface-2)',
              border: '1px solid var(--hair)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ink-60)',
              marginLeft: 4,
              flexShrink: 0,
            }}
          >
            {userInitial}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '12px 32px 0',
        }}
      >
        {(['transcript', 'summary'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              position: 'relative',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              background: tab === t ? 'var(--surface-2)' : 'transparent',
              color: tab === t ? 'var(--ink-90)' : 'var(--ink-40)',
              border: '1px solid transparent',
              cursor: 'pointer',
              transition: 'background var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
            }}
            onMouseEnter={(e) => {
              if (tab !== t) e.currentTarget.style.color = 'var(--ink-60)';
            }}
            onMouseLeave={(e) => {
              if (tab !== t) e.currentTarget.style.color = 'var(--ink-40)';
            }}
          >
            {t === 'summary' ? 'Summary' : 'Transcript'}
            {tab === t && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 14,
                  right: 14,
                  bottom: 2,
                  height: 1.5,
                  background: 'var(--red)',
                  borderRadius: 1,
                }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 56px 56px' }}>
          {tab === 'transcript' ? (
            <TranscriptTab analysis={analysis} />
          ) : (
            <SummaryTab analysis={analysis} />
          )}
          <UsageFooter analysis={analysis} filePath={filePath} />
        </div>
      </div>

      {/* Toast — bottom-right floating. role=status + aria-live=polite so
          screen readers announce sync/share results without stealing focus. */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            position: 'absolute',
            bottom: 24,
            right: 24,
            background: 'var(--surface-2)',
            color: 'var(--ink-90)',
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            border: '1px solid var(--hair)',
            boxShadow: '0 12px 28px -6px var(--bg)',
            pointerEvents: 'none',
            zIndex: 50,
            maxWidth: 360,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

// SummaryTab — заглушка «in development» пока не подключим LLM-extraction
// (action items / decisions / terminology из body_md). Полный рендеринг
// был раньше; код сохранён в git history если понадобится восстановить
// после backend'а.
//
// _analysis оставлен в сигнатуре чтобы не ломать call site и сохранить
// контракт «Tab принимает analysis» — когда фича вернётся, не потребуется
// touch'ать ExpandedScreen.
function SummaryTab({ analysis: _analysis }: { analysis: CueSessionAnalysis }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '48px 24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--surface-2)',
          border: '1px solid var(--hair)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-60)',
        }}
      >
        <SparkleIcon />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-90)' }}>
        {translate('hone.cue_meet.summary.coming_soon_title')}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-60)', maxWidth: 380, lineHeight: 1.5 }}>
        {translate('hone.cue_meet.summary.coming_soon_body')}
      </div>
    </div>
  );
}

function TranscriptTab({ analysis }: { analysis: CueSessionAnalysis }) {
  if (!analysis.reportMarkdown) {
    return (
      <div style={{ color: 'var(--ink-40)', fontSize: 13 }}>
        {translate('hone.cue_meet.transcript.empty')}
      </div>
    );
  }
  return <MarkdownView source={analysis.reportMarkdown} />;
}

function UsageFooter({ analysis, filePath }: { analysis: CueSessionAnalysis; filePath: string }) {
  const fileName = filePath ? filePath.split('/').pop() ?? '' : '';
  const wordCount = analysis.reportMarkdown
    ? analysis.reportMarkdown.split(/\s+/).filter(Boolean).length
    : 0;
  const items = [
    ['Started', formatDate(analysis.startedAt) || '—'],
    ['File', fileName || '—'],
    ['Word count', wordCount > 0 ? String(wordCount) : '—'],
    ['Action items', String(analysis.actionItems?.length ?? 0)],
  ];
  return (
    <div
      style={{
        marginTop: 36,
        paddingTop: 16,
        borderTop: '1px solid var(--hair)',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 10,
      }}
    >
      {items.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 10, color: 'var(--ink-20)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {label}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--ink-60)', wordBreak: 'break-all' }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function ActionButton({
  onClick,
  disabled,
  title,
  icon,
  label,
  chevron,
  badge,
}: {
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  icon: React.ReactNode;
  label: string;
  chevron?: boolean;
  badge?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 6,
        border: `1px solid ${hover && !disabled ? 'var(--hair-2)' : 'var(--hair)'}`,
        background: hover && !disabled ? 'var(--surface-2)' : 'transparent',
        color: disabled ? 'var(--ink-20)' : 'var(--ink-60)',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
        fontFamily: 'inherit',
      }}
    >
      {icon}
      {label}
      {chevron && <span style={{ marginLeft: 2, opacity: 0.6, fontSize: 8 }}>▼</span>}
      {badge && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 6,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--ink-90)',
          }}
        />
      )}
    </button>
  );
}

function ShareItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '7px 10px',
        background: hover ? 'var(--surface-2)' : 'transparent',
        color: 'var(--ink-90)',
        fontSize: 13,
        textAlign: 'left',
        border: 'none',
        borderRadius: 5,
        cursor: 'pointer',
        transition: 'background var(--motion-dur-small) var(--motion-ease-standard)',
      }}
    >
      {children}
    </button>
  );
}

// CopyButton / Section / SectionTitle / BulletList / TermList / Bullet —
// удалены вместе с структурным Summary tab'ом. Восстановить из git
// history когда подключим LLM-extraction.

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
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
    lines.push('## Action items', '');
    a.actionItems.forEach((it) => lines.push(`- **${it.title}**${it.detail ? ` — ${it.detail}` : ''}`));
    lines.push('');
  }
  if (a.decisions?.length) {
    lines.push('## Decisions', '');
    a.decisions.forEach((it) => lines.push(`- **${it.title}**${it.detail ? ` — ${it.detail}` : ''}`));
    lines.push('');
  }
  if (a.openQuestions?.length) {
    lines.push('## Open questions', '');
    a.openQuestions.forEach((q) => lines.push(`- ${q}`));
    lines.push('');
  }
  if (a.terminology?.length) {
    lines.push('## Terminology', '');
    a.terminology.forEach((t) => lines.push(`- **${t.term}** — ${t.definition}`));
    lines.push('');
  }
  if (a.reportMarkdown) {
    lines.push('## Transcript', '', a.reportMarkdown);
  }
  return lines.join('\n');
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function TelegramIcon() {
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

function SparkleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2.4 5.6L20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4L12 3z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4h6v6" />
      <path d="M20 4l-8 8" />
      <path d="M16 14v6H4V8h6" />
    </svg>
  );
}
