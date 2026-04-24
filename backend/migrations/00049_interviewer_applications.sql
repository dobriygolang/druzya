-- +goose Up
-- +goose StatementBegin
-- M4a: replace instant self-service interviewer promotion with an
-- admin-moderated queue. Each application lives in its own row keyed by
-- user_id (one open application per user — UNIQUE on user_id WHERE
-- status = 'pending' enforced via partial index).
CREATE TABLE interviewer_applications (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    motivation   TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending',
    reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at  TIMESTAMPTZ,
    decision_note TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT interviewer_applications_status_valid
        CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- One open (pending) application per user. Approved/rejected rows pile up
-- as audit history.
CREATE UNIQUE INDEX interviewer_applications_one_pending
    ON interviewer_applications(user_id) WHERE status = 'pending';

CREATE INDEX interviewer_applications_status_created
    ON interviewer_applications(status, created_at DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS interviewer_applications_status_created;
DROP INDEX IF EXISTS interviewer_applications_one_pending;
DROP TABLE IF EXISTS interviewer_applications;
-- +goose StatementEnd
