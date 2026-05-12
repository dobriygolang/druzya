-- 00107_user_atlas_struggle_marks.sql — X5 (Phase J P2 2026-05-12) cross-product
-- handoff signal.
--
-- Bidirectional handoff system needs a place to land "user struggled with X
-- in surface Y → surface Z (web Atlas) should highlight X next time".
-- Cue session analysis (low self_rating per stage), Hone reflection (grade
-- ≤2), and Mock stage results — all write into this single per-user override
-- on the curated atlas graph.
--
-- Design rationale:
--   • Single row per (user, atlas_node_id) — latest write wins via ON
--     CONFLICT UPDATE. Multiple sources of evidence collapse into one
--     visible mark; analytics can query source-history via coach_episodes
--     payloads if needed (we don't keep an append-only struggle log here
--     to avoid 10x row-storm on heavy users).
--   • atlas_node_id is TEXT, NOT a FK. Atlas content evolves (slug renames,
--     custom user nodes in user_atlas_nodes), and a strict FK would block
--     opportunistic marks against unknown keys. Frontend tolerates marks
--     that no longer match a visible node (just falls through to "no
--     highlight"); admin sweep can clean stale rows offline if it grows.
--   • confidence ∈ [0,1] lets future producers (LLM-judge over transcript,
--     mock_session ai_report axis-level scores) emit calibrated signals
--     without redesigning the schema.
--   • source — 'cue_session' | 'hone_reflection' | 'mock_stage' | 'manual'.
--     CHECK constraint locks the closed set so accidental string typos in
--     producers don't silently pollute the table.
--   • Soft-clear: ClearAtlasStruggle deletes the row. No deleted_at column
--     — explicit user gesture means "I'm not stuck anymore", and the row
--     can be re-created on next bad signal. Keeps the table small.
--
-- Index strategy:
--   • PRIMARY KEY (user_id, atlas_node_id) — the only lookup pattern is
--     «list marks for user» + «upsert (user, node)». PK covers both.
--   • idx_user_atlas_struggle_marks_user_marked — sort newest-first for
--     UI panel «last struggled topics».

-- +goose Up
-- +goose StatementBegin

CREATE TABLE user_atlas_struggle_marks (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    atlas_node_id  TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT 'manual',
    confidence     REAL NOT NULL DEFAULT 0.5,
    note           TEXT NOT NULL DEFAULT '',
    marked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, atlas_node_id),

    CONSTRAINT user_atlas_struggle_marks_source_valid
        CHECK (source IN ('cue_session', 'hone_reflection', 'mock_stage', 'manual')),
    CONSTRAINT user_atlas_struggle_marks_confidence_range
        CHECK (confidence >= 0.0 AND confidence <= 1.0),
    CONSTRAINT user_atlas_struggle_marks_atlas_node_id_nonempty
        CHECK (length(atlas_node_id) > 0)
);

CREATE INDEX idx_user_atlas_struggle_marks_user_marked
    ON user_atlas_struggle_marks(user_id, marked_at DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS idx_user_atlas_struggle_marks_user_marked;
DROP TABLE IF EXISTS user_atlas_struggle_marks;

-- +goose StatementEnd
