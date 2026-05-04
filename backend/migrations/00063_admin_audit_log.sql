-- 00063_admin_audit_log.sql — Phase 12.5 admin observability (2026-05-04).
--
-- Append-only лог admin-write actions (curation approve/reject, atlas-custom
-- moderation, mock-pool edits, learning-state force-set, onboarding bumps,
-- feature-flag toggles). Используется (a) audit page в admin UI, (b)
-- compliance / accountability, (c) rollback help — admin видит «когда
-- я бамп'нул onboarding_version, какие юзеры пострадали».
--
-- Схема намеренно flat — payload как jsonb потому что shape per action
-- разный (одни actions меняют 1 row, другие bulk-update'ят).
--
-- Индексы: (admin_user_id) для admin-page «my actions», (target_kind,
-- target_id) для surface-page audit-trail (e.g. «история всех изменений
-- этой curation node»).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE admin_audit_log (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action          TEXT         NOT NULL,
    -- target_kind ∈ curation_node | atlas_custom | mock_pool | learning_state |
    --              onboarding | feature_flag | persona | tutor | other.
    target_kind     TEXT         NOT NULL,
    target_id       TEXT         NOT NULL DEFAULT '',
    payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_audit_log_admin_recent
    ON admin_audit_log (admin_user_id, occurred_at DESC);

CREATE INDEX idx_admin_audit_log_target
    ON admin_audit_log (target_kind, target_id, occurred_at DESC);

CREATE INDEX idx_admin_audit_log_recent
    ON admin_audit_log (occurred_at DESC);

COMMENT ON TABLE admin_audit_log IS 'Append-only audit-trail для admin-write endpoints. Phase 12.5 — middleware на /api/v1/admin/* пишет одну row per request.';
COMMENT ON COLUMN admin_audit_log.action IS 'Verb-form: approve | reject | bump | toggle | force_set | edit | delete.';
COMMENT ON COLUMN admin_audit_log.payload IS 'Action-specific JSON. Должен содержать diff (before/after где применимо), но shape не enforced — admin UI парсит per-kind.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS admin_audit_log;
-- +goose StatementEnd
