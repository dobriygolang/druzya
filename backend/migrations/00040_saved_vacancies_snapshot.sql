-- +goose Up
-- 00040 — pivot saved_vacancies to a self-contained snapshot model.
--
-- Phase 3 ships the parsed-postings catalogue as an in-process cache (no DB
-- table). The kanban must survive without that table, so each saved row now
-- carries a frozen JSONB copy of the vacancy as it looked at save time and
-- is keyed on the composite (user_id, source, external_id) — no FK to any
-- vacancies table (it's about to be dropped in 00041).
--
-- This migration is forward-only: any pre-existing rows are best-effort
-- backfilled from the legacy `vacancies` table; rows whose vacancy can't be
-- joined are dropped. The user accepted this trade — keeping a broken FK or
-- a half-populated kanban would be worse than honest data loss.

-- Drop old FK + UNIQUE if present (the legacy schema bound them to vacancies.id).
ALTER TABLE saved_vacancies
    DROP CONSTRAINT IF EXISTS saved_vacancies_vacancy_id_fkey;
ALTER TABLE saved_vacancies
    DROP CONSTRAINT IF EXISTS saved_vacancies_user_id_vacancy_id_key;

-- Add new identity + snapshot columns. We allow NULLs for backfill, then
-- enforce NOT NULL after either populating or pruning.
ALTER TABLE saved_vacancies
    ADD COLUMN IF NOT EXISTS source        TEXT,
    ADD COLUMN IF NOT EXISTS external_id   TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_json JSONB;

-- Best-effort backfill: copy source/external_id and freeze the current row
-- as the snapshot. Only runs if both legacy table and FK column still exist.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'saved_vacancies' AND column_name = 'vacancy_id')
       AND EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_name = 'vacancies') THEN
        UPDATE saved_vacancies s
           SET source        = v.source,
               external_id   = v.external_id,
               snapshot_json = to_jsonb(v.*)
          FROM vacancies v
         WHERE v.id = s.vacancy_id;

        -- Anything that didn't backfill (vacancy row missing) is honest data
        -- loss — better than carrying a row with no payload.
        DELETE FROM saved_vacancies WHERE source IS NULL OR external_id IS NULL OR snapshot_json IS NULL;

        ALTER TABLE saved_vacancies DROP COLUMN vacancy_id;
    END IF;
END$$;

-- Lock down the new identity columns now that backfill (if any) is done.
ALTER TABLE saved_vacancies
    ALTER COLUMN source SET NOT NULL,
    ALTER COLUMN external_id SET NOT NULL,
    ALTER COLUMN snapshot_json SET NOT NULL;

-- Composite uniqueness — one kanban row per (user, posting).
ALTER TABLE saved_vacancies
    ADD CONSTRAINT saved_vacancies_user_source_extid_key
    UNIQUE (user_id, source, external_id);

CREATE INDEX IF NOT EXISTS idx_saved_vacancies_user_source_extid
    ON saved_vacancies (user_id, source, external_id);

-- +goose Down
-- Forward-only — Phase 3 dropped the parsed catalogue entirely; there is no
-- meaningful inverse. Re-creating the FK would point at a table we're about
-- to drop in 00041. Down is intentionally a no-op.
SELECT 1;
