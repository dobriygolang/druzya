# Cohorts — Strategic roadmap

> Status: scaffold  
> Owner: TBD  
> Linked context: `backend/services/cohort/`, migration `00030_cohorts.sql`  
> Last revised: 2026-04-23

## 1. Vision

Group preparation with a shared leaderboard, deadline, and goal — e.g. "12
people prepping for FAANG, May intake, finishes in 8 weeks". A cohort is
**time-boxed, goal-bound and finite** (unlike `guild`, which is the existing
permanent clan-style structure). Cohorts unlock social pressure, peer
accountability, and become the natural delivery vehicle for B2B
seat-licensed candidates and bootcamp resellers.

### Build new context vs extend `guild`?

**Decision: new bounded context `services/cohort/`.** Guild is permanent,
PvP-flavoured, has wars, and is owned by a charismatic founder. A cohort is:

- Time-boxed (start + end date)
- Goal-bound (target ELO, target company, target date)
- Coach-led (one mentor or shepherd; not a guild leader)
- Auto-disbanded on end date with a graduation report

Trying to overload guild with a "cohort_mode" flag would turn its model into
a polymorphic nightmare and break the guild war invariants. Separate context
keeps both stories clean. They MAY share the leaderboard rendering component
on the frontend.

## 2. User personas + pain points

### 2.1 Self-organising peer group
- **Pains:** WhatsApp group dies after week 2; no shared visibility on
  who's actually doing the work.
- **Wants:** A shared dashboard, weekly checkpoint, kicked-out automation
  for inactive members.

### 2.2 Bootcamp instructor
- **Pains:** Can't see which students are slacking before mid-term.
- **Wants:** Cohort dashboard, push the daily kata, message the bottom 20 %.

### 2.3 B2B Talent Lead (overlap with HR-tech vector)
- **Pains:** Same as above for new-hire ramp programs.
- **Wants:** Same dashboard, white-labelled.

## 3. Phase 1 — MVP scope (1 sprint)

Smallest shippable: **`POST /cohorts` to create a cohort with name, end_date;
`POST /cohorts/{id}/join` (invite-link based); `GET /cohorts/{id}` returns
member list + per-member weekly XP sorted desc.** No goals yet, no auto-end.

- New bounded context `services/cohort/`:
  - `domain.Cohort` (id, name, owner_id, starts_at, ends_at, status).
  - `domain.CohortMember` (cohort_id, user_id, role, joined_at).
  - `app.CreateCohort`, `app.JoinCohort`, `app.GetLeaderboard` use case stubs.
  - `ports.HTTPHandler` skeleton.
- Migration `00030_cohorts.sql` adds `cohorts`, `cohort_members`,
  `cohort_invites`.
- Anti-fallback: leaderboard returns `[]` (empty) for cohorts with no members
  — never fake-pad with platform averages.

## 4. Phase 2 — Goals + accountability (3-4 sprints)

- Cohort goals (target_elo per section, target_kata_count).
- Weekly digest message (e-mail + Telegram for linked members).
- Auto-prune: drop members inactive 14d (configurable).
- Cohort-scoped daily kata (everyone gets the same problem same day).

## 5. Phase 3 — Coach + paid cohorts (5-6 sprints)

- Coach role (paid mentor leads cohort; reuses mentor_session escrow).
- Paid cohorts (set price, take share with coach; reuses Stripe Connect).
- Cohort templates (FAANG-track, SQL-deep-dive).
- Public cohort discovery + waitlist.
- Graduation report (PDF) sent to every member at end_date.

## 6. Database schema deltas

Migration `00030_cohorts.sql`:

```sql
CREATE TABLE cohorts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    owner_id     UUID NOT NULL REFERENCES users(id),
    starts_at    TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active', -- active|graduated|cancelled
    visibility   TEXT NOT NULL DEFAULT 'invite', -- invite|public
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cohort_members (
    cohort_id    UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member',  -- member|coach|owner
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at      TIMESTAMPTZ,
    PRIMARY KEY (cohort_id, user_id)
);

CREATE INDEX idx_cohort_members_user ON cohort_members(user_id);

CREATE TABLE cohort_invites (
    token       TEXT PRIMARY KEY,
    cohort_id   UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    created_by  UUID NOT NULL REFERENCES users(id),
    expires_at  TIMESTAMPTZ NOT NULL,
    max_uses    INT  NOT NULL DEFAULT 1,
    used_count  INT  NOT NULL DEFAULT 0
);
```

Phase 2: `cohort_goals`, `cohort_weekly_snapshot`,
`cohort_kata_assignment`. Phase 3: `cohort_billing_subscriptions`.

## 7. API contracts

`CohortService` (Connect-RPC, proto `proto/druz9/v1/cohort.proto`):

| RPC                 | Request                                  | Response                  |
| ------------------- | ---------------------------------------- | ------------------------- |
| `CreateCohort`      | name, ends_at, visibility                | cohort_id, slug           |
| `GetCohort`         | cohort_id                                | Cohort                    |
| `JoinCohort`        | invite_token                             | cohort_id                 |
| `LeaveCohort`       | cohort_id                                | empty                     |
| `GetLeaderboard`    | cohort_id, week_iso                      | repeated MemberStanding   |
| `IssueInvite`       | cohort_id, max_uses, expires_in_hours    | invite_token, url         |

REST: `GET /cohorts/{slug}`, `POST /cohorts/{slug}/join`.

## 8. Frontend pages / components

- `/c/{slug}` — cohort home (leaderboard + countdown).
- `/c/{slug}/members` — full member table with filters.
- `/c/new` — creation wizard.
- Sanctum widget: "Your cohorts" card under main feed (if any).
- Reuse existing `LeaderboardTable` component from guild (note:
  generalise to take a `members` prop, do NOT couple to guild domain).

## 9. Pricing model

- **Free tier:** create up to 1 active cohort, max 5 members.
- **Premium:** unlimited cohorts, max 25 members, public visibility.
- **Phase 3 paid cohorts:** coach sets price, druz9 takes 15 % (same as
  mentor marketplace).
- B2B orgs: cohort creation included in seat license (no separate fee).

## 10. Estimated effort per phase (agent-sessions)

| Phase   | Backend | Frontend | Total |
| ------- | ------- | -------- | ----- |
| Phase 1 | 4       | 3        | **7** |
| Phase 2 | 5       | 3        | **8** |
| Phase 3 | 7       | 5        | **12** |

## 11. Risks + mitigations

| Risk                                         | Mitigation                                                         |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Confusion with `guild`                       | Distinct UI vocabulary, distinct shell color, FAQ entry            |
| Empty cohorts (1 person creates, never invites) | Auto-archive after 7d with 1 member; nudge owner via email/TG     |
| Leaderboard gaming (members game XP)         | Use existing rating system, not raw XP, for ranking in Phase 2     |
| Coach-led cohort liability (Phase 3)         | Reuse mentor_session disclaimers; same dispute flow                |
| Overlap with B2B HR-tech                     | Org may "own" a cohort; modelled as `cohort.owner_org_id` in P3    |
