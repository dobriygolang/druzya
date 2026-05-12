-- +goose Up
-- +goose StatementBegin

-- 00093_tutor_mode_paths.sql — Stream D «Tutor mode polish v1».
--
-- Two orthogonal changes, both safe to combine:
--
--   1. users.tutor_mode_enabled — self-toggle flag for the tutor role.
--      Independent from users.role (CHECK constraint stays user|interviewer|
--      admin|ai_tutor — modifying that constraint would force a coordinated
--      pb enum migration and back-fill across all read paths). The flag is
--      a UI affordance: when ON the AppShell surfaces tutor nav items and
--      /tutor sub-surfaces; when OFF they are hidden but the backend still
--      enforces per-row auth so existing relationships keep working.
--
--   2. tutor_reading_paths — curated atlas-node sequences (4th sub-surface,
--      complements existing tutor_shared_materials which is one-off broadcast
--      reading). A path = ordered list of atlas_node_keys + resource_ids
--      that a tutor wants a student to walk through. assigned_count is a
--      denormalised counter (kept in sync by the assignment UC) so the list
--      view can show «5 students on this path» without a join.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS tutor_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_tutor_mode
    ON users(id)
    WHERE tutor_mode_enabled = TRUE;

CREATE TABLE IF NOT EXISTS tutor_reading_paths (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    -- Ordered atlas_node_keys. CHECK on max length avoids accidental DOS
    -- via a 100k-element array; 200 nodes is roughly an entire track curriculum.
    atlas_node_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Ordered resource_ids (external_resources.id). Path can mix in
    -- specific resources alongside atlas nodes.
    resource_ids    UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    assigned_count  INTEGER NOT NULL DEFAULT 0,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tutor_reading_paths_name_nonempty CHECK (char_length(name) BETWEEN 1 AND 240),
    CONSTRAINT tutor_reading_paths_node_count CHECK (array_length(atlas_node_keys, 1) IS NULL OR array_length(atlas_node_keys, 1) <= 200),
    CONSTRAINT tutor_reading_paths_resource_count CHECK (array_length(resource_ids, 1) IS NULL OR array_length(resource_ids, 1) <= 200)
);

CREATE INDEX IF NOT EXISTS idx_tutor_reading_paths_tutor_created
    ON tutor_reading_paths(tutor_id, created_at DESC)
    WHERE archived_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_tutor_reading_paths_tutor_created;
DROP TABLE IF EXISTS tutor_reading_paths;

DROP INDEX IF EXISTS idx_users_tutor_mode;
ALTER TABLE users DROP COLUMN IF EXISTS tutor_mode_enabled;

-- +goose StatementEnd
