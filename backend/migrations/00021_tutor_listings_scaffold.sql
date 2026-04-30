-- +goose Up
-- +goose StatementBegin

-- 00021_tutor_listings_scaffold.sql
--
-- Wave 9.1 — Tutor marketplace через Boosty.
-- ВАЖНО: payment integration у нас ИСКЛЮЧИТЕЛЬНО Boosty. Никаких
-- ЮKassa SDK, никаких webhook handlers, никакого payment_events
-- table — Boosty сам владеет money flow, мы только маршрутизируем
-- студента на tutor's Boosty page.
--
-- Schema:
--   tutor_listings — public storefront row per tutor. Tutor может
--     иметь несколько listing'ов (например, English-track + dev-track).
--     Soft-archived через `archived_at`. `published_at IS NULL` =
--     draft.
--   tutor_listing_packages — pricing tiers per listing (1-on-1 hour /
--     pack-of-4 / monthly subscription и т.д.). Цена в kopecks (int)
--     для integer-only money math; UI рендерит в RUB.
--
-- `boosty_url` — единственный payment-related field. Публичная ссылка
-- на Boosty-страницу тутора; студент кликает «Subscribe» → Boosty
-- handles checkout/recurring billing/refunds. Мы только трекаем
-- появление relationship через существующий tutor_invites flow
-- (тутор отдаёт invite-код студенту after Boosty success).

CREATE TABLE IF NOT EXISTS tutor_listings (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Slug for the public marketplace URL `/tutors/{slug}`. Unique
    -- among published listings; allow collisions on archived rows so
    -- a tutor can re-publish under the same handle.
    slug          TEXT         NOT NULL,
    title         TEXT         NOT NULL,
    summary       TEXT         NOT NULL DEFAULT '',
    body_md       TEXT         NOT NULL DEFAULT '',
    -- Должен соответствовать одному из значений track_kind (см. baseline).
    track_kind    track_kind   NOT NULL,
    -- Languages the tutor teaches in.
    languages     TEXT[]       NOT NULL DEFAULT ARRAY['ru']::TEXT[],
    -- Per-hour rate в kopecks (1 RUB = 100 kopecks). UI рендерит в
    -- RUB at format-time; integer math everywhere до этой точки.
    hourly_rate_minor INT      NOT NULL CHECK (hourly_rate_minor > 0),
    currency      TEXT         NOT NULL DEFAULT 'RUB' CHECK (currency IN ('RUB','USD','EUR')),
    -- Boosty page URL для checkout. Required для published listings —
    -- проверяется на use-case уровне (publish UC отказывает на пустом
    -- boosty_url). Drafts могут быть без URL.
    boosty_url    TEXT         NOT NULL DEFAULT '',
    -- Soft-publish flag.
    published_at  TIMESTAMPTZ,
    archived_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT tutor_listings_title_nonempty CHECK (char_length(title) > 0),
    CONSTRAINT tutor_listings_slug_format CHECK (char_length(slug) BETWEEN 3 AND 64)
);

-- Marketplace search by track + price. Partial idx — published only.
CREATE INDEX IF NOT EXISTS idx_tutor_listings_published_track
    ON tutor_listings (track_kind, hourly_rate_minor)
    WHERE published_at IS NOT NULL AND archived_at IS NULL;

-- Unique slug only among visible (published, not archived) rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutor_listings_slug_published
    ON tutor_listings (slug)
    WHERE published_at IS NOT NULL AND archived_at IS NULL;

-- Per-tutor list (their own listings, all states).
CREATE INDEX IF NOT EXISTS idx_tutor_listings_tutor_created
    ON tutor_listings (tutor_id, created_at DESC);

-- ── Pricing packages ──
-- A package shows on the listing card as «4 hours · 4500 ₽» chip.

CREATE TABLE IF NOT EXISTS tutor_listing_packages (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id    UUID         NOT NULL REFERENCES tutor_listings(id) ON DELETE CASCADE,
    -- Free-form kind label ('single_hour' | 'pack_4' | 'pack_10' |
    -- 'monthly_unlimited' и т.д.) — use case validates whitelist.
    kind          TEXT         NOT NULL,
    hours         INT          NOT NULL CHECK (hours > 0 AND hours <= 100),
    price_minor   INT          NOT NULL CHECK (price_minor > 0),
    description   TEXT         NOT NULL DEFAULT '',
    archived_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tutor_listing_packages_listing
    ON tutor_listing_packages (listing_id, hours)
    WHERE archived_at IS NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SELECT 1;  -- additive scaffold; rollback drops the DB
-- +goose StatementEnd
