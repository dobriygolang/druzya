-- +goose Up
-- +goose StatementBegin
--
-- Allow cohort disband (captain leaves a sole-member cohort → cohort row deleted).
--
-- Original constraint cohort_wars.winner_id REFERENCES cohorts(id) had no
-- ON DELETE clause (defaults to NO ACTION), which blocks the disband flow if
-- the cohort had ever won a war on a row that hadn't yet been cascaded
-- through cohort_a_id/cohort_b_id (e.g. an old war whose other participant is
-- still alive).
--
-- We switch to ON DELETE SET NULL — historical wars stay intact (week dates,
-- score JSONB) but their winner pointer becomes NULL when the winning cohort
-- is disbanded. The companion cohort_a_id/cohort_b_id columns retain their
-- existing ON DELETE CASCADE behaviour (00005), so cross-participant rows
-- still vanish along with the cohort.
ALTER TABLE cohort_wars
    DROP CONSTRAINT IF EXISTS cohort_wars_winner_id_fkey;

ALTER TABLE cohort_wars
    ADD CONSTRAINT cohort_wars_winner_id_fkey
    FOREIGN KEY (winner_id) REFERENCES cohorts(id) ON DELETE SET NULL;

-- cohorts.owner_id was ON DELETE RESTRICT in 00005 — that's correct for the
-- user-deletion path (don't orphan a cohort when its owner deletes their
-- account) and is unrelated to the captain-leave-disband path (we delete the
-- cohort explicitly, not the owner).
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE cohort_wars
    DROP CONSTRAINT IF EXISTS cohort_wars_winner_id_fkey;

ALTER TABLE cohort_wars
    ADD CONSTRAINT cohort_wars_winner_id_fkey
    FOREIGN KEY (winner_id) REFERENCES cohorts(id);
-- +goose StatementEnd
