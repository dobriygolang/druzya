-- +goose Up
-- +goose StatementBegin
--
-- 00027 — B2B HR-tech foundation (STRATEGIC SCAFFOLD).
--
-- See docs/strategic/b2b-hrtech.md for the full roadmap.
--
-- This migration introduces the three smallest tables sufficient to model:
--   - organizations (the B2B tenant)
--   - org_members  (who belongs, with what role)
--   - org_seats    (purchased licences, optionally pending an invite)
--
-- No billing tables yet (Phase 2 — Stripe). No SSO (Phase 3 — SAML/SCIM).
-- Anti-fallback policy: a seat assigned to an unknown email stays in
-- 'pending' status forever — we do NOT auto-create placeholder users.

CREATE TABLE IF NOT EXISTS organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    plan            TEXT NOT NULL DEFAULT 'trial',
    seat_quota      INT  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT organizations_plan_valid
        CHECK (plan IN ('trial','team','growth','enterprise'))
);

CREATE TABLE IF NOT EXISTS org_members (
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id),
    CONSTRAINT org_members_role_valid
        CHECK (role IN ('member','admin','owner'))
);

CREATE INDEX IF NOT EXISTS idx_org_members_user
    ON org_members (user_id);

CREATE TABLE IF NOT EXISTS org_seats (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invite_email       TEXT,
    assigned_user_id   UUID REFERENCES users(id),
    status             TEXT NOT NULL DEFAULT 'pending',
    assigned_at        TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT org_seats_status_valid
        CHECK (status IN ('pending','active','revoked'))
);

CREATE INDEX IF NOT EXISTS idx_org_seats_org
    ON org_seats (org_id);

CREATE INDEX IF NOT EXISTS idx_org_seats_assigned_user
    ON org_seats (assigned_user_id) WHERE assigned_user_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_org_seats_assigned_user;
DROP INDEX IF EXISTS idx_org_seats_org;
DROP TABLE IF EXISTS org_seats;
DROP INDEX IF EXISTS idx_org_members_user;
DROP TABLE IF EXISTS org_members;
DROP TABLE IF EXISTS organizations;
-- +goose StatementEnd
