// ResourceLibrarySection — Phase 5 5a-c Settings entry point (Path C low-key).
//
// Manual entry для add-resource flow: user открывает Settings → «my learning
// resources» → видит свои added overrides + может «+ add resource» → opens
// AddResourceModal (Phase 5b). Это manual entry-point — automatic flow
// будет когда Coach / atlas-step UI получают Phase 5 mockup re-apply
// в follow-up session.
//
// Также показывает ResourceCard list (Phase 5c) для preview hover-actions.
//
// Target — global resources (atlas_node_id="" → backend стрелит по Validation
// "either node OR step required"). Workaround: используем «inbox» nodeID
// который существует во всех atlas seeds.
import { useEffect, useState } from 'react';

import {
  applyOverrides,
  type Resource,
  type Target,
} from '../api/curation';
import { AddResourceModal } from './AddResourceModal';
import { ResourceCard } from './ResourceCard';

const INBOX_TARGET: Target = { atlasNodeId: 'inbox' };

export function ResourceLibrarySection() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      // base=[] → server returns user-added only (через ApplyOverrides).
      const merged = await applyOverrides(INBOX_TARGET, []);
      setResources(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (open && resources.length === 0) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <section style={{ margin: '0 0 44px' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="resource-library-panel"
        className="mono"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--gap-row)',
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'var(--ink-60)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>my learning resources</span>
        <span style={{ color: 'var(--ink-40)' }}>· bookmarks for ai</span>
      </button>

      {open && (
        <div
          id="resource-library-panel"
          style={{
            marginTop: 16,
            padding: '14px 16px',
            border: '1px solid var(--hair)',
            borderRadius: 'var(--radius-inner)',
            background: 'var(--hair)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-60)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {resources.length === 0 ? 'no resources yet' : `${resources.length} saved`}
            </span>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mono focus-ring motion-press"
              style={{
                padding: '5px 10px',
                background: 'var(--hair)',
                border: '1px solid var(--hair-2)',
                color: 'var(--ink-90)',
                borderRadius: 'var(--radius-inner)',
                fontSize: 10.5,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              + add resource
            </button>
          </div>

          {error && (
            <div className="mono" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 11, color: 'var(--red)', marginBottom: 10 }}>
              <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 1.5, background: 'var(--red)', marginTop: 5, flex: '0 0 auto' }} />
              <span>{error}</span>
            </div>
          )}

          {resources.length === 0 && !error && (
            <div style={{ fontSize: 12, color: 'var(--ink-40)', lineHeight: 1.5 }}>
              add urls you read · ai uses these to tune your plan and notes auto-link.
              <br />
              <span style={{ color: 'var(--ink-40)' }}>
                each url goes through best-effort fetch + ai-extract; you confirm fields.
              </span>
            </div>
          )}

          {resources.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {resources.map((r) => (
                <ResourceCard
                  key={r.url}
                  resource={r}
                  target={INBOX_TARGET}
                  userAdded
                  onUnhelpful={() => void refresh()}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {addOpen && (
        <AddResourceModal
          target={INBOX_TARGET}
          allowedAtlasNodeIds={[]}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            void refresh();
          }}
        />
      )}
    </section>
  );
}
