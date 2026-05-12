-- 00085_drop_rpg_leftovers.sql — D8 cleanup of RPG/arena/social leftovers.
--
-- Pivot 2026-05-01 removed arena/lobby/slot/rating/review/events; subsequent
-- waves (00029, 00034, 00067, 00074-82) cleaned the bulk. Survivors that
-- escaped earlier sweeps:
--
--   1. `friendships` + `friend_codes` — social-layer tables from the
--      community/friends bounded context. No service imports them (grep
--      across services/ + shared/ returns zero hits, 2026-05-12). The
--      identity rewrite (memory/project_state.md) moved social to TG
--      circles + tutor_events; classic friend-request flow is dead.
--
--   2. `track_step_kind` enum — still carries the 'arena' value. Arena
--      itself dropped in 00029, but the deferred TODO at the bottom of
--      00029 noted that ALTER TYPE … DROP VALUE is unsupported by Postgres
--      and needs a CREATE TYPE rebuild. We do that here.
--      Affected: `track_steps.required_kind` column (and downstream sqlc
--      models in 8+ services). The seed in 00027 inserted 3 step rows
--      with required_kind='arena' (algorithms-full-cycle/5, senior-
--      backend-pack/3, mock-marathon-7/2) — we remap those to 'mock'
--      before the rebuild so the cast doesn't fail on dirty data.
--
--   3. `llm_models.use_for_arena` — admin filter flag for arena-tier
--      model selection. Arena gone since 00029, but the column survived
--      because admin code (services/admin/infra/ai_models_repo.go) and
--      proto messages (shared/generated/pb/druz9/v1/ai_models.pb.go)
--      still scan it. **NOT dropped here** — needs synchronized Go +
--      proto cleanup first to avoid breaking the build. Tracked in the
--      D8 report; follow-up migration after the Go-side patch.
--
-- Out of scope (intentionally untouched — these are LIVE, not RPG):
--   * interviewer_applications.reviewed_by / reviewed_at — active tutor
--     moderation queue (services/profile/infra/queries/profile.sql).
--   * hone_vocab_queue.reviewed_count — SRS analytics counter for the
--     Leitner-style vocab review box (services/hone/infra/reading_repo.go).
--   * hone_tasks_kind_valid CHECK includes 'quiz' — Hone task category,
--     not the dropped XP-source 'quiz'.

-- +goose Up
-- +goose StatementBegin

-- ── 1. Drop friendships schema ──────────────────────────────────────
DROP TABLE IF EXISTS friend_codes CASCADE;
DROP TABLE IF EXISTS friendships CASCADE;

-- ── 2. Rebuild track_step_kind without 'arena' ──────────────────────
-- Postgres has no DROP VALUE for enums; the canonical workaround is:
--   (a) remap rows that reference the doomed value,
--   (b) ALTER COLUMN to TEXT (or to a freshly-CREATE'd enum),
--   (c) DROP TYPE old, RENAME new → old,
--   (d) ALTER COLUMN back to the enum.
-- We use the rename-swap variant — keeps the column type stable for
-- sqlc-generated readers across the cutover window.

-- Step 2a: ensure no surviving 'arena' rows. Remap to 'mock' (closest
-- still-supported step kind — both terminate in an AI-judge session).
UPDATE track_steps
   SET required_kind = 'mock'
 WHERE required_kind = 'arena';

-- Step 2b/c/d: rename-swap. Wrap in DO so all-or-nothing within the
-- migration transaction.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON e.enumtypid = t.oid
         WHERE t.typname = 'track_step_kind'
           AND e.enumlabel = 'arena'
    ) THEN
        -- New enum without 'arena'
        CREATE TYPE track_step_kind_new AS ENUM
            ('kata', 'mock', 'codex_read', 'focus_block');

        -- Swap the column over (cast via text since the enums are
        -- distinct types).
        ALTER TABLE track_steps
            ALTER COLUMN required_kind TYPE track_step_kind_new
            USING required_kind::text::track_step_kind_new;

        -- Drop the old enum + rename the new one into its place.
        DROP TYPE track_step_kind;
        ALTER TYPE track_step_kind_new RENAME TO track_step_kind;
    END IF;
END
$$;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- IRRECOVERABLE: friendships/friend_codes rows + the 'arena' enum value
-- are destroyed. Down-migration is a no-op; rollback path is "restore
-- from backup". Re-introducing arena would require a fresh design pass.
SELECT 1;
-- +goose StatementEnd
