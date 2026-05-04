-- 00064_user_atlas_node_prefs.sql — Phase 3 (Atlas customization · 2026-05-04).
--
-- Per-user pin/hide overlay над atlas_nodes (curated + user_atlas_nodes).
-- Pin → узел показывается на ribbon в /atlas, hidden → скрывается из канваса
-- но остаётся в DB (юзер может его «вернуть» через ribbon).
--
-- Composite PK (user_id, node_key) — node_key текстовый чтобы покрывать
-- и curated keys ('ml_classical') и user_atlas slug'и (иногда uuid'ы).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE user_atlas_node_prefs (
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_key   TEXT         NOT NULL,
    pinned     BOOLEAN      NOT NULL DEFAULT FALSE,
    hidden     BOOLEAN      NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, node_key),
    CONSTRAINT user_atlas_node_prefs_no_pin_and_hide
        CHECK (NOT (pinned AND hidden))
);

CREATE INDEX idx_user_atlas_node_prefs_pinned
    ON user_atlas_node_prefs (user_id)
    WHERE pinned;

CREATE INDEX idx_user_atlas_node_prefs_hidden
    ON user_atlas_node_prefs (user_id)
    WHERE hidden;

COMMENT ON TABLE user_atlas_node_prefs IS 'Per-user overlay над atlas: pin/hide actions per-card. Phase 3 (2026-05-04).';
COMMENT ON COLUMN user_atlas_node_prefs.node_key IS 'Matches atlas_nodes.id или user_atlas_nodes.node_key (text key, не uuid).';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS user_atlas_node_prefs;
-- +goose StatementEnd
