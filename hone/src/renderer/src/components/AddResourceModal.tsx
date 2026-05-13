// AddResourceModal — Phase 5 5b add-resource flow.
//
// 2-step flow внутри одного modal:
//   step 1: URL paste → previewResource → preview shape
//   step 2: user edit fields (title/topics/summary/depth/minutes/why) →
//           addResource RPC.
//
// Если fetcher fail или LLM fail — preview.manual=true, UI показывает
// empty fields. Юзер заполняет руками.
//
// Designed для embed в step UI / atlas-node detail.
import { useEffect, useRef, useState } from 'react';

import {
  addResource,
  blankResource,
  previewResource,
  type Resource,
  type Target,
} from '../api/curation';
import { enqueue as enqueueOutbox } from '../offline/outbox';
import { Modal } from './primitives/Modal';
import { motion as motionTokens } from '../lib/design-tokens';

interface Props {
  target: Target;
  // allowedAtlasNodeIds — defense vs hallucinated topic ids. UI passes
  // currently-known atlas-node ids; backend filtering ещё дополнительно.
  allowedAtlasNodeIds: string[];
  // originalUrl — non-empty при «replace» flow (parent открыл modal через
  // ReplaceResource action). UI отметит этим header'ом.
  originalUrl?: string;
  onClose: () => void;
  onAdded: (resource: Resource) => void;
}

export function AddResourceModal({
  target,
  allowedAtlasNodeIds,
  originalUrl,
  onClose,
  onAdded,
}: Props) {
  const [open, setOpen] = useState(true);
  const [url, setUrl] = useState('');
  const [resource, setResource] = useState<Resource>(blankResource(''));
  const [phase, setPhase] = useState<'url' | 'preview' | 'submit'>('url');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [fetchInfo, setFetchInfo] = useState<{ strategy: string; error: string } | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  // Smooth exit: flip open → Modal exit anim → parent unmounts after dur.medium.
  function close() {
    setOpen(false);
    window.setTimeout(onClose, motionTokens.dur.medium);
  }

  // Cmd+Enter shortcut — Modal handles ESC; we only need the submit shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'url') void doPreview();
        else void doAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function doPaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // permission denied — silently no-op
    }
  }

  async function doPreview() {
    if (!url.trim()) {
      setError('paste a url first');
      return;
    }
    setBusy(true);
    setError(null);
    // Offline → skip fetch, jump прямо к manual fields. URL fetch defer'ится
    // на reconnect (можно через resource.add executor + serverside re-fetch),
    // но Sergey decision: лучше manual now чем blocked.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const prev = blankResource(url.trim());
      setResource(prev);
      setManual(true);
      setFetchInfo({ strategy: 'offline', error: 'offline · fill manually' });
      setPhase('preview');
      setBusy(false);
      return;
    }
    try {
      const res = await previewResource(url.trim(), allowedAtlasNodeIds);
      const prev: Resource = {
        ...res.preview,
        url: url.trim(),
      };
      setResource(prev);
      setManual(res.manual);
      setFetchInfo({ strategy: res.fetchStrategy, error: res.fetchError });
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doAdd() {
    if (!resource.title.trim()) {
      setError('title required');
      return;
    }
    const finalRes: Resource = {
      ...resource,
      why: resource.why.trim() || 'user-curated',
    };
    setBusy(true);
    setError(null);
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueOutbox('resource.add', { target, resource: finalRes });
        onAdded(finalRes);
        return;
      }
      await addResource(target, finalRes);
      onAdded(finalRes);
    } catch (e) {
      // Online attempt failed (network blip / 5xx) → outbox fallback.
      await enqueueOutbox('resource.add', { target, resource: finalRes });
      onAdded(finalRes);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} size="md" initialFocusRef={urlRef as React.RefObject<HTMLElement>}>
      <div style={captionMonoUppercase}>
        {originalUrl ? 'replace resource' : 'add resource'}
      </div>
      {originalUrl && (
        <div style={{ fontSize: 12, color: 'var(--ink-40)', marginTop: 6, wordBreak: 'break-all' }}>
          replacing: {originalUrl}
        </div>
      )}

      <div className="flex-wrap-row" style={{ marginTop: 18, gap: 10, alignItems: 'baseline' }}>
        <input
          ref={urlRef}
          type="url"
          value={url}
          placeholder="https://…"
          onChange={(e) => setUrl(e.target.value)}
          disabled={phase !== 'url'}
          className="min-w-0"
          aria-label="Resource URL"
          style={underlineInput}
          onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--ink)')}
          onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'var(--hair-2)')}
        />
        {phase === 'url' && (
          <button
            type="button"
            onClick={() => void doPaste()}
            className="mono focus-ring motion-press"
            style={ghostBtnSm}
          >
            paste
          </button>
        )}
      </div>

      {phase === 'url' && (
        <FooterActions
          cancelLabel="cancel"
          submitLabel={busy ? 'reading…' : 'fetch · ⌘⏎'}
          onCancel={close}
          onSubmit={() => void doPreview()}
          busy={busy}
          submitDisabled={!url.trim()}
        />
      )}

      {phase === 'preview' && (
        <>
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {manual && (
              <div className="mono" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 11, color: 'var(--red)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 5, flex: '0 0 auto' }} />
                <span>ai couldn't read this — fill manually ({fetchInfo?.error || fetchInfo?.strategy})</span>
              </div>
            )}
            <Field label="title" value={resource.title} onChange={(v) => setResource({ ...resource, title: v })} />
            <Field label="why" value={resource.why} onChange={(v) => setResource({ ...resource, why: v })} placeholder="why is this useful here?" />
            <Field
              label="topics"
              value={resource.topicsCovered.join(', ')}
              onChange={(v) =>
                setResource({ ...resource, topicsCovered: v.split(',').map((s) => s.trim()).filter(Boolean) })
              }
              placeholder="atlas_node_ids comma-separated"
            />
            <Field
              label="summary"
              value={resource.summary}
              onChange={(v) => setResource({ ...resource, summary: v })}
              placeholder="2-3 sentences"
              multiline
            />
            <div className="flex-wrap-row" style={{ gap: 14 }}>
              <Field
                label="depth"
                value={resource.depth}
                onChange={(v) => setResource({ ...resource, depth: v })}
                placeholder="intro|intuition|deep|reference"
              />
              <Field
                label="minutes"
                value={String(resource.minutes || '')}
                onChange={(v) => setResource({ ...resource, minutes: parseInt(v, 10) || 0 })}
                placeholder="~"
              />
            </div>
          </div>

          {error && (
            <div className="mono" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, fontSize: 11, color: 'var(--red)' }}>
              <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 5, flex: '0 0 auto' }} />
              <span>{error}</span>
            </div>
          )}

          <FooterActions
            cancelLabel="cancel"
            submitLabel={busy ? 'saving…' : 'add resource · ⌘⏎'}
            onCancel={close}
            onSubmit={() => void doAdd()}
            busy={busy}
          />
        </>
      )}
    </Modal>
  );
}

