-- +goose Up
-- +goose StatementBegin
-- M3 (2026-04): связка между druz9-user и его аккаунтом у стороннего
-- payment-провайдера (boosty, yookassa, tbank). Отдельная таблица (не в
-- subscriptions) потому что:
--   (1) провайдеров может быть несколько на одного юзера (кроссплатформенный
--       MVP: boosty для РФ, stripe для международки — PK (user_id, provider)).
--   (2) external_id != provider_sub_id в subscriptions: first — человеческий
--       handle (username/email), second — id конкретной подписки у провайдера.
--       link может существовать даже без active-subscription (юзер ввёл свой
--       boosty_username заранее, подписку оформит потом — sync подхватит).
CREATE TABLE provider_links (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL,
    external_id    TEXT NOT NULL,         -- username у Boosty, email у ЮKassa и т.д.
    external_tier  TEXT,                  -- сырое имя tier'а у провайдера (на момент last sync)
    verified_at    TIMESTAMPTZ,           -- null пока sync не подтвердил активную подписку
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, provider),
    CONSTRAINT provider_links_provider_valid
        CHECK (provider IN ('boosty','yookassa','tbank'))
);

-- Reverse lookup при sync: Boosty отдаёт список subscriber'ов с их username,
-- нужно резолвить в user_id. UNIQUE(provider, external_id) защищает от
-- случая "два druz9-юзера заявили один и тот же boosty_username" — второй
-- link получит constraint violation, sync корректно зальёт tier только
-- первому.
CREATE UNIQUE INDEX idx_provider_links_external
    ON provider_links (provider, external_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_provider_links_external;
DROP TABLE IF EXISTS provider_links;
-- +goose StatementEnd
