-- +goose Up
-- +goose StatementBegin
-- season_reward_claims: устойчивое хранилище выданных наград сезона.
-- Раньше ClaimRepo жил in-memory (infra.memClaimStore). Это создавало
-- два класса багов:
--   1) при horizontal-scale API (2+ инстанса) состояние не шарится —
--      один и тот же tier можно было получить многократно, обратившись
--      к разным инстансам.
--   2) даже на одном инстансе ClaimReward.Do содержит TOCTOU между
--      шагами Get/CanClaim и MarkClaimed; mutex в map спасает только
--      в рамках процесса и только пока вызов идёт синхронно.
-- UNIQUE (user_id, season_id, kind, tier) + INSERT…ON CONFLICT
-- DO NOTHING гарантирует атомарную идемпотентность на уровне БД.
CREATE TABLE season_reward_claims (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id   UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    tier        INT  NOT NULL,
    claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT season_reward_claims_kind_valid CHECK (kind IN ('free','premium')),
    CONSTRAINT season_reward_claims_tier_positive CHECK (tier > 0),
    UNIQUE (user_id, season_id, kind, tier)
);

CREATE INDEX idx_season_reward_claims_user_season
    ON season_reward_claims (user_id, season_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS season_reward_claims;
-- +goose StatementEnd
