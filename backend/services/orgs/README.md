# orgs — B2B HR-tech bounded context (STRATEGIC SCAFFOLD)

This package is a **scaffold**, not an implementation. It represents
**Phase 1 — MVP scope** of `docs/strategic/b2b-hrtech.md`.

## What is here

- `domain/` — `Organization`, `OrgMember`, `OrgSeat` domain entities and the
  `OrgRepo` port. All persistence methods are interface-only.
- `app/` — use case stubs (`AssignSeat`, `GetDashboard`, `CreateOrg`,
  `RevokeSeat`). Every method returns `domain.ErrNotImplemented`.
- `ports/` — HTTP handler skeleton. All routes return 501 with a body
  pointing to this README and the roadmap doc.
- `infra/` — empty; the Postgres adapter will land in Phase 1
  implementation work, against migration `00027_orgs.sql`.

## Anti-fallback contract

- No method silently returns zero data + nil error.
- No fake placeholder users are created when an invite email does not
  resolve to an existing `users` row.
- A nil logger passed to any handler MUST cause the constructor to panic.

## Next-session checklist (to reach shippable Phase 1)

1. Implement `infra/postgres.go` with sqlc-generated queries for the three
   tables in `00027_orgs.sql`.
2. Wire the use cases by replacing every `ErrNotImplemented` with real
   logic.
3. Define the proto in `proto/druz9/v1/org.proto` and regenerate.
4. Add the connect-go server in `ports/server.go`.
5. Register `services.NewOrgs(deps)` in
   `backend/cmd/monolith/bootstrap/bootstrap.go`.
6. Backfill an admin CSV-import script for first manual sales hand-off.

Estimated effort: ~5 agent-sessions (see roadmap §10).
