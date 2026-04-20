-- +goose Up
-- +goose StatementBegin
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT,
    role            TEXT NOT NULL DEFAULT 'user',
    locale          TEXT NOT NULL DEFAULT 'ru',
    display_name    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_role_valid CHECK (role IN ('user','interviewer','admin'))
);

CREATE TABLE oauth_accounts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider           TEXT NOT NULL,
    provider_user_id   TEXT NOT NULL,
    access_token_enc   BYTEA,
    refresh_token_enc  BYTEA,
    token_expires_at   TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT oauth_provider_valid CHECK (provider IN ('yandex','telegram')),
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE profiles (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    char_class    TEXT NOT NULL DEFAULT 'novice',
    level         INT NOT NULL DEFAULT 1,
    xp            BIGINT NOT NULL DEFAULT 0,
    title         TEXT,
    avatar_frame  TEXT,
    career_stage  TEXT NOT NULL DEFAULT 'junior',
    intellect     INT NOT NULL DEFAULT 0,
    strength      INT NOT NULL DEFAULT 0,
    dexterity     INT NOT NULL DEFAULT 0,
    will          INT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT char_class_valid CHECK (char_class IN ('novice','algorithmist','dba','backend_dev','architect','communicator','ascendant')),
    CONSTRAINT career_stage_valid CHECK (career_stage IN ('junior','middle','senior','staff','principal'))
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS oauth_accounts;
DROP TABLE IF EXISTS users;
-- +goose StatementEnd
