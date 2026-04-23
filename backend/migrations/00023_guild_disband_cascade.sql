-- +goose Up
-- +goose StatementBegin
--
-- Allow guild disband (captain leaves a sole-member guild → guild row deleted).
--
-- Original constraint guild_wars.winner_id REFERENCES guilds(id) had no
-- ON DELETE clause (defaults to NO ACTION), which blocks the disband flow if
-- the guild had ever won a war on a row that hadn't yet been cascaded
-- through guild_a_id/guild_b_id (e.g. an old war whose other participant is
-- still alive).
--
-- We switch to ON DELETE SET NULL — historical wars stay intact (week dates,
-- score JSONB) but their winner pointer becomes NULL when the winning guild
-- is disbanded. The companion guild_a_id/guild_b_id columns retain their
-- existing ON DELETE CASCADE behaviour (00005), so cross-participant rows
-- still vanish along with the guild.
ALTER TABLE guild_wars
    DROP CONSTRAINT IF EXISTS guild_wars_winner_id_fkey;

ALTER TABLE guild_wars
    ADD CONSTRAINT guild_wars_winner_id_fkey
    FOREIGN KEY (winner_id) REFERENCES guilds(id) ON DELETE SET NULL;

-- guilds.owner_id was ON DELETE RESTRICT in 00005 — that's correct for the
-- user-deletion path (don't orphan a guild when its owner deletes their
-- account) and is unrelated to the captain-leave-disband path (we delete the
-- guild explicitly, not the owner).
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE guild_wars
    DROP CONSTRAINT IF EXISTS guild_wars_winner_id_fkey;

ALTER TABLE guild_wars
    ADD CONSTRAINT guild_wars_winner_id_fkey
    FOREIGN KEY (winner_id) REFERENCES guilds(id);
-- +goose StatementEnd
