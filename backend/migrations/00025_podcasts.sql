-- +goose Up
-- +goose StatementBegin
--
-- 00025 — Podcasts CMS:
--   - Promote `podcasts` from a hard-coded /podcast list (see 00006) to a
--     proper CMS surface backed by MinIO object storage.
--   - Add `podcast_categories` so curators (and the admin UI) define
--     taxonomy at runtime instead of editing the legacy `Section` enum.
--   - Add CMS metadata columns to `podcasts` (host, category_id,
--     episode_num, cover_url, published_at). All NULLable so existing rows
--     and the legacy /podcast Connect handler keep working.
--   - Seed five default categories matching the user-facing wishlist:
--     System Design, Algorithms, Career, Behavioral, Languages.

CREATE TABLE podcast_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#6c7af0',
    sort_order  INT  NOT NULL DEFAULT 100,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default seed. UUIDs are deterministic-stable via slug uniqueness; the
-- CMS surface uses id as the foreign key on the podcast row, so we resolve
-- by slug at the app layer when the curator submits a string.
INSERT INTO podcast_categories (slug, name, color, sort_order) VALUES
    ('system-design', 'System Design', '#7c5cff', 10),
    ('algorithms',    'Algorithms',    '#22c55e', 20),
    ('career',        'Career',        '#f59e0b', 30),
    ('behavioral',    'Behavioral',    '#ec4899', 40),
    ('languages',     'Languages',     '#06b6d4', 50);

-- Extend the legacy podcasts table with CMS metadata. We do NOT drop the
-- existing `section` column — the legacy ListCatalog handler still reads
-- it. The new CMS endpoints prefer category_id when present and fall
-- back to section otherwise.
ALTER TABLE podcasts
    ADD COLUMN IF NOT EXISTS host          TEXT,
    ADD COLUMN IF NOT EXISTS category_id   UUID REFERENCES podcast_categories(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS episode_num   INT,
    ADD COLUMN IF NOT EXISTS cover_url     TEXT,
    ADD COLUMN IF NOT EXISTS published_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_podcasts_category_id ON podcasts(category_id);
CREATE INDEX IF NOT EXISTS idx_podcasts_published_at ON podcasts(published_at DESC NULLS LAST);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_podcasts_published_at;
DROP INDEX IF EXISTS idx_podcasts_category_id;
ALTER TABLE podcasts
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS published_at,
    DROP COLUMN IF EXISTS cover_url,
    DROP COLUMN IF EXISTS episode_num,
    DROP COLUMN IF EXISTS category_id,
    DROP COLUMN IF EXISTS host;
DROP TABLE IF EXISTS podcast_categories;
-- +goose StatementEnd
