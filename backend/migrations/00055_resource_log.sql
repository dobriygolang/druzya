-- 00055_resource_log.sql — Phase 1.7c из docs/feature/implementation-plan.md.
--
-- user_resource_log — событийная таблица взаимодействий юзера с external
-- resources (clicks / finished / skipped / marked unhelpful / submitted
-- reflection). Источник для:
--   * intelligence/infra/cross_readers.go::ResourceEngagementReader
--     (RecentlyTouched / UnfinishedCount / MarkedUnhelpful / RecentReflections)
--   * intelligence/app/producers/resource_engagement.go (daily insights)
--   * Hone Stats UI «recent activity» (Phase 4)
--
-- Reflection auto-link flow (Phase 5):
--   1. После core resource UI открывает 1-line reflection-modal
--   2. Submit создаёт hone_notes row через services/hone (title="reflection · …")
--   3. Здесь записываем reflection_text + reflection_note_id (FK на hone_notes)
--   4. TaskReflectionExtract читает reflection_text + Resource.topics_covered
--      → возвращает atlas-node mentions → notes auto-linked
--
-- Schema decisions:
--   * resource_url хранится строкой, не FK. external_resources jsonb не имеет
--     PK — мы ranking-proxy, ссылки могут rotate / pause без блокировок log'а.
--   * atlas_node_id NULL допустим — иногда юзер кликает ресурс из daily-brief
--     не привязанного к ноде (e.g. cross-cluster recommendation).
--   * kind как text + CHECK — enum типы Postgres плохо эволюционируют, а нам
--     возможно понадобится «paused», «forwarded», «added_to_taskboard» позже.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE user_resource_log (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource_url        TEXT         NOT NULL,
    atlas_node_id       TEXT         NULL REFERENCES atlas_nodes(id) ON DELETE SET NULL,
    kind                TEXT         NOT NULL,
    occurred_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Reflection auto-link flow (Phase 5).
    reflection_text     TEXT         NULL,
    reflection_note_id  UUID         NULL REFERENCES hone_notes(id) ON DELETE SET NULL,

    CONSTRAINT user_resource_log_kind_valid
        CHECK (kind IN ('clicked', 'finished', 'skipped', 'unhelpful', 'reflection_submitted')),

    -- Reflection-only invariant: text без note_id допустим (Note-create
    -- может упасть retry'ить позже), но note_id без text — bug.
    CONSTRAINT user_resource_log_reflection_pair
        CHECK (reflection_note_id IS NULL OR reflection_text IS NOT NULL)
);

-- Recent-activity lookup для daily-brief / Hone Stats UI.
CREATE INDEX idx_user_resource_log_user_recent
    ON user_resource_log (user_id, occurred_at DESC);

-- Per-resource histogram (analytics + admin curation review tab Phase 12.5):
-- «сколько раз ресурс X кликнули / finished / unhelpful по всем юзерам».
CREATE INDEX idx_user_resource_log_url_kind
    ON user_resource_log (resource_url, kind);

-- Per-node engagement reader.
CREATE INDEX idx_user_resource_log_node_kind
    ON user_resource_log (atlas_node_id, kind, occurred_at DESC)
    WHERE atlas_node_id IS NOT NULL;

-- Reflection lookup для TaskReflectionExtract / RecentReflections reader.
CREATE INDEX idx_user_resource_log_reflections
    ON user_resource_log (user_id, occurred_at DESC)
    WHERE kind = 'reflection_submitted';

COMMENT ON TABLE  user_resource_log                IS 'Per-event log of user interactions with external (curated) resources. Source for ResourceEngagementReader + reflection auto-link flow.';
COMMENT ON COLUMN user_resource_log.kind           IS 'clicked = opened url; finished = marked complete; skipped = explicitly dismissed; unhelpful = marked bad; reflection_submitted = wrote 1-line reflection after core resource.';
COMMENT ON COLUMN user_resource_log.reflection_text IS '1-line user takeaway (kind=reflection_submitted). Input для TaskReflectionExtract вместе с Resource.topics_covered.';
COMMENT ON COLUMN user_resource_log.reflection_note_id IS 'FK на hone_notes — auto-created при reflection-submission. NULL допустим если Note-create отложен/упал; UC retry-job создаст связь позже.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_resource_log;
-- +goose StatementEnd
