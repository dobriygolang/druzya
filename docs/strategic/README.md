# Strategic vector roadmaps

This directory holds the long-form strategic roadmaps for the five vectors
that take druz9 from MVP to a multi-segment product. Each doc is paired
with one scaffold migration and (where applicable) one bounded context.

| Vector                | Roadmap                          | Migration                         | Bounded context                       |
| --------------------- | -------------------------------- | --------------------------------- | ------------------------------------- |
| B2B HR-tech           | [b2b-hrtech.md](./b2b-hrtech.md) | `00027_orgs.sql`                  | `backend/services/orgs/`              |
| Mentor marketplace    | [mentor-marketplace.md](./mentor-marketplace.md) | `00028_mentor_profile.sql` | `backend/services/mentor_session/` |
| Telegram AI coach     | [tg-coach.md](./tg-coach.md)     | `00029_tg_coach.sql`              | `backend/services/tg_coach/`          |
| Full i18n (kz/ua)     | [i18n.md](./i18n.md)             | (none — frontend only)            | `frontend/src/locales/{kz,ua}/`       |

## Conventions used by all five docs

1. **Vision** — one paragraph, plain English, why this matters now.
2. **Personas + pains** — the buyer and the user, separated.
3. **Phase 1 MVP** — one sprint, smallest shippable unit.
4. **Phase 2-3 expansions** — sequenced, not estimated to the day.
5. **Schema deltas** — actual SQL, not prose.
6. **API contracts** — table of RPCs + REST aliases.
7. **Frontend pages** — what exists, what is needed.
8. **Pricing** — explicit numbers; price is design.
9. **Effort** — agent-sessions per phase.
10. **Risks + mitigations** — table form.

## Anti-fallback contract (cross-cutting)

Every scaffold in this initiative respects the same hygiene rules:

- Stub interfaces return a typed `ErrNotImplemented`, never silent zero.
- Nil logger to a constructor → panic.
- HTTP stubs return 501 with a JSON pointer to the roadmap doc.
- Migrations have proper `-- +goose Up` / `-- +goose Down` blocks.
- Wirers are committed under build tag `strategicwire` so they
  participate in code review without breaking the default build.

## Activating a scaffolded vector

When picking up Phase 1 of any vector:

1. Read its roadmap doc front-to-back.
2. Read the bounded context's `README.md` for the next-session checklist.
3. Add the module to `backend/cmd/monolith/go.mod` requires + replace.
4. Run `go mod tidy` from `backend/cmd/monolith/`.
5. Drop the `//go:build strategicwire` tag from the wirer.
6. Append the wirer call into `bootstrap.go`'s modules slice.
7. Implement `infra/postgres.go` against the migration.
8. Replace each `ErrNotImplemented` with real logic, one use case at a time.
