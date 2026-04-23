# copilot — monolith wiring

Integration checklist for `backend/cmd/monolith`. Keep in lock-step with
`backend/cmd/monolith/services/copilot.go`.

## Go workspace

- `go.work` includes `./backend/services/copilot`.
- `backend/cmd/monolith/go.mod` has:
  - `require druz9/copilot v0.0.0-00010101000000-000000000000`
  - `replace druz9/copilot => ../../services/copilot`

## Database

- Migration: `backend/migrations/00038_copilot.sql` creates
  `copilot_conversations`, `copilot_messages`, `copilot_quotas`.
- sqlc config: `backend/sqlc.yaml` has a `copilot` entry generating into
  `services/copilot/infra/db` as package `copilotdb`.
- Screenshots are **not** persisted — `copilot_messages.has_screenshot` is
  a flag only.

## Proto

- Source: `proto/druz9/v1/copilot.proto`.
- Generated Go: `backend/shared/generated/pb/druz9/v1/copilot.pb.go` +
  `.../druz9v1connect/copilot.connect.go`.
- Generated TS: `frontend/src/api/generated/pb/druz9/v1/copilot_*.ts`.
- Regenerate with: `make gen-proto`.

## Module registration

In `backend/cmd/monolith/bootstrap/bootstrap.go`, the module list contains:

```go
services.NewCopilot(deps),
```

## Routes exposed

**Connect-RPC:** `/druz9.v1.CopilotService/*` (server-streaming supported).

**REST (via vanguard):**

| Method | Path                                               |
| ------ | -------------------------------------------------- |
| POST   | `/api/v1/copilot/analyze`                          |
| POST   | `/api/v1/copilot/conversations/{id}/chat`          |
| GET    | `/api/v1/copilot/history`                          |
| GET    | `/api/v1/copilot/conversations/{id}`               |
| DELETE | `/api/v1/copilot/conversations/{id}`               |
| GET    | `/api/v1/copilot/providers`                        |
| GET    | `/api/v1/copilot/quota`                            |
| GET    | `/api/v1/copilot/desktop-config`                   |
| POST   | `/api/v1/copilot/messages/{id}/rate`               |

Streaming RPCs (Analyze / Chat) are not transcoded to REST — the REST
path serves only a single final frame. Desktop clients use the Connect
path for real-time token deltas.

## Authentication

All endpoints require a valid JWT. The handler extracts the user id via
`sharedMw.UserIDFromContext` and returns `CodeUnauthenticated` if absent.

## Environment

Reuses the existing `LLM.OpenRouterAPIKey` env var (`OPENROUTER_API_KEY`).
Empty API key leaves the module mounted but every Analyze/Chat call will
fail at the provider step — acceptable for local dev of non-LLM flows.

## What's deliberately NOT here (yet)

- Rate-limit middleware on Analyze/Chat (quota is enforced inside the use
  case; a per-IP middleware is Phase 2 follow-up if abuse emerges).
- Auto-title summarization after first message — falls back to prompt
  truncation via `deriveTitle`.
- Voice transcription endpoint — proto reserved, implementation deferred.
- Dynamic `DesktopConfig` source — `StaticConfigProvider` ships the
  defaults from `infra/config.go`.
