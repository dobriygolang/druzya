// Plan — surface AI-generated daily plan (PlanItem[]). Each item shows
// kind glyph, title, estimated minutes and — importantly — rationale
// (LLM-generated reason "почему именно этот пункт для тебя сегодня"),
// previously only present in proto/PlanItem.rationale but never rendered.
//
// Actions per item:
//   start focus → pin item title, открыть focus session (через App.startFocus)
//   done        → completePlanItem RPC; item gets struck through
//   skip        → dismissPlanItem RPC; item faded, coach learns
//
// Empty / error / loading — все три варианта обработаны inline.
// Generate plan triggers GenerateDailyPlan (force=false, backend дедуп
// на одну попытку в сутки).

import { useCallback, useEffect, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';

import {
  getPlan,
  generatePlan,
  completePlanItem,
  dismissPlanItem,
  type Plan,
  type PlanItem,
} from '../api/hone';
import { type StartFocusArgs } from './Today';

interface PlanPageProps {
  onStartFocus: (args: StartFocusArgs) => void;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ok'; plan: Plan }
  | { status: 'empty' }
  | { status: 'error'; message: string };

const monoFont = "'JetBrains Mono', ui-monospace, monospace";
const sansFont = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif';

const captionMono: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-40)',
};

function formatDateHeader(d: Date): string {
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
}

function kindGlyph(kind: PlanItem['kind']): string {
  switch (kind) {
    case 'solve':
      return '◆';
    case 'mock':
      return '✦';
    case 'review':
      return '⟳';
    case 'read':
      return '▤';
    case 'custom':
    default:
      return '·';
  }
}

function kindLabel(kind: PlanItem['kind']): string {
  switch (kind) {
    case 'solve':
      return 'SOLVE';
    case 'mock':
      return 'MOCK';
    case 'review':
      return 'REVIEW';
    case 'read':
      return 'READ';
    case 'custom':
    default:
      return 'CUSTOM';
  }
}

export function PlanPage({ onStartFocus }: PlanPageProps) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [generating, setGenerating] = useState(false);

  const refetch = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const plan = await getPlan();
      if (plan.items.length === 0) {
        setState({ status: 'empty' });
      } else {
        setState({ status: 'ok', plan });
      }
    } catch (err) {
      const ce = ConnectError.from(err);
      if (ce.code === Code.NotFound) {
        setState({ status: 'empty' });
      } else {
        setState({ status: 'error', message: ce.rawMessage || ce.message });
      }
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const plan = await generatePlan(false);
      if (plan.items.length === 0) {
        setState({ status: 'empty' });
      } else {
        setState({ status: 'ok', plan });
      }
    } catch (err) {
      const ce = ConnectError.from(err);
      setState({ status: 'error', message: ce.rawMessage || ce.message });
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleRegenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const plan = await generatePlan(true);
      if (plan.items.length === 0) {
        setState({ status: 'empty' });
      } else {
        setState({ status: 'ok', plan });
      }
    } catch (err) {
      const ce = ConnectError.from(err);
      setState({ status: 'error', message: ce.rawMessage || ce.message });
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleComplete = useCallback(
    async (item: PlanItem) => {
      // Optimistic — mark completed in UI immediately
      setState((s) =>
        s.status === 'ok'
          ? {
              status: 'ok',
              plan: {
                ...s.plan,
                items: s.plan.items.map((it) => (it.id === item.id ? { ...it, completed: true } : it)),
              },
            }
          : s,
      );
      try {
        const plan = await completePlanItem(item.id);
        setState({ status: 'ok', plan });
      } catch {
        void refetch();
      }
    },
    [refetch],
  );

  const handleDismiss = useCallback(
    async (item: PlanItem) => {
      setState((s) =>
        s.status === 'ok'
          ? {
              status: 'ok',
              plan: {
                ...s.plan,
                items: s.plan.items.map((it) => (it.id === item.id ? { ...it, dismissed: true } : it)),
              },
            }
          : s,
      );
      try {
        const plan = await dismissPlanItem(item.id);
        setState({ status: 'ok', plan });
      } catch {
        void refetch();
      }
    },
    [refetch],
  );

  const header = formatDateHeader(new Date());

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: '64px 32px 120px',
        boxSizing: 'border-box',
        fontFamily: sansFont,
        color: 'var(--ink-90)',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ ...captionMono, marginBottom: 6 }}>{`PLAN · ${header}`}</div>
        <h1
          style={{
            margin: 0,
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
          }}
        >
          Today
        </h1>

        <div style={{ marginTop: 32 }}>
          {state.status === 'loading' && <LoadingSkeleton />}
          {state.status === 'error' && <ErrorBlock message={state.message} onRetry={refetch} />}
          {state.status === 'empty' && (
            <EmptyBlock generating={generating} onGenerate={handleGenerate} />
          )}
          {state.status === 'ok' && (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {state.plan.items.map((item) => (
                  <PlanItemCard
                    key={item.id}
                    item={item}
                    onStartFocus={onStartFocus}
                    onComplete={handleComplete}
                    onDismiss={handleDismiss}
                  />
                ))}
              </ul>
              <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => void handleRegenerate()}
                  disabled={generating}
                  className="focus-ring motion-press"
                  style={{
                    ...captionMono,
                    color: generating ? 'var(--ink-40)' : 'var(--ink-60)',
                    padding: '6px 14px',
                    border: '1px solid var(--hair-2)',
                    borderRadius: 999,
                    background: 'transparent',
                    cursor: generating ? 'not-allowed' : 'pointer',
                    transition:
                      'color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
                  }}
                >
                  {generating ? 'REGENERATING…' : 'REGENERATE PLAN'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface PlanItemCardProps {
  item: PlanItem;
  onStartFocus: (args: StartFocusArgs) => void;
  onComplete: (item: PlanItem) => void;
  onDismiss: (item: PlanItem) => void;
}

function PlanItemCard({ item, onStartFocus, onComplete, onDismiss }: PlanItemCardProps) {
  const dimmed = item.dismissed;
  const done = item.completed;
  return (
    <li
      style={{
        position: 'relative',
        padding: '16px 18px',
        border: '1px solid var(--hair)',
        borderRadius: 12,
        background: 'var(--surface)',
        opacity: dimmed ? 0.4 : 1,
        transition: 'opacity var(--motion-dur-medium) var(--motion-ease-standard)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <span
          aria-hidden="true"
          style={{
            fontFamily: monoFont,
            fontSize: 18,
            color: 'var(--ink-60)',
            minWidth: 20,
            textAlign: 'center',
            lineHeight: 1.1,
          }}
        >
          {kindGlyph(item.kind)}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontSize: 15,
                fontWeight: 500,
                color: 'var(--ink-90)',
                textDecoration: done ? 'line-through' : 'none',
                opacity: done ? 0.55 : 1,
              }}
            >
              {item.title || '—'}
            </span>
            <span style={{ ...captionMono, fontSize: 9 }}>{kindLabel(item.kind)}</span>
            {item.estimatedMin > 0 && (
              <span style={{ ...captionMono, fontSize: 9 }}>{item.estimatedMin} MIN</span>
            )}
          </div>

          {item.subtitle && (
            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                color: 'var(--ink-60)',
                lineHeight: 1.45,
              }}
            >
              {item.subtitle}
            </div>
          )}

          {item.rationale && (
            <div
              style={{
                marginTop: 8,
                paddingLeft: 10,
                borderLeft: '1.5px solid var(--hair-2)',
                fontSize: 12.5,
                color: 'var(--ink-60)',
                lineHeight: 1.55,
                fontStyle: 'normal',
              }}
            >
              <span style={{ ...captionMono, fontSize: 9, display: 'block', marginBottom: 2 }}>
                WHY
              </span>
              {item.rationale}
            </div>
          )}

          {!done && !dimmed && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => onStartFocus({ planItemId: item.id, pinnedTitle: item.title })}
                className="focus-ring motion-press"
                style={btnPrimaryStyle}
              >
                START FOCUS
              </button>
              <button
                type="button"
                onClick={() => onComplete(item)}
                className="focus-ring motion-press"
                style={btnGhostStyle}
                title="Mark this item as done — coach learns"
              >
                DONE
              </button>
              <button
                type="button"
                onClick={() => onDismiss(item)}
                className="focus-ring motion-press"
                style={btnGhostStyle}
                title="Skip this item — coach learns"
              >
                SKIP
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

const btnPrimaryStyle: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '7px 14px',
  border: '1px solid var(--ink)',
  borderRadius: 999,
  background: 'var(--ink)',
  color: 'var(--bg)',
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), transform var(--motion-dur-small) var(--motion-ease-standard)',
};

