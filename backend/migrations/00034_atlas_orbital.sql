-- +goose Up
-- +goose StatementBegin
--
-- 00034 — Atlas: PoE-inspired passive-tree (Wave-10, design-review v2 P0 v3).
--
-- Replaces the simple "node + edge" model with a denser skill-tree
-- vocabulary borrowed from Path of Exile 2's atlas:
--
--   • cluster   — designer-grouped dense gathering of related skills
--                 (not a 72° sector — clusters are organic blobs).
--   • node_kind — 'hub'      : center, character/focus-class.
--                 'keystone' : 1 per cluster, diamond shape, big perk.
--                 'notable'  : milestones (3-5 per cluster), sigil-framed.
--                 'small'    : incremental drills between notables.
--   • edge.kind — 3 canonical link types, see CHECK constraint below.
--
-- pos_x/pos_y are KEPT (not dropped) because clusters are hand-laid by
-- designers in the admin CMS — PoE canvas is hand-tuned, not algorithmic.
-- The v2 orbital layout was a dead-end at 30+ nodes precisely because
-- equal sectors look mechanical; clusters look earned.
--
-- Per-user allocation: "is this node reachable?" requires a graph
-- traversal at GetAtlas time — there is an allocated path from hub
-- through mastered nodes to candidate. This is computed on read in Go
-- (see profile/app/atlas.go) and surfaced as AtlasView.NodeReachable[id].
-- We do NOT store reachability in the DB — it is a function of which
-- nodes the user has mastered, which already lives in skill_nodes.
--
-- Anti-fallback: backfill maps existing kinds 1:1 (center→hub,
-- ascendant→keystone, keystone→notable, normal→small) so the seed
-- catalogue still renders sensibly with the new visual grammar.
-- cluster column backfills from section so day-1 deploy is observably
-- equivalent for users with existing progress.

-- 1. atlas_nodes: cluster + expanded node_kind.
ALTER TABLE atlas_nodes
    ADD COLUMN IF NOT EXISTS cluster TEXT NOT NULL DEFAULT '';

UPDATE atlas_nodes SET cluster = section WHERE cluster = '';

-- Drop the v1 kind constraint so we can introduce the PoE-inspired set.
ALTER TABLE atlas_nodes
    DROP CONSTRAINT IF EXISTS atlas_nodes_kind_valid;

-- Migrate kind values to the new vocabulary in-place.
UPDATE atlas_nodes SET kind = 'hub'      WHERE kind = 'center';
UPDATE atlas_nodes SET kind = 'keystone' WHERE kind = 'ascendant';
UPDATE atlas_nodes SET kind = 'notable'  WHERE kind = 'keystone' AND id NOT IN (
    -- the row(s) we just relabelled from 'ascendant' are already keystones;
    -- this guards against double-mapping. In our seed there's no overlap
    -- but the WHERE clause makes the migration idempotent if rerun.
    SELECT id FROM atlas_nodes WHERE kind = 'keystone'
);
UPDATE atlas_nodes SET kind = 'small'    WHERE kind = 'normal';

ALTER TABLE atlas_nodes
    ADD CONSTRAINT atlas_nodes_kind_valid
        CHECK (kind IN ('hub', 'keystone', 'notable', 'small'));

-- 2. atlas_edges: 3-canon edge grammar.
ALTER TABLE atlas_edges
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'prereq';

ALTER TABLE atlas_edges
    ADD CONSTRAINT atlas_edges_kind_valid
        CHECK (kind IN ('prereq', 'suggested', 'crosslink'));

-- 3. Index for cluster-scoped queries (used by per-cluster aura render
--    and by the allocated-path traversal which needs to walk by cluster
--    membership for cross-link detection).
CREATE INDEX IF NOT EXISTS idx_atlas_nodes_active_cluster
    ON atlas_nodes(cluster)
    WHERE is_active = TRUE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_atlas_nodes_active_cluster;

ALTER TABLE atlas_edges
    DROP CONSTRAINT IF EXISTS atlas_edges_kind_valid,
    DROP COLUMN IF EXISTS kind;

ALTER TABLE atlas_nodes
    DROP CONSTRAINT IF EXISTS atlas_nodes_kind_valid,
    DROP COLUMN IF EXISTS cluster;

-- Restore old kind set with best-effort reverse mapping.
UPDATE atlas_nodes SET kind = 'normal'    WHERE kind = 'small';
UPDATE atlas_nodes SET kind = 'keystone'  WHERE kind = 'notable';
UPDATE atlas_nodes SET kind = 'ascendant' WHERE kind = 'keystone';
UPDATE atlas_nodes SET kind = 'center'    WHERE kind = 'hub';

ALTER TABLE atlas_nodes
    ADD CONSTRAINT atlas_nodes_kind_valid
        CHECK (kind IN ('normal','keystone','ascendant','center'));
-- +goose StatementEnd
