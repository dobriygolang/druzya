-- 00044_user_atlas_nodes.sql — User-driven atlas nodes (Phase 3.1).
--
-- Sergey 2026-05-03: «Например сейчас изучаю ml и ии сам подхватывает
-- это, дополняет атлас. Возможно при выборе трека спрашивает по какому
-- пути хочешь пойти (готовый атлас) либо пользователь сам себе
-- назначает трек».
--
-- Семантика:
--   - Юзер пишет TODO («изучить транзакции в Postgres») → AI-классификатор
--     (TaskAtlasClassify в llmchain) предлагает existing atlas_node_key
--     ИЛИ создаёт новый user_atlas_nodes row с подбором section + cluster.
--   - На /atlas сливаются curated atlas_nodes + user_atlas_nodes текущего
--     юзера (helper view материализуется в read-time merge на стороне
--     profile.GetAtlas — без storage view, чтобы CRUD оставался простым).
--
-- Поля повторяют форму catalogueNode (см. profile/app/atlas.go), плюс
-- user_id для row-level scope. source_text — оригинальный TODO/free-form
-- input для аудита (юзер всегда может вспомнить, откуда узел взялся).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS user_atlas_nodes (
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_key     TEXT         NOT NULL,
    title        TEXT         NOT NULL,
    description  TEXT         NOT NULL DEFAULT '',
    section      TEXT         NOT NULL,         -- enums.Section value
    kind         TEXT         NOT NULL DEFAULT 'small',
    cluster      TEXT         NOT NULL DEFAULT 'custom',
    source_text  TEXT         NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, node_key),
    CHECK (kind IN ('hub','keystone','notable','small'))
);

CREATE INDEX IF NOT EXISTS user_atlas_nodes_user_idx
    ON user_atlas_nodes (user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_atlas_nodes;
-- +goose StatementEnd
