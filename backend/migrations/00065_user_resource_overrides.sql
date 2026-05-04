-- 00065_user_resource_overrides.sql — Phase 3.5 personal resource library.
--
-- См docs/feature/implementation-plan.md §3.5a.
--
-- Tables:
--   * user_resource_overrides — per-user mutations над curated списком
--     ресурсов (added/hidden/replaced/reordered/unhelpful). ApplyOverrides
--     UC мерджит curated.external_resources с этими записями.
--   * resource_promotion_signals — aggregated signal для auto-promote
--     algorithm. Upsert при add/finish/quality, daily cron-producer
--     `auto_promote.go` читает строки с user_count ≥ 5 + avg_quality ≥ 0.7.
--   * domain_reputation — spam protection. unhelpful_count bump на
--     mark-unhelpful; blocked=true → auto-promote skip.
--
-- Также extend user_resource_log (00055) — Phase 3.5 multi-takeaway
-- reflection adds reflection_takeaways/quality/extracted_topics/confusion.
--
-- Naming: следуем 00055 паттерну — TEXT + CHECK вместо ENUM (лучше
-- эволюционирует, см комментарий в 00055).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE user_resource_overrides (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- target — atlas-node ИЛИ track-step. step хранится как (track_id, step_index)
    -- — у track_steps composite PK без UUID. Хотя бы один target должен быть.
    atlas_node_id     TEXT        NULL REFERENCES atlas_nodes(id) ON DELETE CASCADE,
    step_track_id     UUID        NULL,
    step_index        SMALLINT    NULL,
    url               TEXT        NOT NULL,
    action            TEXT        NOT NULL,
    -- payload shape per action:
    --   added:    full Resource jsonb (см docs Schema implication)
    --   hidden:   {} (no payload)
    --   replaced: {original_url: text, reason: text}
    --   reordered:{prev_index: int, next_index: int}
    --   unhelpful:{reason: text}
    payload           JSONB       NOT NULL DEFAULT '{}',
    auto_promoted_at  TIMESTAMPTZ NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_resource_overrides_action_valid
        CHECK (action IN ('added','hidden','replaced','reordered','unhelpful')),
    CONSTRAINT user_resource_overrides_target
        CHECK (atlas_node_id IS NOT NULL OR (step_track_id IS NOT NULL AND step_index IS NOT NULL)),
    CONSTRAINT user_resource_overrides_step_pair
        CHECK ((step_track_id IS NULL) = (step_index IS NULL))
);
CREATE INDEX user_resource_overrides_lookup
    ON user_resource_overrides(user_id, atlas_node_id, step_track_id, step_index);
-- Uniqueness: один (user, target, url, action) — but NULLS DISTINCT default
-- в pg ≥ 15 нам не нужен (NULLs in target дают коллизию). Используем
-- partial unique для node-target и step-target отдельно.
CREATE UNIQUE INDEX user_resource_overrides_uniq_node
    ON user_resource_overrides(user_id, atlas_node_id, url, action)
    WHERE atlas_node_id IS NOT NULL;
CREATE UNIQUE INDEX user_resource_overrides_uniq_step
    ON user_resource_overrides(user_id, step_track_id, step_index, url, action)
    WHERE step_track_id IS NOT NULL;

-- Promotion signals — primary key URL (одна строка на ресурс глобально,
-- независимо от того сколько раз добавлен). atlas_node_id — primary
-- target для promote'а; если ресурс добавляется к разным узлам — берём
-- первый (можно потом сделать per-node row, но MVP — последний-wins).
CREATE TABLE resource_promotion_signals (
    url                 TEXT        PRIMARY KEY,
    atlas_node_id       TEXT        NOT NULL REFERENCES atlas_nodes(id) ON DELETE CASCADE,
    user_count          INT         NOT NULL DEFAULT 0,
    avg_quality         REAL        NULL,
    last_user_added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    promoted_at         TIMESTAMPTZ NULL,
    blocked_reason      TEXT        NULL
);
CREATE INDEX resource_promotion_signals_promote_candidates
    ON resource_promotion_signals(user_count, avg_quality)
    WHERE promoted_at IS NULL;

-- Spam protection. Domain — host из URL (lowercased). Auto-promote
-- skip'ает domains с blocked=true.
CREATE TABLE domain_reputation (
    domain            TEXT        PRIMARY KEY,
    reports_count     INT         NOT NULL DEFAULT 0,
    unhelpful_count   INT         NOT NULL DEFAULT 0,
    blocked           BOOLEAN     NOT NULL DEFAULT FALSE,
    last_seen         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extend user_resource_log с Phase 3.5 reflection-grade полями.
-- 00055 уже создал reflection_text + reflection_note_id; добавляем
-- structured takeaways + LLM-grade output.
ALTER TABLE user_resource_log
    ADD COLUMN reflection_takeaways      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN reflection_quality_score  REAL         NULL,
    ADD COLUMN extracted_topics          TEXT[]       NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN confusion_flag            BOOLEAN      NOT NULL DEFAULT FALSE;

-- Index для confusion_pickup producer (daily scan).
CREATE INDEX idx_user_resource_log_confusion
    ON user_resource_log(user_id, occurred_at DESC)
    WHERE confusion_flag = TRUE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_resource_log_confusion;
ALTER TABLE user_resource_log
    DROP COLUMN IF EXISTS confusion_flag,
    DROP COLUMN IF EXISTS extracted_topics,
    DROP COLUMN IF EXISTS reflection_quality_score,
    DROP COLUMN IF EXISTS reflection_takeaways;
DROP TABLE IF EXISTS domain_reputation;
DROP TABLE IF EXISTS resource_promotion_signals;
DROP TABLE IF EXISTS user_resource_overrides;
-- +goose StatementEnd
