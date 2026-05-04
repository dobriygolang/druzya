-- 00037_external_activity.sql — External activity logging (Hone Stats).
--
-- Юзер обучается не только в druz9: LeetCode, Coursera, YouTube, книги.
-- Чтобы intelligence-service мог учитывать это в snapshot'ах + чтобы
-- AI-tutor имел recall, мы храним structured-форм-логи в этой таблице.
--
-- Source — closed enum внутри domain (см services/hone/domain/external.go),
-- но на стороне БД оставляем text + CHECK ради простоты миграций.
--
-- topic_atlas_node_id — nullable: если юзер выбрал atlas-узел в form'е
-- (autocomplete), персистим FK; если ввёл свободный текст или topic не
-- ложится на атлас — оставляем NULL и используем topic_free_text.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS external_activity (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source              TEXT NOT NULL
        CHECK (source IN ('leetcode','coursera','hackerrank','youtube','book','article','course','other')),
    topic_atlas_node_id TEXT REFERENCES atlas_nodes(id) ON DELETE SET NULL,
    topic_free_text     TEXT NOT NULL DEFAULT '',
    duration_min        INT  NOT NULL CHECK (duration_min > 0 AND duration_min <= 600),
    notes               TEXT NOT NULL DEFAULT '',
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_external_activity_user_date
    ON external_activity (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_activity_user_source_date
    ON external_activity (user_id, source, occurred_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS external_activity;
-- +goose StatementEnd
