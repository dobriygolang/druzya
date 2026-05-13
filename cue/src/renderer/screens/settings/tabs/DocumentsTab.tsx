// Documents tab — upload, manage, and attach RAG documents to the
// active copilot session.

import { useCallback, useEffect, useRef, useState } from 'react';

import { useT, translate } from '@d9-i18n';
import { IconDocument, IconTrash } from '../../../components/icons';
import { Button } from '../../../components/primitives';
import { useAuthStore } from '../../../stores/auth';
import type { Document } from '@shared/ipc';
import {
  SectionTitle,
  emptyStyle,
  formatBytes,
  guessMIME,
  humanizeError,
} from '../lib/shared';

/**
 * DocumentsTab — upload CV / JD / notes and manage the user's document
 * library. Attached documents get injected as RAG context into every
 * turn of the user's live copilot session (see backend
 * services/copilot/app/analyze.go for the inject path).
 *
 * MVP scope:
 *   - drag-n-drop + click-to-browse upload;
 *   - status pill per row ('pending' while embedder runs, 'ready' once
 *     the document is usable);
 *   - delete with cascade to chunks (backend FK ON DELETE CASCADE).
 *
 * Not here (next iterations): paste-URL ingestion, PDF/DOCX support,
 * per-session attach toggle UI (need a session picker first).
 *
 * Auth: relies on the bearer saved in keychain. Unauthenticated users
 * see the "войди" hint and no list.
 */
