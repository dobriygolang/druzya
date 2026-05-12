// ResourceCard — Phase 5 5c per-resource card with hover overrides.
//
// Renders one Resource (curated или user-added) с hover-menu:
//   hide for me · mark unhelpful · replace with own
//
// Used in step UI / atlas-node detail. Caller передаёт target — UI
// автоматически вызывает curation API без знания о user/auth context'е.
import { useState } from 'react';

import {
  hideResource,
  markUnhelpful,
  type Resource,
  type Target,
} from '../api/curation';
import { enqueue as enqueueOutbox } from '../offline/outbox';

interface Props {
  resource: Resource;
  target: Target;
  onHidden?: () => void;
  onUnhelpful?: () => void;
  onReplace?: () => void;
  // userAdded — рендерит «yours» chip; убирает hide-action (юзер сам
  // добавил, может delete не override).
  userAdded?: boolean;
}

export function ResourceCard({
  resource,
  target,
  onHidden,
  onUnhelpful,
  onReplace,
  userAdded = false,
}: Props) {
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmUnhelpful, setConfirmUnhelpful] = useState(false);
  const [reason, setReason] = useState('');

  async function doHide() {
    setBusy(true);
    try {
      // Optimistic: hide UI сразу, sync back через outbox при offline.
      // Online path всё ещё direct RPC чтобы UI получал error на
      // permission/quota issues immediately.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueOutbox('resource.hide', { target, url: resource.url });
      } else {
        await hideResource(target, resource.url);
      }
      onHidden?.();
    } catch {
      // Network blip mid-online → fall through to outbox.
      await enqueueOutbox('resource.hide', { target, url: resource.url });
      onHidden?.();
    } finally {
      setBusy(false);
    }
  }

  async function doUnhelpful() {
    setBusy(true);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueOutbox('resource.unhelpful', { target, url: resource.url, reason });
      } else {
        await markUnhelpful(target, resource.url, reason);
      }
      setConfirmUnhelpful(false);
      onUnhelpful?.();
    } catch {
      await enqueueOutbox('resource.unhelpful', { target, url: resource.url, reason });
      setConfirmUnhelpful(false);
      onUnhelpful?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        padding: '12px 14px',
        marginBottom: 8,
        background: 'var(--surface-2)',
        border: '1px solid var(--hair)',
        borderRadius: 6,
        transition: 'border-color var(--motion-dur-small) var(--motion-ease-standard)',
        ...(hover ? { borderColor: 'var(--hair-2)' } : null),
        overflow: 'hidden',
      }}
    >
      {userAdded && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 1.5,
            background: 'var(--red)',
          }}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 13.5,
            color: 'var(--ink-90)',
            textDecoration: 'none',
            borderBottom: '1px dashed var(--hair-2)',
            paddingBottom: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
        >
          {resource.title || resource.url}
        </a>
        {userAdded && (
          <span
            className="mono"
            style={{
              fontSize: 9,
              color: 'var(--ink-60)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '1px 6px',
              borderRadius: 999,
              border: '1px solid var(--hair-2)',
              flexShrink: 0,
            }}
          >
            yours
          </span>
        )}
      </div>

      {resource.why && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-60)', lineHeight: 1.5 }}>
          {resource.why}
        </div>
      )}

      <div className="mono" style={{ marginTop: 6, fontSize: 10, color: 'var(--ink-40)', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', gap: 8 }}>
        {resource.kind && <span>{resource.kind}</span>}
        {resource.minutes > 0 && <span>· ~{resource.minutes}m</span>}
        {resource.level && <span>· {resource.level}</span>}
        {resource.depth && <span>· {resource.depth}</span>}
      </div>

      {hover && !confirmUnhelpful && (
        <div
          className="mono"
          style={{
            display: 'flex',
            gap: 4,
            marginTop: 8,
            flexWrap: 'wrap',
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {!userAdded && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void doHide()}
              style={hoverActionStyle()}
            >
              hide
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmUnhelpful(true)}
            style={hoverActionStyle()}
          >
            unhelpful
          </button>
          {!userAdded && onReplace && (
            <button
              type="button"
              disabled={busy}
              onClick={onReplace}
              style={hoverActionStyle()}
            >
              replace →
            </button>
          )}
        </div>
      )}

      {confirmUnhelpful && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={reason}
            placeholder="why? (optional)"
            onChange={(e) => setReason(e.target.value)}
            style={{
              flex: 1,
              padding: '5px 8px',
              fontSize: 11,
              background: 'var(--surface)',
              border: '1px solid var(--hair-2)',
              borderRadius: 4,
              color: 'var(--ink-90)',
              outline: 'none',
            }}
          />
          <button type="button" disabled={busy} onClick={() => void doUnhelpful()} style={hoverActionStyle('var(--ink)', 'var(--bg)')}>
            ok
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmUnhelpful(false)} style={hoverActionStyle()}>
            x
          </button>
        </div>
      )}
    </div>
  );
}

function hoverActionStyle(bg = 'var(--hair)', color = 'var(--ink-60)'): React.CSSProperties {
  return {
    padding: '3px 7px',
    background: bg,
    border: '1px solid var(--hair-2)',
    color,
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 9,
    fontFamily: 'inherit',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    transition:
      'background-color var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
  };
}
