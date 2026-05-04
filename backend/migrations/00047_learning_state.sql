-- 00047_learning_state.sql — Phase 1a из docs/feature/implementation-plan.md.
--
-- Per-user state для learning-companion: режим (explore/commit/deep) и
-- ветка fork-анализа (de/mle/none) для intelligence FORK STATUS prompt.
-- Lazy-create через repo при первом Get — без backfill существующих юзеров.
--
-- Phase 0 решения (research §7):
--   - mode хранится как enum (1), не string
--   - committed_track_id появляется при commit/deep, NULL в explore
--   - fork_branch NULL до явного выбора, 'none' = пользователь отказался
--     от fork (single-track), 'de'/'mle' = выбранная специализация
--
-- Инвариант committed_track_id↔committed_at — поддерживается на уровне
-- app/repo, а не CHECK constraint, чтобы ON DELETE SET NULL на tracks
-- не падал. Mode→track пара (commit/deep требует track) — RESTRICT
-- delete на tracks: админ обязан мигрировать юзеров перед удалением
-- трека.

-- +goose Up
-- +goose StatementBegin
CREATE TYPE learning_mode AS ENUM ('explore', 'commit', 'deep');

CREATE TYPE fork_branch AS ENUM ('de', 'mle', 'none');

CREATE TABLE learning_state (
    user_id              UUID          PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode                 learning_mode NOT NULL DEFAULT 'explore',
    fork_branch          fork_branch   NULL,
    explore_started_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    committed_track_id   UUID          NULL REFERENCES tracks(id) ON DELETE RESTRICT,
    committed_at         TIMESTAMPTZ   NULL,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT learning_state_commit_requires_track
        CHECK (mode = 'explore' OR committed_track_id IS NOT NULL)
);

CREATE INDEX idx_learning_state_mode ON learning_state (mode);

CREATE INDEX idx_learning_state_fork
    ON learning_state (fork_branch)
    WHERE fork_branch IS NOT NULL;

COMMENT ON TABLE  learning_state               IS 'Per-user learning mode + fork branch for intelligence FORK STATUS prompt and admin distribution view.';
COMMENT ON COLUMN learning_state.mode          IS 'explore = trying multiple tracks; commit = one track chosen; deep = focused mastery on committed track.';
COMMENT ON COLUMN learning_state.fork_branch   IS 'Cross-cutting specialization within dev_senior: de (data-engineering), mle (ml-engineering), none (declined fork). NULL = not chosen yet.';
COMMENT ON COLUMN learning_state.explore_started_at IS 'When current explore window opened — used for "week N of 6" in FORK STATUS prompt.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS learning_state;
DROP TYPE  IF EXISTS fork_branch;
DROP TYPE  IF EXISTS learning_mode;
-- +goose StatementEnd
