# cohort — Time-boxed group preparation (STRATEGIC SCAFFOLD)

Phase 1 scaffold for `docs/strategic/cohorts.md`.

## Why a new bounded context (not extending `guild`)

See roadmap §1 for the full argument. Summary: **cohorts are time-boxed,
goal-bound, coach-led; guilds are permanent, PvP-flavoured, founder-led.**
Overloading guild with a `cohort_mode` flag would break the guild war
invariants and create a polymorphic mess. The two contexts may share UI
primitives (e.g. `LeaderboardTable`) but never domain code.

## Anti-fallback contract

- Empty cohorts return `[]` for the leaderboard, NOT a padded list of
  platform averages.
- Invite tokens enforce `used_count <= max_uses` at the SQL layer.
- Cohorts past `ends_at` move to `status='graduated'` via a background
  job; reads MUST surface this rather than silently filtering them out.
- Nil logger to any constructor → panic.

## Next-session checklist (Phase 1, ~7 sessions)

1. Implement `infra/postgres.go`.
2. Wire `app.CreateCohort`, `app.JoinCohort`, `app.GetLeaderboard`.
3. Add proto + connect handler.
4. Frontend `/c/{slug}` page with countdown + leaderboard.
5. Background job: graduate cohorts on `ends_at`.
6. Email digest at the end of week 1, week N-1, and graduation.
