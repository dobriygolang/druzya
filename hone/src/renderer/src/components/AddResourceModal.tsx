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
  const [url, setUrl] = useState('');
  const [resource, setResource] = useState<Resource>(blankResource(''));
  const [phase, setPhase] = useState<'url' | 'preview' | 'submit'>('url');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [fetchInfo, setFetchInfo] = useState<{ strategy: string; error: string } | null>(null);
  const urlRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTimeout(() => urlRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
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
    <div
      role="dialog"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540,
          maxWidth: '92vw',
          background: '#0a0a0a',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10,
          padding: '26px 28px 22px',
          color: 'rgba(255,255,255,0.92)',
        }}
      >
        <div className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '.18em', textTransform: 'uppercase' }}>
          {originalUrl ? 'replace resource' : 'add resource'}
        </div>
        {originalUrl && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>
            replacing: {originalUrl}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <input
            ref={urlRef}
            type="url"
            value={url}
            placeholder="https://…"
            onChange={(e) => setUrl(e.target.value)}
            disabled={phase !== 'url'}
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 13,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 5,
              color: 'rgba(255,255,255,0.92)',
              outline: 'none',
            }}
          />
          {phase === 'url' && (
            <button
              type="button"
              onClick={() => void doPaste()}
              className="mono"
              style={{
                padding: '0 10px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.7)',
                borderRadius: 5,
                fontSize: 10,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              paste
            </button>
          )}
        </div>

        {phase === 'url' && (
          <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              className="mono"
              style={{
                padding: '6px 12px',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.6)',
                borderRadius: 5,
                fontSize: 11,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              cancel
            </button>
            <button
              type="button"
              onClick={() => void doPreview()}
              disabled={busy || !url.trim()}
              className="mono"
              style={{
                padding: '6px 14px',
                background: '#fff',
                color: '#000',
                border: 'none',
                borderRadius: 5,
                fontSize: 11,
                letterSpacing: '.08em',
                textTransform: 'uppercase',
                cursor: busy ? 'progress' : 'pointer',
                opacity: !url.trim() ? 0.5 : 1,
              }}
            >
              {busy ? 'reading…' : 'fetch · ⌘⏎'}
            </button>
          </div>
        )}

        {phase === 'preview' && (
          <>
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {manual && (
                <div className="mono" style={{ fontSize: 10, color: '#FF3B30', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  ai couldn't read this — fill manually ({fetchInfo?.error || fetchInfo?.strategy})
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
              <div style={{ display: 'flex', gap: 8 }}>
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
              <div className="mono" style={{ marginTop: 12, fontSize: 11, color: '#FF3B30' }}>
                {error}
              </div>
            )}

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="mono"
                style={{
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.6)',
                  borderRadius: 5,
                  fontSize: 11,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  cursor: busy ? 'not-allowed' : 'pointer',
                }}
              >
                cancel
              </button>
              <button
                type="button"
                onClick={() => void doAdd()}
                disabled={busy}
                className="mono"
                style={{
                  padding: '6px 14px',
                  background: '#fff',
                  color: '#000',
                  border: 'none',
                  borderRadius: 5,
                  fontSize: 11,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  cursor: busy ? 'progress' : 'pointer',
                }}
              >
                {busy ? 'saving…' : 'add resource · ⌘⏎'}
              </button>
            </div>
          </>
        )}
      </div>
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
      <span className="mono" style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.4)', letterSpacing: '.12em', textTransform: 'uppercase' }}>
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          style={{
            padding: '6px 9px',
            fontSize: 12.5,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 4,
            color: 'rgba(255,255,255,0.92)',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{
            padding: '6px 9px',
            fontSize: 12.5,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 4,
            color: 'rgba(255,255,255,0.92)',
            outline: 'none',
          }}
        />
      )}
    </div>
  );
}
