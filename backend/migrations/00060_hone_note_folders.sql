-- 00060_hone_note_folders.sql
-- Adds folder support to Hone notes.
-- Folders are user-private, optionally nested via parent_id (self-referential FK).
-- hone_notes gets a nullable folder_id FK.

-- +goose Up

-- ── Folder table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hone_note_folders (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
    parent_id  uuid        REFERENCES hone_note_folders(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hone_note_folders_user ON hone_note_folders(user_id);

-- ── Add folder_id to notes ──────────────────────────────────────────────────

ALTER TABLE hone_notes
    ADD COLUMN IF NOT EXISTS folder_id uuid
        REFERENCES hone_note_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hone_notes_folder ON hone_notes(folder_id)
    WHERE folder_id IS NOT NULL;

-- +goose Down

DROP INDEX IF EXISTS idx_hone_notes_folder;
ALTER TABLE hone_notes DROP COLUMN IF EXISTS folder_id;
DROP INDEX IF EXISTS idx_hone_note_folders_user;
DROP TABLE IF EXISTS hone_note_folders;