// Shared v2 styles for the modal interior — caption-mono uppercase header,
// underline input, ghost button, primary white pill.

const captionMonoUppercase: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-60)',
};

const underlineInput: React.CSSProperties = {
  flex: '1 1 200px',
  minWidth: 0,
  padding: '8px 0',
  fontSize: 14,
  background: 'transparent',
  border: 0,
  borderBottom: '1px solid var(--hair-2)',
  color: 'var(--ink)',
  outline: 'none',
  transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
};

const ghostBtnSm: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid var(--hair-2)',
  color: 'var(--ink-60)',
  borderRadius: 'var(--radius-inner)',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const primaryPillSm: React.CSSProperties = {
  padding: '7px 16px',
  background: 'var(--ink)',
  color: 'var(--surface)',
  border: 0,
  borderRadius: 'var(--radius-inner)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  transition:
    'background-color var(--motion-dur-small) var(--motion-ease-standard), opacity var(--motion-dur-small) var(--motion-ease-standard)',
};

function FooterActions({
  cancelLabel,
  submitLabel,
  onCancel,
  onSubmit,
  busy,
  submitDisabled = false,
}: {
  cancelLabel: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
  submitDisabled?: boolean;
}) {
  return (
    <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="mono focus-ring motion-press"
        style={{ ...ghostBtnSm, cursor: busy ? 'not-allowed' : 'pointer' }}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || submitDisabled}
        className="mono focus-ring motion-press"
        style={{
          ...primaryPillSm,
          cursor: busy ? 'progress' : 'pointer',
          opacity: submitDisabled ? 0.5 : 1,
        }}
      >
        {submitLabel}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const onFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderBottomColor = 'var(--ink)';
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderBottomColor = 'var(--hair-2)';
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 140px', minWidth: 0 }}>
      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-40)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          rows={2}
          style={{
            padding: '6px 0',
            fontSize: 13,
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--hair-2)',
            color: 'var(--ink)',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          style={{
            padding: '6px 0',
            fontSize: 13,
            background: 'transparent',
            border: 0,
            borderBottom: '1px solid var(--hair-2)',
            color: 'var(--ink)',
            outline: 'none',
            transition: 'border-color var(--motion-dur-small) var(--motion-ease-decelerate)',
          }}
        />
      )}
    </div>
  );
}
