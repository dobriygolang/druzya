// AutoSuggestPill — floating suggestion strip above the input row.

import { useT } from '@d9-i18n';
import { useCoachStore } from '../../../stores/coach';

/**
 * AutoSuggestPill — floating suggestion strip above the input row.
 * Shows the most recent /copilot/suggestion result, the question
 * that triggered it, and an action to splice into the draft.
 * Dismissable; auto-replaced on the next trigger.
 *
 * Accent glow differentiates it from the transcript strip so the
 * user instantly reads "this is AI" vs "this is raw transcript".
 */
export function AutoSuggestPill({
  draft,
  setDraft,
}: {
  draft: string;
  setDraft: (s: string) => void;
}) {
  const t = useT();
  const suggestion = useCoachStore((s) => s.suggestion);
  const thinking = useCoachStore((s) => s.thinking);
  const enabled = useCoachStore((s) => s.enabled);
  const error = useCoachStore((s) => s.error);
  const dismiss = useCoachStore((s) => s.dismiss);

  // Render only when there's something to say. Toggle off + no
  // active suggestion + no error = stay invisible.
  if (!suggestion && !thinking && !error) return null;
  if (!enabled && !suggestion) return null;

  const insert = () => {
    if (!suggestion) return;
    const joiner = draft.length === 0 || /\s$/.test(draft) ? '' : '\n';
    setDraft(draft + joiner + suggestion.text);
    dismiss();
    // Phase J / X3 — cue_suggestion_acted_upon. The user accepted the
    // suggestion (spliced into draft). `text` length is signal; the
    // raw content is never logged (PII guard would strip anyway).
    void import('../../../lib/analytics').then(({ analytics, ANALYTICS_EVENTS }) => {
      analytics.track(ANALYTICS_EVENTS.cue_suggestion_acted_upon, {
        action: 'insert',
        context_used: suggestion.contextUsed,
      });
    });
  };

  return (
    <div
      style={{
        padding: '6px 12px 0',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: 'var(--pad-inline) 12px',
          borderRadius: 'var(--radius-outer)',
          background: error
            ? 'rgba(255, 59, 48, 0.1)'
            : 'linear-gradient(135deg, rgba(255, 59, 48, 0.1), rgba(255, 107, 96, 0.08))',
          border: `0.5px solid ${error ? 'rgba(255, 59, 48, 0.35)' : 'rgba(255, 59, 48, 0.3)'}`,
          boxShadow: error ? 'none' : '0 0 14px -4px var(--d9-accent-glow)',
        }}
      >
        <span
          aria-hidden
          style={{
            flex: 'none',
            fontSize: 13,
            lineHeight: '1.5em',
          }}
        >
          {error ? '⚠️' : thinking ? '💭' : '💡'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {error ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--d9-accent)',
                letterSpacing: '-0.005em',
              }}
            >
              {error}
            </div>
          ) : thinking && !suggestion ? (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--d9-accent-hi)',
                letterSpacing: '-0.005em',
                fontStyle: 'italic',
              }}
            >
              {t('cue.expanded.suggest.placeholder_thinking')}
            </div>
          ) : suggestion ? (
            <>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--d9-ink-ghost)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontFamily: 'var(--d9-font-mono)',
                  marginBottom: 3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('cue.expanded.suggest.q_prefix', { question: suggestion.question })}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: 'var(--d9-ink)',
                  lineHeight: 1.45,
                  letterSpacing: '-0.005em',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {suggestion.text}
              </div>
              {/*
                C3 personalization hint (Phase J 2026-05-12). Surfaced
                only when backend injected the user's goal / Coach
                memory / activity / skill radar into the LLM prompt.
                This is the unique moat vs Cluely — a quiet brag, not
                a banner. text-secondary so it doesn't fight the
                suggestion text for attention.
              */}
              {suggestion.contextUsed && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 9.5,
                    color: 'var(--d9-ink-ghost)',
                    letterSpacing: '0.02em',
                    fontStyle: 'italic',
                  }}
                  title="Backend injected your active goal + recent Coach memory + activity log into the prompt"
                >
                  Personalized from your druz9 activity
                </div>
              )}
            </>
          ) : null}
        </div>
        {suggestion && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-row)', flex: 'none' }}>
            <button
              type="button"
              onClick={insert}
              title={t('cue.expanded.suggest.insert_title')}
              style={{
                padding: '3px 8px',
                fontSize: 10.5,
                fontFamily: 'inherit',
                background: 'var(--d9-accent)',
                color: 'white',
                border: 0,
                borderRadius: 5,
                cursor: 'pointer',
                letterSpacing: '-0.005em',
              }}
            >
              {t('cue.expanded.suggest.cta_insert')}
            </button>
            <button
              type="button"
              onClick={dismiss}
              title={t('cue.expanded.suggest.dismiss_title')}
              style={{
                padding: '3px 8px',
                fontSize: 10.5,
                fontFamily: 'inherit',
                background: 'transparent',
                color: 'var(--d9-ink-ghost)',
                border: '0.5px solid var(--d9-hairline)',
                borderRadius: 5,
                cursor: 'pointer',
                letterSpacing: '-0.005em',
              }}
            >
              {t('cue.expanded.suggest.cta_dismiss')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