const btnGhostStyle: React.CSSProperties = {
  fontFamily: monoFont,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '7px 12px',
  border: '1px solid var(--hair-2)',
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--ink-60)',
  cursor: 'pointer',
  transition:
    'color var(--motion-dur-small) var(--motion-ease-standard), background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
};

function LoadingSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 96,
            border: '1px solid var(--hair)',
            borderRadius: 12,
            background: 'var(--surface)',
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  );
}

interface ErrorBlockProps {
  message: string;
  onRetry: () => void;
}

function ErrorBlock({ message, onRetry }: ErrorBlockProps) {
  return (
    <div
      style={{
        padding: 18,
        border: '1px solid var(--hair)',
        borderRadius: 12,
        background: 'var(--surface)',
      }}
    >
      <div style={{ ...captionMono, marginBottom: 6 }}>COACH OFFLINE</div>
      <div style={{ fontSize: 13, color: 'var(--ink-60)', lineHeight: 1.5, marginBottom: 12 }}>
        {message || 'Plan not available right now.'}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring motion-press"
        style={btnGhostStyle}
      >
        RETRY
      </button>
    </div>
  );
}

interface EmptyBlockProps {
  generating: boolean;
  onGenerate: () => void;
}

function EmptyBlock({ generating, onGenerate }: EmptyBlockProps) {
  return (
    <div
      style={{
        padding: 24,
        border: '1px dashed var(--hair-2)',
        borderRadius: 12,
        background: 'transparent',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--ink-60)', lineHeight: 1.55, marginBottom: 14 }}>
        No plan for today yet. Coach will pick 3-5 actionable items from your tracks and recent state.
      </div>
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating}
        className="focus-ring motion-press"
        style={{
          ...btnPrimaryStyle,
          opacity: generating ? 0.6 : 1,
          cursor: generating ? 'not-allowed' : 'pointer',
        }}
      >
        {generating ? 'GENERATING…' : 'GENERATE PLAN'}
      </button>
    </div>
  );
}
