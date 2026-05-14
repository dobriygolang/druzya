// Small status indicators used in the expanded scroll body:
//   - ThinkingIndicator: animated dot while assistant streams
//   - CompactionGhostNotice: temporary in-chat banner after backend
//     ran sliding-window compaction
//   - ContextMeter: footer mini-meter (used / threshold)

import { useT } from '@d9-i18n';
import { StatusDot } from '../../../components/d9';

export function ThinkingIndicator() {
  const t = useT();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--pad-inline)',
        color: 'var(--d9-ink-mute)',
        fontSize: 12,
        marginBottom: 16,
      }}
    >
      <StatusDot state="thinking" size={6} />
      <span style={{ letterSpacing: '-0.005em' }}>{t('cue.expanded.thinking_label')}</span>
    </div>
  );
}

/**
 * ContextMeter — мини-индикатор использования context window в footer'е.
 * Показывает progress bar `messagesTotal / compactionThreshold`. После
 * порога ставит иконку «сжимается» и подсвечивает оранжевым. Tooltip
 * раскрывает детали (turns в окне, длина summary).
 *
 * Backend (sliding-window компакция в shared/pkg/compaction): после
 * `threshold` turns старые сообщения сжимаются в RunningSummary, в LLM
 * шлются только последние `WindowSize` (default 10). Юзер видел
 * деградацию точности после ~15 turns без объяснения — теперь видит
 * прогресс и ghost-message при триггере компакции.
 */
export function ContextMeter({ ctx }: { ctx: { messagesInWindow: number; messagesTotal: number; compactionThreshold: number; runningSummaryChars: number } }) {
  const t = useT();
  const total = Math.max(0, ctx.messagesTotal);
  const threshold = Math.max(1, ctx.compactionThreshold);
  const pct = Math.min(100, Math.round((total / threshold) * 100));
  const overThreshold = total >= threshold;
  const color = overThreshold
    ? 'var(--d9-accent)' // amber
    : pct >= 80
      ? 'var(--d9-accent-hi)'
      : 'var(--d9-ink-ghost)';
  const tooltip = [
    t('cue.expanded.context.title_prefix', { total }),
    t('cue.expanded.context.in_llm', { count: ctx.messagesInWindow }),
    t('cue.expanded.context.threshold', { threshold }),
    ctx.runningSummaryChars > 0
      ? t('cue.expanded.context.summary_chars', { chars: ctx.runningSummaryChars })
      : t('cue.expanded.context.summary_empty'),
  ].join('\n');
  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'help',
      }}
    >
      <span style={{ color, letterSpacing: '0.04em' }}>CTX</span>
      <span
        aria-hidden
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
          display: 'inline-block',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${pct}%`,
            height: '100%',
            background: color,
            transition: 'width var(--motion-dur-medium) var(--motion-ease-decelerate)',
          }}
        />
      </span>
      <span style={{ color, fontFamily: 'var(--d9-font-mono)' }}>
        {total}/{threshold}
      </span>
    </span>
  );
}

/**
 * CompactionGhostNotice — лёгкое сообщение в чате о том что backend
 * только что сжал старые turns в summary. Появляется на ~10 секунд после
 * Done event с compaction_triggered=true, потом исчезает (рендеринг
 * gated через `Date.now() - compactionNoticeAt < 10_000`).
 */
export function CompactionGhostNotice() {
  const t = useT();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--pad-inline)',
        marginBottom: 16,
        padding: '6px 10px',
        background: 'transparent',
        border: '0.5px solid rgba(255, 59, 48, 0.4)',
        borderRadius: 8,
        color: 'var(--d9-ink-mute)',
        fontSize: 11,
        letterSpacing: '-0.005em',
        fontStyle: 'italic',
      }}
    >
      <span aria-hidden>📜</span>
      <span>
        {t('cue.expanded.compaction_notice')}
      </span>
    </div>
  );
}

/**
 * SessionEndingBanner — surfaces the "Analyzing…" interim state between
 * the user calling sessions.end() and the backend pushing the final
 * analysis event. Without this banner the UI jumps straight from active
 * → idle and the user thinks nothing is happening (analysis can take 5-30s
 * on a long meeting).
 */
import { useSessionStore } from '../../../stores/session';

export function SessionEndingBanner(): JSX.Element | null {
  const ending = useSessionStore((s) => s.ending);
  if (!ending) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--pad-inline)',
        padding: 'var(--pad-inline) 12px',
        margin: '0 12px 8px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        fontSize: 11,
        letterSpacing: '0.06em',
        color: 'var(--d9-ink-mute)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          border: '1.5px solid rgba(255,255,255,0.35)',
          borderTopColor: 'var(--d9-ink, #fff)',
          animation: 'spin 0.9s linear infinite',
          display: 'inline-block',
        }}
      />
      <span>Analyzing…</span>
    </div>
  );
}
