-- 00099_ab_experiments.sql — Admin Phase 2: A/B experiment scaffold.
--
-- Minimal table set: experiment + per-user variant assignment. Stats /
-- analytics pipeline + bucketing rollout logic — deferred Phase 3.
-- Admin может create draft, pause, complete; assignment + metric tracking
-- — отдельные сервисы которые будут читать эти rows.
--
-- variants JSONB shape: [{"name":"control","weight":50},{"name":"v1","weight":50}].
-- Weights sum NOT enforced на DB level — Go validation в admin/app.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS ab_experiments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT UNIQUE NOT NULL,
    hypothesis   TEXT NOT NULL,
    variants     JSONB NOT NULL,
    metric_slug  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft',
    starts_at    TIMESTAMPTZ,
    ends_at      TIMESTAMPTZ,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ab_experiments_status_chk
        CHECK (status IN ('draft','running','paused','completed'))
);

CREATE INDEX IF NOT EXISTS ab_experiments_status
    ON ab_experiments(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ab_user_assignments (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experiment_id UUID NOT NULL REFERENCES ab_experiments(id) ON DELETE CASCADE,
    variant       TEXT NOT NULL,
    assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, experiment_id)
);

CREATE INDEX IF NOT EXISTS ab_user_assignments_experiment
    ON ab_user_assignments(experiment_id, variant);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS ab_user_assignments;
DROP TABLE IF EXISTS ab_experiments;

-- +goose StatementEnd
