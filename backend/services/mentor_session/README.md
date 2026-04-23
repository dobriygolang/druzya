# mentor_session — Mentor marketplace bounded context (STRATEGIC SCAFFOLD)

Phase 1 scaffold for `docs/strategic/mentor-marketplace.md`.

The mentor profile fields (`is_mentor`, `mentor_hourly_rate`, `mentor_bio`,
`mentor_languages`, `mentor_verified`) live on the existing `profiles`
table — see migration `00028_mentor_profile.sql`. This package owns only
the **booking** model (`mentor_sessions` table).

## Anti-fallback contract

- `escrow_state` defaults to `disabled`. Calls to `ReleaseEscrow` /
  `RefundEscrow` panic with a message pointing at Phase 2 work.
- No payment SDK is wired; do NOT import a payments library here yet.
- Nil logger to any constructor → panic.

## Next-session checklist (Phase 1, ~5 sessions)

1. Implement `infra/postgres.go` against `mentor_sessions` table.
2. Wire `app.RequestSession` to write `status='requested'`,
   `escrow_state='disabled'`.
3. Add `app.AcceptSession`, `app.CompleteSession` use cases.
4. Email both parties on request / accept (reuse notify service).
5. Add `MentorService` proto + connect handler.
6. Frontend `/mentors` directory page (separate FE sprint).
