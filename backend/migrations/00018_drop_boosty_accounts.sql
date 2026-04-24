-- +goose Up
-- +goose StatementBegin
-- M0 (2026-04) чистка legacy billing перед внедрением централизованного
-- subscription-сервиса. `boosty_accounts` хранила связку user_id ↔ boosty_username
-- но никогда не имела runtime-наполнения (ни клиента, ни webhook'а, ни
-- polling'а). Будет заменена полноценной связкой `provider_accounts`
-- (многопровайдерная: boosty / yookassa / tbank) в отдельной миграции
-- при введении subscription-сервиса.
--
-- subscriptions и ai_credits остаются — используются profile/ai_mock/ai_native,
-- будут переработаны когда subscription-сервис возьмёт их под себя.
DROP TABLE IF EXISTS boosty_accounts;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Восстановление формы 00008 — на случай роллбэка. Данных нет, так что
-- down безопасен.
CREATE TABLE boosty_accounts (
    user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    boosty_username   TEXT NOT NULL,
    verified_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- +goose StatementEnd
