# Mentor marketplace — Strategic roadmap

> Status: scaffold  
> Owner: TBD  
> Linked context: `backend/services/mentor_session/`, profile delta in `00028_mentor_profile.sql`  
> Last revised: 2026-04-23

## 1. Vision

Turn the top ~5 % of druz9 users (high-rating, premium, verified employer
history) into **paid mentors** who sell hourly sessions through the platform.
druz9 takes a marketplace cut, handles escrow + payouts, and uses match
quality (mentor effectiveness on mentee ELO delta) as a discovery signal.
This monetises the long-tail of expert users who currently churn after
reaching the rating ceiling and creates a defensible flywheel: the more
matches we orchestrate, the better our recommender gets, the harder it is
for a generic "Calendly + Stripe" bundle to compete.

## 2. User personas + pain points

### 2.1 Mentor (senior engineer, ex-FAANG, druz9 high-rating)
- **Pains:** Side hustle through random LinkedIn DMs; no deal flow; manual
  invoicing; no proof of efficacy.
- **Wants:** Set hourly rate + availability; mentees are pre-screened by
  rating gap; payouts arrive automatically; reviews build a track record.

### 2.2 Mentee (mid-level, prepping for senior interviews)
- **Pains:** Doesn't know which mentor matches their gap; afraid of getting a
  generic "do leetcode" lecture; payment risk.
- **Wants:** See mentor's verified rating per section, read reviews, book a
  60-min session with escrow until session is confirmed completed.

### 2.3 druz9 platform
- **Pains:** Ceiling users churn; no monetisation of expertise.
- **Wants:** Take rate (15-20 %), retention of both sides, no liability for
  session quality, fraud-resistant escrow.

## 3. Phase 1 — MVP scope (1 sprint)

Smallest shippable: **mentor opt-in via profile settings + a public
`/mentors` directory + manual booking via a form that emails both parties.
NO payments yet — payment runs out-of-band, we charge nothing.** This unlocks
ICP discovery (do mentors actually opt in? do mentees actually book?) before
we invest in escrow.

- New profile fields (migration `00028_mentor_profile.sql`):
  `is_mentor BOOL`, `mentor_hourly_rate INT` (cents), `mentor_bio TEXT`,
  `mentor_languages TEXT[]`, `mentor_verified BOOL`.
- New bounded context `services/mentor_session/`:
  - `domain.MentorSession` entity (mentee_id, mentor_id, slot_at, duration,
    status, escrow_state).
  - `app.RequestSession` use case stub (returns `ErrNotImplemented`).
  - `ports.HTTPHandler` skeleton.
- Anti-fallback: `escrow_state` defaults to `disabled` in MVP and any call
  to `ReleaseEscrow` panics with "escrow not implemented; see Phase 2".

## 4. Phase 2 — Payments + scheduling (4-5 sprints)

- Stripe Connect for mentor payouts.
- Escrow flow: charge on booking, hold, release T+24h after session unless
  mentee disputes.
- Calendar slots (mentor sets weekly availability; bookings consume slot).
- Video room (Daily.co or Whereby embed; NOT WebRTC ourselves).
- Review system (one-way: mentee rates mentor; one-way reduces gaming).

## 5. Phase 3 — Marketplace intelligence (6+ sprints)

- Recommender: rank mentors by `(skill_overlap, rating_gap, completion_rate,
  mentee_elo_delta_post_session)`.
- Mentor packages (5-session bundle, money-back if no rating gain).
- Group sessions (1 mentor → N mentees, lower price-point).
- "Office hours" — recurring free 15-min slots that funnel to paid hours.

## 6. Database schema deltas

Migration `00028_mentor_profile.sql`:

```sql
ALTER TABLE profiles
    ADD COLUMN is_mentor          BOOL    NOT NULL DEFAULT FALSE,
    ADD COLUMN mentor_hourly_rate INT     NOT NULL DEFAULT 0,    -- cents
    ADD COLUMN mentor_bio         TEXT    NOT NULL DEFAULT '',
    ADD COLUMN mentor_languages   TEXT[]  NOT NULL DEFAULT '{}',
    ADD COLUMN mentor_verified    BOOL    NOT NULL DEFAULT FALSE;

CREATE INDEX idx_profiles_is_mentor ON profiles(is_mentor) WHERE is_mentor;

CREATE TABLE mentor_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentee_id       UUID NOT NULL REFERENCES users(id),
    mentor_id       UUID NOT NULL REFERENCES users(id),
    slot_at         TIMESTAMPTZ NOT NULL,
    duration_min    INT NOT NULL DEFAULT 60,
    status          TEXT NOT NULL DEFAULT 'requested', -- requested|accepted|completed|disputed|cancelled
    escrow_state    TEXT NOT NULL DEFAULT 'disabled',  -- disabled|held|released|refunded
    price_cents     INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mentor_sessions_mentor ON mentor_sessions(mentor_id, slot_at DESC);
CREATE INDEX idx_mentor_sessions_mentee ON mentor_sessions(mentee_id, slot_at DESC);
```

Phase 2: `mentor_payouts`, `mentor_availability_slots`, `mentor_reviews`.

## 7. API contracts

`MentorService` (Connect-RPC, proto `proto/druz9/v1/mentor.proto`):

| RPC                  | Request                              | Response             |
| -------------------- | ------------------------------------ | -------------------- |
| `ListMentors`        | section, lang, page                  | repeated MentorCard  |
| `GetMentor`          | mentor_id                            | MentorProfile        |
| `RequestSession`     | mentor_id, slot_at, duration         | session_id, status   |
| `AcceptSession`      | session_id (mentor only)             | empty                |
| `CompleteSession`    | session_id (mentee confirms)         | escrow_state         |
| `DisputeSession`     | session_id, reason                   | empty                |
| `UpsertMentorProfile`| rate, bio, languages                 | empty                |

REST: `GET /mentors`, `POST /mentors/sessions`.

## 8. Frontend pages / components

- `/mentors` — directory with filter (section, language, price).
- `/mentors/{username}` — profile + booking widget.
- `/me/mentor` — opt-in, set rate/bio (extends existing settings).
- Sanctum nav entry "Mentors" (gated to `is_premium OR is_mentor`).

## 9. Pricing model

- Take rate: **15 %** of session price in Phase 2.
- Mentor sets rate (constraint: $20-$300/hr to deter spam & gouging).
- Phase 3: 20 % take, with 5 % rebate to mentors above 4.7-star rating.
- druz9 absorbs Stripe fees up to 3 % to keep mentor payout simple.

## 10. Estimated effort per phase (agent-sessions)

| Phase   | Backend | Frontend | Payments/Ops | Total |
| ------- | ------- | -------- | ------------ | ----- |
| Phase 1 | 3       | 2        | 0            | **5** |
| Phase 2 | 7       | 5        | 4            | **16** |
| Phase 3 | 8       | 6        | 2            | **16** |

## 11. Risks + mitigations

| Risk                                          | Mitigation                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Off-platform leakage (mentor + mentee swap to direct invoice) | Take rate kept fair; embedded video room; reviews/ratings live here only |
| Bad-actor mentor (no-show, abusive)           | Escrow + dispute flow; auto-suspend on 2 disputes; manual review queue   |
| Tax / 1099 / NDFL compliance                  | Phase 2: route payouts through Stripe Connect Express (US) + manual KYC for RU/non-US |
| Liability for mentor advice                   | ToS disclaimer; mentors are independent; druz9 is a marketplace, not employer |
| Cold-start: directory empty                   | Hand-recruit 20 high-rated users with $0 take rate for first 60 days     |
