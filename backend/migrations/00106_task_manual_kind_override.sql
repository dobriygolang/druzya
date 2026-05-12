-- 00104_task_manual_kind_override.sql — Phase J / H3 (P1) Auto-categorise UX.
--
-- Hone TaskBoard auto-categorises new tasks via LLM (categorise_task UC),
-- placing them in the right kanban column + assigning a kind. H3 makes
-- this VISIBLE to the user: transient toast «Auto-tagged as Algo» with
-- reasoning peek + undo-affordance.
--
-- Manual override flag: when the user clicks the kind chip on a card and
-- picks a different kind, we set manual_kind_override = true. Subsequent
-- BulkAutoCategorise / coach-listener runs must respect the user's choice
-- and skip auto-recategorisation.
--
-- Design rationale:
--   • NOT NULL DEFAULT false — existing rows stay auto-categorisable, new
--     rows start as auto-managed; flag flips only on explicit user action.
--   • No index — column is read on every task fetch but written rarely;
--     query path is always `WHERE user_id = $1` which uses the existing
--     idx_hone_tasks_user_status_created. Adding a flag-index would burn
--     write throughput for no measurable read benefit.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE hone_tasks
    ADD COLUMN IF NOT EXISTS manual_kind_override BOOLEAN NOT NULL DEFAULT false;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE hone_tasks
    DROP COLUMN IF EXISTS manual_kind_override;

-- +goose StatementEnd
