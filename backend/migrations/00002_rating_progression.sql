-- +goose Up
-- +goose StatementBegin
CREATE TABLE ratings (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    section        TEXT NOT NULL,
    elo            INT NOT NULL DEFAULT 1000,
    matches_count  INT NOT NULL DEFAULT 0,
    last_match_at  TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, section),
    CONSTRAINT ratings_section_valid CHECK (section IN ('algorithms','sql','go','system_design','behavioral'))
);

CREATE TABLE skill_nodes (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_key     TEXT NOT NULL,
    progress     INT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    unlocked_at  TIMESTAMPTZ,
    decayed_at   TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, node_key)
);

CREATE TABLE seasons (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    theme       TEXT,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    is_current  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX idx_seasons_one_current ON seasons(is_current) WHERE is_current;

CREATE TABLE season_progress (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id   UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    points      INT NOT NULL DEFAULT 0,
    tier        INT NOT NULL DEFAULT 0,
    is_premium  BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, season_id)
);

CREATE TABLE achievements (
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key  TEXT NOT NULL,
    earned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_key)
);

CREATE INDEX idx_ratings_section_elo ON ratings(section, elo DESC);
CREATE INDEX idx_skill_nodes_user ON skill_nodes(user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS achievements;
DROP TABLE IF EXISTS season_progress;
DROP TABLE IF EXISTS seasons;
DROP TABLE IF EXISTS skill_nodes;
DROP TABLE IF EXISTS ratings;
-- +goose StatementEnd
