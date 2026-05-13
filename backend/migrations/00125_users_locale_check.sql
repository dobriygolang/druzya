-- 00125_users_locale_check.sql — Phase K Wave 16 (2026-05-14)
--
-- Phase K — i18n unification (web + Hone + Cue + backend LLM). users.locale
-- is the single source of truth for the user's preferred response language;
-- LLM callsites in copilot / ai_mock / intelligence / mock_interview / curation
-- read it and prepend a language directive as the first system message.
--
-- The Settings RPC already validates "ru|en" at the use-case layer, but a DB
-- CHECK is cheap defense-in-depth against direct SQL edits or back-ported
-- changes that forget the UC validation.
--
-- Existing rows are all "ru" (default since 00001_baseline) so the CHECK is
-- satisfied at apply time. No backfill needed.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE users
    ADD CONSTRAINT users_locale_valid
    CHECK (locale IN ('ru', 'en'));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_locale_valid;

-- +goose StatementEnd
