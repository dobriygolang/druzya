-- +goose Up
-- +goose StatementBegin
-- M-ann: per-cohort announcement feed. Owner/coach posts → all members
-- read; reactions are emoji + 1-per-user-per-emoji.
CREATE TABLE cohort_announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id   UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    pinned      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cohort_announcements_cohort_created
    ON cohort_announcements(cohort_id, pinned DESC, created_at DESC);

CREATE TABLE cohort_announcement_reactions (
    announcement_id UUID NOT NULL REFERENCES cohort_announcements(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (announcement_id, user_id, emoji),
    -- Constrain to a small set of safe single-codepoint emoji at the
    -- migration level; app layer also validates so a typo in either
    -- place doesn't silently corrupt the table.
    CONSTRAINT cohort_announcement_reactions_emoji_valid
        CHECK (emoji IN ('🔥', '👍', '❤️', '🎉', '🤔', '👀'))
);

CREATE INDEX idx_cohort_announcement_reactions_ann
    ON cohort_announcement_reactions(announcement_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_cohort_announcement_reactions_ann;
DROP TABLE IF EXISTS cohort_announcement_reactions;
DROP INDEX IF EXISTS idx_cohort_announcements_cohort_created;
DROP TABLE IF EXISTS cohort_announcements;
-- +goose StatementEnd
