-- 00042_hone_english_active.sql — English как orthogonal modifier.
--
-- Sergey 2026-05-03: «English — не альтернатива dev/ml, а дополнение».
-- Юзер целящийся в Booking хочет одновременно: senior Go prep + English HR
-- + speaking practice. До этого English был отдельным track-mode'ом, что
-- делало это или/или. Сейчас — boolean toggle.
--
-- Default false: новые юзеры не видят English surfaces в Hone (Reading /
-- Writing / Listening / English mocks). Чтобы включить — toggle на /profile
-- или onboarding step.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE hone_user_settings
    ADD COLUMN IF NOT EXISTS english_active BOOLEAN NOT NULL DEFAULT FALSE;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE hone_user_settings DROP COLUMN IF EXISTS english_active;
-- +goose StatementEnd
