// CategorizeToast — Phase J / H3 (P1, 2026-05-12).
//
// Transient toast «Auto-tagged as <Kind>» surfaced when backend's
// categoriser pushes a card.categorise SSE event OR BulkAutoCategorise
// stream packet arrives. Shows:
//   • Kind chip (icon + label).
//   • «Why?» chevron — expands to LLM reasoning (1-2 sentences).
//   • «Set to…» button — opens KindPicker for manual override.
//   • Auto-dismiss after 5.5s (clearable via × button).
//
// Renders inside <CategorizeToastContainer />, mounted globally в App.tsx
// — single instance reads the toast store and stacks active toasts at
// bottom-right (above the FAB which sits at 28px from the corner).
//
// B/W rule: red dot used ONLY as priority indicator (manual override hint).
// Background — hairline border on var(--surface-2), no color fill.

import { useState, type CSSProperties, type JSX } from 'react';

import { updateTaskKind } from '../../api/tasks';
import {
  useToastStore,
  type CategorizeToastEntry,
  type InfoToastEntry,
  type ToastEntry,
} from '../../stores/toast';

import { KINDS, KindIcon } from './kinds';
import { KindPicker } from './KindPicker';

// CategorizeToastContainer — global mount point. Reads the toast store
// and renders a stacked column at the bottom-right corner.
export function CategorizeToastContainer(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 84, // above the 28px FAB + 44px FAB height + breathing room
        right: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 650,
        pointerEvents: 'none', // children opt-in для buttons
        maxWidth: 'min(360px, calc(100vw - 48px))',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} entry={t} />
      ))}
    </div>
  );
}

function ToastItem({ entry }: { entry: ToastEntry }): JSX.Element {
  if (entry.kind === 'info') {
    return <InfoToast entry={entry} />;
  }
  return <CategorizeToast entry={entry} />;
}

// InfoToast — simple confirmation surface. Replaces the inline toasts
// previously rendered inside TaskBoard.tsx.
function InfoToast({ entry }: { entry: InfoToastEntry }): JSX.Element {
  const dismiss = useToastStore((s) => s.dismissToast);
  return (
    <div
      style={{
        ...toastShellStyle,
        padding: '8px 14px',
        fontSize: 12,
        color: 'var(--ink-60)',
        animation: 'toastIn var(--motion-dur-medium) var(--motion-ease-emphasized)',
      }}
      onClick={() => dismiss(entry.id)}
    >
      {entry.message}
      <style>{toastKeyframes}</style>
    </div>
  );
}

// CategorizeToast — fuller toast with kind badge, reasoning, override.
function CategorizeToast({ entry }: { entry: CategorizeToastEntry }): JSX.Element {
  const dismiss = useToastStore((s) => s.dismissToast);
  const [expanded, setExpanded] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);
  const [overrideInFlight, setOverrideInFlight] = useState(false);
  const def = KINDS[entry.detectedKind];

  async function pickOverride(nextKind: typeof entry.detectedKind): Promise<void> {
    if (overrideInFlight) return;
    setOverrideInFlight(true);
    try {
      await updateTaskKind(entry.taskId, nextKind, true);
      // Close toast — user resolved it explicitly.
      dismiss(entry.id);
    } catch {
      // Network / 5xx — keep toast open so user can retry.
      setOverrideInFlight(false);
    }
  }

  return (
    <article
      role="status"
      style={{
        ...toastShellStyle,
        padding: '10px 12px 10px 14px',
        animation: 'toastIn var(--motion-dur-medium) var(--motion-ease-emphasized)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            borderRadius: 5,
            background: 'rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          <KindIcon kind={entry.detectedKind} size={14} color={def.color} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--ink-40)',
              marginBottom: 2,
            }}
          >
            Auto-tagged
          </div>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--ink)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={entry.taskTitle}
          >
            {def.label}
            <span style={{ fontWeight: 400, color: 'var(--ink-40)', marginLeft: 6 }}>
              · {truncate(entry.taskTitle, 28)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => dismiss(entry.id)}
          aria-label="Dismiss toast"
          style={{
            ...iconBtnStyle,
            color: 'var(--ink-40)',
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {entry.reasoning && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            style={chevronBtnStyle}
          >
            <span
              style={{
                display: 'inline-block',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform var(--motion-dur-small) var(--motion-ease-standard)',
                fontSize: 9,
                marginRight: 4,
              }}
            >
              {'▶'}
            </span>
            Why?
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPickerAnchor({ x: r.left, y: r.top });
          }}
          aria-label="Override task kind"
          disabled={overrideInFlight}
          style={{
            ...chevronBtnStyle,
            opacity: overrideInFlight ? 0.5 : 1,
            cursor: overrideInFlight ? 'wait' : 'pointer',
          }}
        >
          Set to…
        </button>
        {typeof entry.confidence === 'number' && entry.confidence > 0 && (
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 9,
              color: 'var(--ink-40)',
              marginLeft: 'auto',
            }}
            title={`LLM self-confidence: ${(entry.confidence * 100).toFixed(0)}%`}
          >
            {(entry.confidence * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {expanded && entry.reasoning && (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 11.5,
            lineHeight: 1.55,
            color: 'var(--ink-60)',
            paddingTop: 8,
            borderTop: '1px solid var(--ink-20)',
          }}
        >
          {entry.reasoning}
        </p>
      )}

      {pickerAnchor && (
        <KindPicker
          current={entry.detectedKind}
          anchor={pickerAnchor}
          onClose={() => setPickerAnchor(null)}
          onPick={(next) => {
            setPickerAnchor(null);
            void pickOverride(next);
          }}
        />
      )}
      <style>{toastKeyframes}</style>
    </article>
  );
}

// ── styles ───────────────────────────────────────────────────────────────

const toastShellStyle: CSSProperties = {
  pointerEvents: 'auto',
  background: 'var(--surface-2)',
  border: '1px solid var(--ink-20)',
  borderRadius: 8,
  boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
  minWidth: 240,
  cursor: 'default',
  display: 'flex',
  flexDirection: 'column',
};

const iconBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: '2px 6px',
  cursor: 'pointer',
  borderRadius: 4,
  flexShrink: 0,
  color: 'inherit',
  fontFamily: 'inherit',
};

const chevronBtnStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--ink-20)',
  color: 'var(--ink-60)',
  padding: '3px 9px',
  borderRadius: 5,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  transition:
    'background var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
};

const toastKeyframes = `
@keyframes toastIn {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)  scale(1); }
}
`;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
