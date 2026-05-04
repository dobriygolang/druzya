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
        className="mono"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 0,
          background: 'transparent',
          border: 'none',
          color: 'rgba(255,255,255,0.55)',
          fontSize: 10,
          letterSpacing: '.24em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>my learning resources</span>
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>· bookmarks for ai</span>
      </button>

      {open && (
        <div
          style={{
            marginTop: 16,
            padding: '14px 16px',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 6,
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: '.16em', textTransform: 'uppercase' }}>
              {resources.length === 0 ? 'no resources yet' : `${resources.length} saved`}
            </span>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mono"
              style={{
                padding: '5px 10px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.85)',
                borderRadius: 4,
                fontSize: 10.5,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              + add resource
            </button>
          </div>

          {error && (
            <div className="mono" style={{ fontSize: 11, color: '#FF3B30', marginBottom: 10 }}>
              {error}
            </div>
          )}

          {resources.length === 0 && !error && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>
              add urls you read · ai uses these to tune your plan and notes auto-link.
              <br />
              <span style={{ color: 'rgba(255,255,255,0.35)' }}>
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
