-- 00026_intelligence.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Intelligence (AI-coach) service. Owns ровно одну таблицу — кеш дневных
-- брифов. Сервис READS из hone_* (focus / plan / notes), WRITES только
-- сюда, чтобы bounded-context Hone оставался single-writer.
-- ────────────────────────────────────────────────────────────────────────────

-- +goose Up
-- +goose StatementBegin

CREATE TABLE hone_daily_briefs (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brief_date   date        NOT NULL,
    payload      jsonb       NOT NULL,
    generated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, brief_date)
);

-- Покрывает лукап «брифа за дату» + «последний бриф юзера».
CREATE INDEX idx_hone_daily_briefs_user ON hone_daily_briefs (user_id, brief_date DESC);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS hone_daily_briefs;
-- +goose StatementEnd
