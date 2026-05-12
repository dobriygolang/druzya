-- 00083_resource_promotion_deprecate.sql — F6 auto-promote daemon.
--
-- Adds deprecation surface to resource_promotion_signals so the cron
-- daemon can downgrade once-promoted (or never-promoted but persistently
-- low-quality) resources symmetrically with the promote path.
--
-- Semantics:
--   * promoted_at  IS NOT NULL  → live in catalogue (atlas_nodes.external_resources)
--   * deprecated_at IS NOT NULL → downgrade (catalogue filter excludes)
--   * blocked_reason IS NOT NULL → never promote (spam / manual block)
--
-- deprecated_at + deprecated_reason live separately from blocked_reason:
-- blocked = "never promote (spam)", deprecated = "was OK, signal turned
-- bad". Apply UC can still surface deprecated resources с visual flag.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE resource_promotion_signals
    ADD COLUMN deprecated_at     TIMESTAMPTZ NULL,
    ADD COLUMN deprecated_reason TEXT        NULL;

-- Partial index for the deprecate-scan cron: candidates are rows with
-- enough signal but low avg_quality and not already deprecated.
CREATE INDEX resource_promotion_signals_deprecate_candidates
    ON resource_promotion_signals(user_count, avg_quality)
    WHERE deprecated_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS resource_promotion_signals_deprecate_candidates;
ALTER TABLE resource_promotion_signals
    DROP COLUMN IF EXISTS deprecated_reason,
    DROP COLUMN IF EXISTS deprecated_at;

-- +goose StatementEnd
