-- 00041_tutor_invite_target_user.sql — Wave «Invite by @username».
--
-- До этого invite-flow требовал out-of-band отправку кода (TG/email).
-- target_user_id pre-binds invite к конкретному юзеру → student видит
-- pending invite на /profile + accept одним кликом без копи-вставки кода.
--
-- Backwards-compat: target_user_id nullable. Старые invite'ы (без target)
-- продолжают работать через существующий /invite/{code} flow.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE tutor_invites
    ADD COLUMN IF NOT EXISTS target_user_id UUID
        REFERENCES users(id) ON DELETE SET NULL;

-- Lookup: кому-сейчас-кто-кого-приглашает. Hot path на student-side
-- ListPendingInvitesForMe.
CREATE INDEX IF NOT EXISTS idx_tutor_invites_target_pending
    ON tutor_invites (target_user_id, created_at DESC)
    WHERE target_user_id IS NOT NULL
      AND accepted_at IS NULL
      AND revoked_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_tutor_invites_target_pending;
ALTER TABLE tutor_invites DROP COLUMN IF EXISTS target_user_id;
-- +goose StatementEnd
