// Small chips/badges that live in the expanded header alongside
// VoiceToggleCombined: InterviewPrepChip, AttachedDocsBadge plus the
// "⋯" actions overflow menu and its tiny icon glyphs.

import { useEffect, useRef, useState } from 'react';

import { IconButton } from '../../../components/d9';
import { useInterviewPrepStore } from '../../../stores/interview-prep';
import { useSessionStore } from '../../../stores/session';
import type { UIMessage } from '../../../stores/conversation';
import { truncate } from '../lib/markdown';

/**
 * AttachedDocsBadge — compact pill in the expanded header that tells the
 * user how many documents feed the current turn's RAG context. Hidden
 * when there's no live session OR when the user hasn't attached
 * anything. Clicking opens the Settings → Documents tab where the user
 * can toggle attachments.
 *
 * This is informational-only here; full management (attach/detach,
 * upload) lives in Settings where there's room for a drop-zone and
 * list. Keeping the badge simple avoids a second picker-panel to own.
 */
export function InterviewPrepChip() {
  // C6 (Phase J) — Interview-prep entry point. Two visual states:
  //   1. No active prep → "Prep" pill in muted hairline, click opens
  //      the wizard.
  //   2. Active prep    → "Prep · {role}" pill in bright ink, click
  //      still opens the wizard so the user can swap CV/JD or end.
  // Bootstrap the active prep on mount so the chip reflects reality
  // even after the wizard ran in a separate renderer process.
  const active = useInterviewPrepStore((s) => s.active);
  const bootstrap = useInterviewPrepStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const label = active.active
    ? active.role || active.company || 'Prep'
    : 'Prep';
  const title = active.active
    ? `Active prep · ${[active.company, active.role].filter(Boolean).join(' · ') || 'CV+JD загружены'}. Клик: открыть мастер.`
    : 'Подготовка к интервью — загрузи CV+JD до встречи';
  return (
    <button
      type="button"
      onClick={() => void window.druz9.interviewPrep.open()}
      title={title}
      style={{
        padding: '4px 10px',
        marginRight: 4,
        borderRadius: 7,
        background: active.active ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
        border: '0.5px solid var(--d9-hairline-b)',
        color: active.active ? 'var(--d9-ink)' : 'var(--d9-ink-mute)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        letterSpacing: '-0.005em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {active.active ? 'Prep · ' : 'Prep'}{active.active ? truncate(label, 14) : ''}
    </button>
  );
}

export function AttachedDocsBadge() {
  const current = useSessionStore((s) => s.current);
  const attached = useSessionStore((s) => s.attachedDocIds);
  if (!current || current.finishedAt || attached.length === 0) return null;
  const plural = attached.length === 1 ? 'документ' : attached.length < 5 ? 'документа' : 'документов';
  return (
    <button
      type="button"
      onClick={() => void window.druz9.windows.show('settings')}
      title={`Copilot учитывает ${attached.length} ${plural} в контексте. Открыть Настройки → Документы.`}
      style={{
        padding: '4px 10px',
        marginRight: 4,
        borderRadius: 7,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '0.5px solid var(--d9-hairline-b)',
        color: 'var(--d9-ok)',
        fontSize: 11.5,
        fontFamily: 'inherit',
        letterSpacing: '-0.005em',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      📎 {attached.length} {plural}
    </button>
  );
}

// ─── Chat-specific helpers ────────────────────────────────────────────────

// ChatHeadPill удалён: после consolidation persona+model в один combined
// pill (см. header), отдельный pill helper больше не нужен. Inline styles
// в новом combined chip покрывают тот же visual idiom.

/** Tiny kbd chip for the chat footer shortcut hints. */
export function ChatKbd({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      border: '1px solid var(--d9-hairline-b)',
      background: 'rgba(255,255,255,0.03)',
      padding: '2px 6px',
      borderRadius: 4,
      fontFamily: 'var(--d9-font-mono)',
      fontSize: 10,
      color: 'var(--d9-ink)',
      margin: '0 1px',
    }}>
      {children}
    </span>
  );
}

// CheckmarkIcon / ErrorIcon — visual feedback для save-button после
// клика. Зелёный ✓ → ok, красный ✕ → fail. Auto-revert через 2.4s.
/**
 * ChatActionsOverflow — «⋯» dropdown с secondary actions: Summary
 * (если ready), Save-to-Hone, Export Markdown. До рефактора эти кнопки
 * стояли отдельно в header'е → 13 видимых элементов; теперь header
 * compact (8-9 элементов), редкие actions — за один клик в menu.
 *
 * Click outside closes (ref-attached useEffect). Esc — closes тоже.
 */
export function ChatActionsOverflow({
  messages,
  saveChatStatus,
  setSaveChatStatus,
  hasSummary,
  onOpenSummary,
}: {
  messages: UIMessage[];
  saveChatStatus: 'idle' | 'saving' | 'ok' | 'err';
  setSaveChatStatus: (s: 'idle' | 'saving' | 'ok' | 'err') => void;
  hasSummary: boolean;
  onOpenSummary: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Если нет ни одного применимого action'а — кнопку не показываем
  // (избегаем «пустого» menu с placeholder'ом).
  const hasMessages = messages.length > 0;
  if (!hasMessages && !hasSummary) return null;

  const cleanMessages = messages
    .filter((m) => !m.pending && m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));

  const onSaveToHone = () => {
    setOpen(false);
    void (async () => {
      setSaveChatStatus('saving');
      try {
        await window.druz9.notes.saveChatToHone({ title: '', messages: cleanMessages });
        setSaveChatStatus('ok');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('saveChatToHone failed', err);
        setSaveChatStatus('err');
      }
      window.setTimeout(() => setSaveChatStatus('idle'), 2400);
    })();
  };
  const onExport = () => {
    setOpen(false);
    void (async () => {
      try {
        await window.druz9.notes.exportChatMarkdown({ title: '', messages: cleanMessages });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('exportChatMarkdown failed', err);
      }
    })();
  };

  // Trigger icon: если save-to-Hone сейчас в результирующем state'е
  // (ok/err) — вместо обычной «⋯» показываем cheсkmark/error,
  // чтобы юзер видел feedback от своего предыдущего действия.
  const triggerIcon =
    saveChatStatus === 'ok' ? <CheckmarkIcon />
      : saveChatStatus === 'err' ? <ErrorIcon />
        : <DotsIcon />;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <IconButton
        title="Дополнительные действия"
        onClick={() => setOpen((s) => !s)}
        ariaHaspopup="menu"
        ariaExpanded={open}
      >
        {triggerIcon}
      </IconButton>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            minWidth: 200,
            background: 'rgba(20, 20, 20, 0.96)',
            border: '0.5px solid var(--d9-hairline-b)',
            borderRadius: 8,
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 24px -4px rgba(0,0,0,0.5)',
            padding: 4,
            zIndex: 1000,
          }}
        >
          {hasSummary && (
            <OverflowItem
              label="Открыть Summary"
              onClick={() => {
                setOpen(false);
                onOpenSummary();
              }}
            />
          )}
          {hasMessages && <OverflowItem label="Сохранить в Hone" onClick={onSaveToHone} />}
          {hasMessages && <OverflowItem label="Экспорт в Markdown" onClick={onExport} />}
        </div>
      )}
    </div>
  );
}

function OverflowItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        padding: '7px 10px',
        background: 'transparent',
        border: 0,
        color: 'var(--d9-ink)',
        fontSize: 12,
        fontFamily: 'var(--d9-font-sans)',
        textAlign: 'left',
        cursor: 'pointer',
        borderRadius: 4,
        letterSpacing: '-0.005em',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  );
}

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function CheckmarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// SaveToHoneIcon / DownloadIcon удалены: после consolidation в
// ChatActionsOverflow («⋯» menu) обе actions имеют только text labels,
// отдельные glyph'ы перестали использоваться.
