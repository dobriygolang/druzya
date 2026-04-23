# B2B HR-tech — Strategic roadmap

> Status: scaffold  
> Owner: TBD  
> Linked context: `backend/services/orgs/`, migration `00027_orgs.sql`  
> Last revised: 2026-04-23

## 1. Vision

druz9 today is a single-player gamified prep platform. The B2B HR-tech vector
turns druz9 into a **bulk-preparation supplier** for hiring funnels: companies
purchase seats, assign them to candidate cohorts (incoming hires, bootcamp
admits, internship pools), receive aggregated readiness analytics, and use
druz9 reports as a screening signal alongside their existing ATS. This is the
single largest revenue lever in the 5-year roadmap because seat economics
scale linearly with hiring volume and the buyer (HR / Talent Acquisition) is
budget-holding, unlike individual learners.

## 2. User personas + pain points

### 2.1 Talent Lead at a 50-500 person company
- **Pains:** Candidates ghost after offer; new hires need 4-6 weeks to ramp;
  no objective signal on whether a candidate is "interview-ready" before
  scheduling expensive engineer time.
- **Wants:** A dashboard showing cohort readiness, ability to grant/revoke
  seats, exportable reports for hiring committees.

### 2.2 University Career Office
- **Pains:** Students compete for the same 5 FAANG slots without preparing
  systematically; no equity-of-access tooling.
- **Wants:** Bulk seat licences priced per-academic-year, white-label landing
  page, opt-in anonymised stats for accreditation.

### 2.3 Bootcamp / Edtech reseller
- **Pains:** Their own curriculum stops at "you finished the course" — they
  cannot prove placement-readiness.
- **Wants:** API to provision/deprovision seats from their LMS; revenue share
  on premium upsell.

### 2.4 Candidate (seat occupant)
- **Pains:** Doesn't want their employer to see raw mistakes; wants the same
  product as a self-serve user.
- **Wants:** Clear consent gates on what the org sees; ability to detach the
  seat after onboarding and keep their account.

## 3. Phase 1 — MVP scope (1 sprint)

Smallest shippable thing: **manually provisioned org with seat assignment + a
read-only `/orgs/{id}/dashboard` showing per-member readiness rating**. No
self-service billing, no SSO, no API — sales hands off a CSV, ops runs an
admin script.

Concretely:
- `organizations` table (id, name, owner_user_id, created_at, plan, seat_quota)
- `org_members` table (org_id, user_id, role, joined_at)
- `org_seats` table (org_id, seat_id, assigned_user_id NULL, status)
- Admin RPC `OrgService.AssignSeat(org_id, seat_id, email)` — creates pending
  invite, links user on first login.
- Read-only RPC `OrgService.GetDashboard(org_id)` — returns rolled-up
  `{member, current_elo_per_section, last_active_at, weekly_xp}`.
- Anti-fallback: if the seat email does not match a registered user, the seat
  stays in `pending` — NEVER a fake placeholder profile.

## 4. Phase 2 — Self-serve provisioning (3-4 sprints)

- Stripe Billing checkout for seat packs (10 / 25 / 100 seats).
- Org admin web flow: create org, invite members by email, revoke seats.
- Per-section benchmarks (cohort percentiles vs platform-wide).
- CSV / PDF export of readiness reports.
- Audit log of seat re-assignments (compliance prep).

## 5. Phase 3 — Enterprise + API (5-7 sprints)

- SAML/OIDC SSO (Okta, Google Workspace, Azure AD).
- SCIM 2.0 user provisioning.
- Public REST + webhook API: create org, push candidates, receive readiness
  webhooks on milestones.
- White-label: custom domain, theme tokens, optional logo on candidate report.
- Data residency: per-org Postgres schema OR per-region read replicas
  (decide after first 3 enterprise contracts).

## 6. Database schema deltas

Migration `00027_orgs.sql`:

```sql
CREATE TABLE organizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    owner_user_id   UUID NOT NULL REFERENCES users(id),
    plan            TEXT NOT NULL DEFAULT 'trial',
    seat_quota      INT  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',  -- member|admin|owner
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE org_seats (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invite_email       TEXT,
    assigned_user_id   UUID REFERENCES users(id),
    status             TEXT NOT NULL DEFAULT 'pending', -- pending|active|revoked
    assigned_at        TIMESTAMPTZ,
    revoked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Phase 2 adds: `org_billing_subscriptions`, `org_invites_audit`,
`org_consent_grants` (per-member consent for what the org may see).

## 7. API contracts

Connect-RPC service `OrgService` (proto location: `proto/druz9/v1/org.proto`):

| RPC                | Request                            | Response                |
| ------------------ | ---------------------------------- | ----------------------- |
| `CreateOrg`        | name, slug, plan                   | org_id                  |
| `GetOrg`           | org_id                             | Org                     |
| `ListMembers`      | org_id, page                       | repeated OrgMember      |
| `AssignSeat`       | org_id, invite_email, role         | seat_id, status         |
| `RevokeSeat`       | org_id, seat_id                    | empty                   |
| `GetDashboard`     | org_id, week_iso                   | DashboardSnapshot       |
| `LinkPendingSeat`  | seat_id, user_id (server-internal) | empty                   |

REST aliases (auto via vanguard transcoder), e.g. `GET /orgs/{id}/dashboard`.

## 8. Frontend pages / components needed

**Out of scope for this scaffold sprint** (per task spec). When picked up:
- `/o/{slug}` — org landing & dashboard
- `/o/{slug}/members` — member list + invite modal
- `/o/{slug}/billing` — Stripe portal embed (Phase 2)
- Header switcher between personal account ↔ org context (use existing
  `Sanctum` shell layout).

## 9. Pricing model considerations

- **Trial:** 5 seats, 14 days, no card.
- **Team:** $19/seat/mo, min 10 seats, monthly.
- **Growth:** $14/seat/mo, min 25 seats, annual prepay.
- **Enterprise:** custom — SSO, SCIM, SLA, data residency.
- Anti-cannibalisation: a personal premium subscription does NOT auto-convert;
  the seat license overrides while active and is not refundable. When a seat
  is revoked the user falls back to free unless they have a personal plan.

## 10. Estimated effort per phase (agent-sessions)

| Phase   | Backend | Frontend | Infra/Ops | Total |
| ------- | ------- | -------- | --------- | ----- |
| Phase 1 | 4       | 0        | 1         | **5** |
| Phase 2 | 6       | 5        | 2         | **13** |
| Phase 3 | 10      | 6        | 4         | **20** |

## 11. Risks + mitigations

| Risk                                                  | Mitigation                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| GDPR — org seeing candidate data without consent      | Explicit `org_consent_grants` row + per-member "what they see" toggle      |
| Pricing race-to-bottom vs HackerRank/CodeSignal       | Lean into gamified narrative & Russian-language moat; sell preparation, not screening |
| Scope creep into ATS territory                        | Hard line: druz9 does NOT host job postings or interview scheduling        |
| Single-tenant DB hot-spot from one large org          | Phase 3 introduces per-region replicas; index on `org_id` from day 1       |
| Candidate identity collision (one email, two orgs)    | Seats reference users, not the other way; user can be in N orgs           |
