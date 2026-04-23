-- +goose Up
-- +goose StatementBegin

-- Phase 5: 2v2 (duo) match support.
--
-- The arena_participants.team column has existed since 00004 (default 0). We
-- now formally use it: 1v1 rows keep team=0, 2v2 rows store team=1 or
-- team=2. Constrain the column to those values and index (match_id, team)
-- so duo result lookups can scan participants of one side without a full
-- scan of the match.
--
-- arena_matches gains winning_team_id (NULL for 1v1 / draw / unfinished,
-- 1 or 2 for the finished duo match's victorious team). winner_id remains
-- used for 1v1 matches; the two columns are mutually exclusive in practice
-- but the schema does not enforce that — application code is the source
-- of truth.

ALTER TABLE arena_participants
    DROP CONSTRAINT IF EXISTS arena_participants_team_valid;
ALTER TABLE arena_participants
    ADD CONSTRAINT arena_participants_team_valid CHECK (team IN (0, 1, 2));

CREATE INDEX IF NOT EXISTS idx_arena_participants_match_team
    ON arena_participants(match_id, team);

ALTER TABLE arena_matches
    ADD COLUMN IF NOT EXISTS winning_team_id smallint;
ALTER TABLE arena_matches
    DROP CONSTRAINT IF EXISTS arena_matches_winning_team_valid;
ALTER TABLE arena_matches
    ADD CONSTRAINT arena_matches_winning_team_valid
    CHECK (winning_team_id IS NULL OR winning_team_id IN (1, 2));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE arena_matches DROP CONSTRAINT IF EXISTS arena_matches_winning_team_valid;
ALTER TABLE arena_matches DROP COLUMN IF EXISTS winning_team_id;

DROP INDEX IF EXISTS idx_arena_participants_match_team;
ALTER TABLE arena_participants DROP CONSTRAINT IF EXISTS arena_participants_team_valid;

-- +goose StatementEnd
