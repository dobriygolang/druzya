-- +goose Up
-- +goose StatementBegin

-- 00110_tutor_path_assignments.sql — Phase K, T2 + T3 (2026-05-12).
--
-- Path assignment tracking. Stream D shipped CRUD over `tutor_reading_paths`
-- (curated atlas-node sequences); T2 closes the loop by letting a tutor
-- assign a whole path to a student с одним кликом — server creates one
-- record + emits per-step TutorAssignment rows. T3 enables student-side
-- «Active Paths» visibility («Go Senior · step 3 / 9 · tutor: Maria»).
--
-- Schema decisions:
--   1) snapshot_atlas_node_keys + snapshot_resource_ids — copy of path
--      contents at assign time. If the tutor edits / archives the path
--      later, in-flight assignments keep working on the old definition;
--      pinning at the row level avoids a join-on-deleted-row footgun.
--   2) Unique (path_id, student_id, archived_at) — re-assigning after
--      archive is allowed (archived_at participates in the uniqueness),
--      but you can't have two ACTIVE assignments of the same path to
--      the same student. archived_at = NULL is treated as a stable value
--      by Postgres' unique semantics here (one NULL per pair).
--   3) Partial index on active rows — student-side ListMyActivePaths is
--      the hot query (one per page load). idx covers student_id +
--      excludes completed/archived; rows there are short-lived (paths
--      typically run weeks, not years).

CREATE TABLE IF NOT EXISTS tutor_path_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path_id         UUID NOT NULL REFERENCES tutor_reading_paths(id) ON DELETE CASCADE,
    tutor_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- 0-based step pointer; total_steps is captured at assign time so
    -- the UI's «step N / M» chip stays stable if the underlying path is
    -- edited (we read from the snapshot column anyway).
    current_step    INTEGER NOT NULL DEFAULT 0,
    total_steps     INTEGER NOT NULL,
    -- Snapshot of path content at assign time. JSON would be heavier
    -- and forces parsing on every read; native arrays match the source
    -- columns exactly and let `array_length()` / index lookup work
    -- without conversion.
    snapshot_atlas_node_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    snapshot_resource_ids    UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ,
    CONSTRAINT tutor_path_assignments_steps_nonneg CHECK (current_step >= 0),
    CONSTRAINT tutor_path_assignments_total_nonneg CHECK (total_steps >= 0),
    CONSTRAINT tutor_path_assignments_step_le_total CHECK (current_step <= total_steps),
    CONSTRAINT tutor_path_assignments_self_check CHECK (tutor_id <> student_id)
);

-- One ACTIVE assignment of a given path to a given student. After
-- archive (archived_at IS NOT NULL) the constraint is relaxed via NULL
-- semantics (one NULL per pair allowed → no duplicate active).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tpa_unique_active
    ON tutor_path_assignments(path_id, student_id)
    WHERE archived_at IS NULL;

-- Student-side hot read: «what paths am I on now?»
CREATE INDEX IF NOT EXISTS idx_tpa_student_active
    ON tutor_path_assignments(student_id)
    WHERE completed_at IS NULL AND archived_at IS NULL;

-- Tutor-side: «who's on this path»
CREATE INDEX IF NOT EXISTS idx_tpa_tutor
    ON tutor_path_assignments(tutor_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_tpa_path
    ON tutor_path_assignments(path_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_tpa_path;
DROP INDEX IF EXISTS idx_tpa_tutor;
DROP INDEX IF EXISTS idx_tpa_student_active;
DROP INDEX IF EXISTS idx_tpa_unique_active;
DROP TABLE IF EXISTS tutor_path_assignments;

-- +goose StatementEnd
