-- +goose Up
-- +goose StatementBegin
--
-- 00053 — copilot_session_reports: add structured analysis columns.
--
-- The v1 analyzer returned only (overall_score, section_scores, weaknesses,
-- recommendations, report_markdown). That gave us a score card but no
-- first-class hooks for the Cluely-style Session Summary view the desktop
-- wants to render (action items, terminology glossary, key decisions,
-- token/cost usage).
--
-- `analysis` — JSONB blob with the full structured breakdown. We keep it
-- as a single blob rather than a dozen JSONB columns because: (a) the
-- shape is still evolving and denormalising every sub-list to its own
-- table would be churn for no gain yet; (b) the desktop renderer reads
-- the whole thing at once anyway. When a sub-list graduates to something
-- we query on (e.g. "show me all open questions from sessions this week"),
-- we'll pull it out then.
--
-- `title` — human-readable session title, derived by the analyzer from
-- the transcript ("Sorting at scale · leader-follower"). Rendered in the
-- Summary header + history list. Denormalised so the history list
-- doesn't need to join analysis blobs.
--
-- Both are nullable with empty defaults so old reports keep rendering —
-- the client treats missing fields as "not available, hide the section".

ALTER TABLE copilot_session_reports
    ADD COLUMN analysis JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN title    TEXT  NOT NULL DEFAULT '';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE copilot_session_reports
    DROP COLUMN IF EXISTS analysis,
    DROP COLUMN IF EXISTS title;
-- +goose StatementEnd