export function DocumentsTab() {
  const t = useT();
  const session = useAuthStore((s) => s.session);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  // Attached-to-session id set + liveSessionId so the UI can show an
  // attach/detach toggle per row when the user has a live copilot
  // session open. Without a live session the toggles are disabled —
  // there's nothing meaningful to attach to.
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const out = await window.druz9.documents.list('', 50);
      setDocs(out.documents);
      setError('');
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  const refreshAttached = useCallback(async () => {
    if (!session) return;
    try {
      const s = await window.druz9.sessions.current();
      if (!s || !s.id) {
        setLiveSessionId(null);
        setAttachedIds(new Set());
        return;
      }
      setLiveSessionId(s.id);
      const ids = await window.druz9.documents.listAttachedToSession(s.id);
      setAttachedIds(new Set(ids));
    } catch {
      // Silent — no live session is a common state, not an error.
      setLiveSessionId(null);
      setAttachedIds(new Set());
    }
  }, [session]);

  useEffect(() => {
    void refresh();
    void refreshAttached();
  }, [refresh, refreshAttached]);

  const toggleAttach = async (docId: string, nextAttached: boolean) => {
    if (!liveSessionId) return;
    setError('');
    // Optimistic update — flip locally, roll back on failure.
    setAttachedIds((prev) => {
      const next = new Set(prev);
      if (nextAttached) next.add(docId);
      else next.delete(docId);
      return next;
    });
    try {
      if (nextAttached) {
        await window.druz9.documents.attachToSession(liveSessionId, docId);
      } else {
        await window.druz9.documents.detachFromSession(liveSessionId, docId);
      }
    } catch (e) {
      setAttachedIds((prev) => {
        const next = new Set(prev);
        if (nextAttached) next.delete(docId);
        else next.add(docId);
        return next;
      });
      setError(humanizeError(e));
    }
  };

  const uploadOne = async (file: File) => {
    // Enforce the 10MB server-side cap at the UI to give a clear error
    // before we waste a round-trip.
    if (file.size > 10 * 1024 * 1024) {
      setError(t('cue.settings.documents.size_limit_error', { name: file.name }));
      return;
    }
    setUploading(true);
    setError('');
    try {
      const buf = await file.arrayBuffer();
      await window.druz9.documents.upload({
        filename: file.name,
        mime: file.type || guessMIME(file.name),
        content: new Uint8Array(buf),
      });
      await refresh();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setUploading(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    // Upload sequentially — the Ollama embedder is single-threaded per
    // request and 3 parallel uploads of 50 chunks each would saturate
    // the sidecar. Users uploading batches accept the latency.
    for (let i = 0; i < files.length; i++) {
      await uploadOne(files[i]);
    }
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    await onFiles(e.dataTransfer.files);
  };

  const onImportURL = async () => {
    const url = urlDraft.trim();
    if (!url) return;
    setUploading(true);
    setError('');
    try {
      await window.druz9.documents.uploadFromURL(url);
      setUrlDraft('');
      await refresh();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    setError('');
    try {
      await window.druz9.documents.delete(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      setError(humanizeError(e));
    }
  };

  if (!session) {
    return (
      <>
        <SectionTitle title={t('cue.settings.documents.section.title')} subtitle={t('cue.settings.documents.empty_session_subtitle')} />
        <div style={emptyStyle}>{t('cue.settings.documents.empty_session_body')}</div>
      </>
    );
  }

  return (
    <>
      <SectionTitle
        title={t('cue.settings.documents.section.title')}
        subtitle={t('cue.settings.documents.section.subtitle')}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: '28px 20px',
          borderRadius: 12,
          textAlign: 'center',
          cursor: uploading ? 'wait' : 'pointer',
          background: dragging ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
          border: dragging
            ? '1px solid var(--d9-accent)'
            : '1px dashed var(--d9-hairline)',
          color: 'var(--d9-ink-mute)',
          fontSize: 12.5,
          letterSpacing: '-0.005em',
          lineHeight: 1.5,
          marginBottom: 16,
          transition:
            'background var(--motion-dur-small) var(--motion-ease-standard), border-color var(--motion-dur-small) var(--motion-ease-standard)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={[
            // text formats
            '.txt', '.md', '.markdown', '.html', '.htm',
            'text/plain', 'text/markdown', 'text/html',
            // office formats (pdf + docx). Some browsers report docx
            // as application/msword; the backend routes both to the
            // docx extractor and sniffs the zip magic to reject real
            // legacy .doc OLE files.
            '.pdf', '.docx',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
          ].join(',')}
          style={{ display: 'none' }}
          onChange={(e) => {
            void onFiles(e.target.files);
            // Reset so selecting the same file again re-triggers onChange.
            e.currentTarget.value = '';
          }}
        />
        {uploading ? (
          t('cue.settings.documents.uploading')
        ) : (
          <>
            <div style={{ color: 'var(--d9-ink)', fontWeight: 500, marginBottom: 4 }}>
              {t('cue.settings.documents.upload_body')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--d9-ink-ghost)' }}>
              {t('cue.settings.documents.upload_hint')}
            </div>
          </>
        )}
      </div>

      {/* URL import — paste a JD/blog/Habr link and we fetch + readability-
          extract on the server side. Sits BELOW the drop-zone because the
          primary flow for users is still "drop CV.pdf here". */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--pad-inline)',
          marginBottom: 16,
          alignItems: 'stretch',
        }}
      >
        <input
          type="url"
          placeholder={t('cue.settings.documents.url_placeholder')}
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !uploading && urlDraft.trim()) {
              e.preventDefault();
              void onImportURL();
            }
          }}
          disabled={uploading}
          spellCheck={false}
          style={{
            flex: 1,
            height: 32,
            padding: '0 12px',
            fontSize: 12,
            fontFamily: 'inherit',
            color: 'var(--d9-ink)',
            background: 'var(--d9-slate)',
            border: '0.5px solid var(--d9-hairline)',
            borderRadius: 8,
            outline: 'none',
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void onImportURL()}
          disabled={uploading || !urlDraft.trim()}
        >
          {t('cue.settings.documents.url_cta')}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: '10px 14px',
            borderRadius: 9,
            background: 'rgba(255, 59, 48, 0.12)',
            border: '0.5px solid rgba(255, 59, 48, 0.4)',
            color: 'var(--d9-accent)',
            fontSize: 11.5,
            letterSpacing: '-0.005em',
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {loading && docs.length === 0 ? (
        <div style={emptyStyle}>{t('cue.settings.documents.loading')}</div>
      ) : docs.length === 0 ? (
        <div style={emptyStyle}>
          {t('cue.settings.documents.empty_list')}
        </div>
      ) : (
        <>
          {liveSessionId ? (
            <div
              style={{
                fontSize: 11,
                color: 'var(--d9-ink-ghost)',
                margin: '4px 0 10px',
                letterSpacing: '-0.005em',
              }}
            >
              {t('cue.settings.documents.has_session_hint')}
            </div>
          ) : (
            <div
              style={{
                fontSize: 11,
                color: 'var(--d9-ink-ghost)',
                margin: '4px 0 10px',
                letterSpacing: '-0.005em',
              }}
            >
              {t('cue.settings.documents.no_session_hint')}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {docs.map((d) => (
              <DocumentRow
                key={d.id}
                doc={d}
                onDelete={onDelete}
                attached={attachedIds.has(d.id)}
                canAttach={!!liveSessionId && d.status === 'ready'}
                onToggleAttach={(next) => toggleAttach(d.id, next)}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function DocumentRow({
  doc,
  onDelete,
  attached,
  canAttach,
  onToggleAttach,
}: {
  doc: Document;
  onDelete: (id: string) => void;
  attached: boolean;
  canAttach: boolean;
  onToggleAttach: (next: boolean) => void;
}) {
  const t = useT();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 0',
        borderBottom: '0.5px solid var(--d9-hairline)',
      }}
    >
      <IconDocument size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: 'var(--d9-ink)',
            letterSpacing: '-0.005em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={doc.filename}
        >
          {doc.filename}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--d9-ink-mute)',
            marginTop: 3,
            fontFamily: 'var(--d9-font-mono)',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <span>{formatBytes(doc.sizeBytes)}</span>
          {doc.status === 'ready' && (
            <>
              <span>·</span>
              <span>
                {pluralChunks(doc.chunkCount)}
              </span>
            </>
          )}
          {doc.status === 'failed' && doc.errorMessage && (
            <>
              <span>·</span>
              <span title={doc.errorMessage} style={{ color: 'var(--d9-accent)' }}>
                {t('cue.settings.documents.status.error_inline')}
              </span>
            </>
          )}
        </div>
      </div>
      <StatusPill status={doc.status} />
      {(canAttach || attached) && (
        <Button
          size="sm"
          variant={attached ? 'primary' : 'secondary'}
          onClick={() => onToggleAttach(!attached)}
          aria-pressed={attached}
        >
          {attached ? t('cue.settings.documents.attached') : t('cue.settings.documents.attach')}
        </Button>
      )}
      <button
        type="button"
        onClick={() => onDelete(doc.id)}
        title={t('cue.settings.documents.delete_title')}
        className="d9-icon-hover"
        style={{
          background: 'transparent',
          border: 0,
          color: 'var(--d9-ink-ghost)',
          cursor: 'pointer',
          padding: 6,
          borderRadius: 'var(--radius-inner)',
          display: 'inline-flex',
          alignItems: 'center',
          transition:
            'background var(--motion-dur-small) var(--motion-ease-standard), color var(--motion-dur-small) var(--motion-ease-standard)',
        }}
      >
        <IconTrash size={14} />
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: Document['status'] }) {
  const t = useT();
  // Map status → (label, tone). Pending/extracting/embedding all render
  // as "indexing" to keep the surface simple; users don't benefit
  // from distinguishing the sub-stages at this stage of the product.
  const label: Record<Document['status'], string> = {
    pending: t('cue.settings.documents.status.indexing'),
    extracting: t('cue.settings.documents.status.indexing'),
    embedding: t('cue.settings.documents.status.indexing'),
    ready: t('cue.settings.documents.status.ready'),
    failed: t('cue.settings.documents.status.failed'),
    deleting: t('cue.settings.documents.status.deleting'),
  };
  const isReady = status === 'ready';
  const isFailed = status === 'failed';
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: 'var(--d9-font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        padding: '3px 9px',
        borderRadius: 999,
        background: isReady
          ? 'rgba(255, 255, 255, 0.04)'
          : isFailed
            ? 'rgba(255, 59, 48, 0.12)'
            : 'var(--d9-accent-glow)',
        color: isReady
          ? 'var(--d9-ink)'
          : isFailed
            ? 'var(--d9-accent)'
            : 'var(--d9-accent-hi)',
        border: `0.5px solid ${
          isReady
            ? 'var(--d9-hairline-b)'
            : isFailed
              ? 'rgba(255, 59, 48, 0.4)'
              : 'rgba(255, 59, 48, 0.35)'
        }`,
        whiteSpace: 'nowrap',
      }}
    >
      {label[status]}
    </span>
  );
}

// pluralChunks — Russian-style plural for "чанк / чанка / чанков" via
// the dictionary. English locale collapses to the same form for all
// counts (handled in en.ts), so this still routes through t().
function pluralChunks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  // useT must be called inside React — pluralChunks is called from
  // DocumentRow where t already exists. Re-derive via translate() so
  // we don't require passing t through.
  const key = (() => {
    if (mod10 === 1 && mod100 !== 11) return 'cue.settings.documents.chunks.one';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
      return 'cue.settings.documents.chunks.few';
    return 'cue.settings.documents.chunks.many';
  })();
  // Lazy import to avoid circular load on SSR / tests.
  return translate(key as Parameters<typeof translate>[0], { n });
}
