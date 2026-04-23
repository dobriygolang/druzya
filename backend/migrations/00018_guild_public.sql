-- 00018_guild_public.sql — extends `guilds` with public-discovery fields and
-- the join policy needed by the /guild list + join flow (Wave 3).
--
-- Wave 2 used migrations 00014..00017; this lands the next in sequence.
--
-- Columns added:
--   description    — free-form one-liner shown on the public guild card
--   tier           — categorical bracket ("bronze" | "silver" | ... | "master").
--                    Driven server-side from guild_elo so the UI can filter
--                    without a join. Optional (NULL during transition).
--   is_public      — TRUE means the guild is listed in /api/v1/guild/list
--                    and can be joined by anyone (subject to join_policy).
--                    Existing rows default to TRUE (legacy guilds were
--                    discoverable via the leaderboard already).
--   join_policy    — 'open'   → POST /join admits the user instantly
--                    'invite' → POST /join records a pending request
--                    'closed' → /join is rejected outright
--   max_members    — soft cap applied at /join time. 25 mirrors the bible
--                    default; admins can raise it later.
--
-- The fields are nullable / defaulted so the migration is backwards-compatible
-- with rows inserted by tests and earlier seeds.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE guilds
    ADD COLUMN IF NOT EXISTS description  TEXT,
    ADD COLUMN IF NOT EXISTS tier         TEXT,
    ADD COLUMN IF NOT EXISTS is_public    BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS join_policy  TEXT NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS max_members  INT  NOT NULL DEFAULT 25;

ALTER TABLE guilds
    ADD CONSTRAINT guilds_join_policy_valid
        CHECK (join_policy IN ('open', 'invite', 'closed'));

ALTER TABLE guilds
    ADD CONSTRAINT guilds_tier_valid
        CHECK (tier IS NULL OR tier IN ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'master'));

CREATE INDEX IF NOT EXISTS idx_guilds_is_public_elo
    ON guilds(is_public, guild_elo DESC)
    WHERE is_public = TRUE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_guilds_is_public_elo;
ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_tier_valid;
ALTER TABLE guilds DROP CONSTRAINT IF EXISTS guilds_join_policy_valid;
ALTER TABLE guilds
    DROP COLUMN IF EXISTS max_members,
    DROP COLUMN IF EXISTS join_policy,
    DROP COLUMN IF EXISTS is_public,
    DROP COLUMN IF EXISTS tier,
    DROP COLUMN IF EXISTS description;
-- +goose StatementEnd
