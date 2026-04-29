# Service layout — Golden Path

Every service in `backend/services/<svc>/` follows the same hexagonal layout.
This is enforced by `go-arch-lint` per service and by `depguard` globally;
adding a new service is "fill in the template, not invent a new shape".

## Folder shape

```
backend/services/<svc>/
├── go.mod                    # one Go module per service
├── go.sum
├── .go-arch-lint.yml         # layering rules — DO NOT hand-edit, regen
├── domain/                   # business types + repository interfaces
│   ├── entity.go
│   ├── repo.go               # //go:generate mockgen → mocks/
│   ├── service.go            # pure rules (no DB, no HTTP)
│   └── mocks/                # generated; never edit
│       └── repo_mock.go
├── app/                      # use-cases (one file per command)
│   ├── create_thing.go
│   └── create_thing_test.go  # tests live alongside their use-case
├── infra/                    # adapters that talk to the outside world
│   ├── postgres.go           # *Repo struct backed by pgxpool.Pool
│   ├── db/                   # sqlc-generated; never edit by hand
│   ├── queries/              # sqlc input *.sql files
│   └── *_test.go
└── ports/                    # transport: HTTP / WS / Connect-RPC
    ├── server.go             # Mount(r chi.Router); takes app pointers
    └── *_handler.go
```

A service may omit folders it does not need. Quiz has no `infra/db` (Redis-only),
documents has no migrations (read from already-uploaded blobs), etc. Generated
configs (`.go-arch-lint.yml`) only declare components that exist.

## Allowed dependency direction

```
domain   ←  (leaf — only stdlib + uuid + sentinel errors)
app      →  domain
infra    →  domain          (sub-packages of infra import each other freely)
ports    →  app, domain     (NEVER infra — use app + interfaces from domain)
mocks    →  domain          (auto-generated; tests in any layer may import)
```

The arrows are validated on every CI run by [go-arch-lint](https://github.com/fe3dback/go-arch-lint).
The most common violations:

- **`infra → app`** — happens when an external-facing data type lives in `app/`
  but `infra/` needs to produce or consume it. Fix: move the type to `domain/`
  and leave a `type X = domain.X` alias in `app/` for backward compat.
- **`ports → infra`** — handler reaches into a concrete repo. Fix: define an
  interface in `domain/`, have the infra struct satisfy it, ports depends on
  the interface.

## Cross-service communication

Services **never** import each other directly. The Go module boundary plus
the absence of `replace` directives make this physically impossible — the
build will fail. Cross-service flows go through one of:

1. **In-process bus** — `shared.domain.Bus`. Publishers in service A emit
   typed events from `shared/domain/events.go`; subscribers in service B
   register handlers via `Module.Subscribers`. See `services/hone/app/coach_listener.go`
   for a real-world example.
2. **Adapter wired in `cmd/monolith`** — small "facade" types live in the
   composition root, never in either service. Example: `notify.Bot.SetCodeFiller`
   wired against `auth.TelegramCodes` in `cmd/monolith/bootstrap/bootstrap.go`.

## What lives in `cmd/monolith/`

`cmd/monolith` is a **pure facade**. Allowed in there:

- Wiring (`bootstrap.go`, `services/<svc>/<svc>.go`)
- HTTP/Connect mount points and middleware composition
- Top-level configuration parsing
- `migrate.go` (goose subcommand) — uses `database/sql` because goose requires it
  (depguard exempts this file)

**Forbidden** in `cmd/monolith`:

- Direct `pool.Exec` / `pool.Query` calls — they belong in
  `services/<svc>/infra/<repo>.go` (this rule is what Phase J was set up to
  enforce; the previous violations in `cleanup_crons.go` and `quota_enforce.go`
  have been moved). Adding new SQL in `cmd/` is a code-review bounce.
- Any business logic. If it has `if/else` over a domain rule, it belongs in
  `services/<svc>/app/`.

## Codegen

Run from repo root:

```bash
make generate          # all generators
make gen-sqlc          # SQL → typed Go in services/<svc>/infra/db/
make gen-mocks         # mockgen mocks for any //go:generate directive
make gen-proto         # buf generate from proto/*.proto
make gen-check         # CI: fail if generated output drifted
```

`gen-mocks` auto-detects which services have `//go:generate` directives by
grepping `domain/`. Add a directive, re-run, commit — no Makefile edit needed.

### HTTP / RPC handlers come from proto

**Default:** every new endpoint goes through `proto/druz9/v1/<svc>.proto` →
`buf generate` → implement the generated `*ServiceHandler` interface in
`services/<svc>/ports/server.go` → `cmd/monolith/services/<svc>/<svc>.go`
wraps the Connect handler in `vanguard.NewTranscoder` so the same
implementation answers both:

- Native Connect at `/druz9.v1.<Svc>Service/<Method>`
- REST aliases declared via `option (google.api.http) = { ... }`

You write the proto + the use-case impl. **You do not write a chi handler
plus a separate Connect handler plus a separate FE schema.** The wire
shape comes from the proto for free.

Wiring template (cmd/monolith/services/quiz/quiz.go):

```go
connectPath, connectHandler := druz9v1connect.NewQuizServiceHandler(server)
transcoder := monolithServices.MustTranscode("quiz", connectPath, connectHandler)
return &monolithServices.Module{
    ConnectPath:        connectPath,
    ConnectHandler:     transcoder,
    RequireConnectAuth: true,
    MountREST: func(r chi.Router) {
        r.Post("/quiz/start", transcoder.ServeHTTP)
        r.Post("/quiz/{session_id}/submit", transcoder.ServeHTTP)
    },
}
```

### When raw chi handlers are OK

Three legit cases where staying off proto is correct, not laziness:

1. **Binary / streaming responses** — TTS audio (`audio/mpeg`), large file
   downloads, `text/event-stream` SSE. proto-JSON would base64-encode bytes
   or hold the whole stream in memory.
   _Examples:_ `services/ai_mock/ports/voice_handler.go` (TTS),
   `cmd/monolith/services/hone/cursor_sse.go` (SSE).
2. **Webhook receivers** — provider-defined wire shape (Telegram, Boosty,
   YooKassa). Map provider's body, validate signature, then call into app.
   Proto would force a translation layer with no benefit.
3. **Auth flows that touch HTTP-only cookies / set non-JSON headers** —
   refresh-token endpoints, OAuth callbacks. proto JSON encoders don't
   shape `Set-Cookie` paths.

Anything else — CRUD, listings, mutations — goes through proto. If you find
yourself writing a third chi handler in `cmd/`, stop and add it to proto
instead.

### Pre-existing chi-in-cmd debt

A 2026-04 audit catalogued every `r.Get/Post/Put/Delete/Patch` in
`cmd/monolith/services/*`. Most lines are `transcoder.ServeHTTP` mounts (good).
The cases below pre-date the proto-first rule and should migrate when their
service is touched next:

| Service | Endpoints | Status | Notes |
|---|---|---|---|
| admin/codex | 12 | ✅ migrated | `proto/druz9/v1/codex.proto`. Public + admin CRUD via vanguard transcoder; admin gate applied above the transcoder per-path. `openArticle` tap publishes `codex.ArticleRead` (Phase C). |
| admin/personas | 6 | ✅ migrated | `proto/druz9/v1/personas.proto`. Public list + admin CRUD. |
| admin/ai_models | 5 | ✅ migrated | `proto/druz9/v1/ai_models.proto`. Slash-containing IDs (`mistralai/mistral-7b`) handled via `{model_id=**}` proto wildcard. |
| admin/llmchain_admin | 2 | ✅ migrated | `proto/druz9/v1/llmchain_admin.proto`. proto3 nested-map limitation worked around with flattened `repeated *Entry` lists; the Connect adapter rebuilds the nested runtime structure. |
| admin/stats | 3 | ✅ migrated | `proto/druz9/v1/stats.proto`. Public read; cache headers layered above the transcoder per-path. |
| admin/status_history | 1 | ✅ migrated | Folded into stats.proto (`GetStatusHistory`). |
| admin/mentor_session | 4 | ✅ deleted | Strategicwire scaffold (build-tagged, never bootstrapped). Removed alongside `services/mentor_session`. |
| admin/arena/admin_arena_tasks | 6 | ✅ migrated | `proto/druz9/v1/arena_admin.proto`. Admin CRUD with admin gate. |
| circles/lobby | 8 | ✅ migrated | `proto/druz9/v1/lobby.proto`. Pure proto service now. |
| storage | 4 | ✅ migrated | `proto/druz9/v1/storage.proto`. |
| sync devices | 3 | ✅ migrated | `proto/druz9/v1/sync.proto`. `/sync/pull|push` stay chi (binary blobs). |
| sync/events | 1 | legit chi | SSE stream. |
| notify support+notifs | 5 | ✅ migrated | `notify.proto` extended with feed (list/unread/read_all/mark_read) + `CreateSupportTicket`. `/notifications/prefs` stays chi (different shape from `/notify/preferences`). |
| profile | 3 | ✅ migrated | `profile.proto` extended. AllocateAtlasSkill / GetAIVacanciesModel / SetAIVacanciesModel now go through the existing ProfileServer. |
| arena | 2 | ✅ migrated | `arena.proto` extended (`GetCurrentMatch`, `GetArenaQueueStats`). |
| circles/circles | 1 | ✅ migrated | `DiscoverCircles` added to `circles.proto`. |
| whiteboard_rooms / editor | 4 | ✅ migrated (visibility); guest-join legit chi | `WhiteboardVisibility` + `EditorVisibility` proto messages added. Guest-join stays chi (mints JWT — fits "auth flow / non-JSON headers" exception). |
| podcast | 8 | ✅ migrated | `proto/druz9/v1/podcast.proto`. List/get/categories + admin metadata PATCH/DELETE/category-create through transcoder. POST /admin/podcast (multipart audio upload) stays chi as a legit binary edge case. |
| ai_mock/insights | 1 | ✅ migrated | Folded into MockService (`GetInsightsOverview`). LLM summary callback wired via cmd-side helper so the service module stays free of llmchain/redis deps. |
| subscription | 4 | ✅ migrated | `subscription.proto` extended with `GetQuota`, `LinkBoosty`, `AdminBoostySync`. |
| ai_mock/voice | 2 | legit chi | TTS returns `audio/mpeg` (binary). |
| hone/vault | 4 | legit chi | Vault encrypt/decrypt — auth-sensitive. |
| hone/yjs_persistence | 3 | legit chi | Yjs binary CRDT updates. |
| hone/cursor_sse | 1 | legit chi | SSE stream. |
| hone/publishing | 7 | should migrate | `/notes/{id}/publish` + slug view. |
| auth (TG/Yandex flow) | 3+ | legit chi | PKCE state, code exchange — touches non-JSON headers. |
| admin/tg_coach (webhook) | 2 | legit chi | Telegram webhook signature verify. |

**Total:** ~50 endpoints classified "should migrate" — incremental work,
do them when the service is otherwise touched. Don't add new ones to this
list — every new endpoint goes through proto.

## Linting

```bash
make lint-go           # full sweep across all modules
cd backend/services/<svc> && go-arch-lint check        # per-service
cd backend/services/<svc> && golangci-lint run ./...   # depguard etc.
```

Both are CI gates. depguard rules are centralised in `backend/.golangci.yml`.

## Adding a new service

1. `mkdir backend/services/<name>` and copy the layout above.
2. `cd` into the new dir, `go mod init druz9/<name>`.
3. Add the new module to `go.work` (root) and to `cmd/monolith/go.mod`
   (require + replace).
4. Drop `.go-arch-lint.yml` — easiest is `bash tools/gen_arch_configs.sh`
   which generates one based on which folders you populated.
5. In `cmd/monolith/services/<name>/<name>.go`, write a `New<Name>(d Deps)`
   facade returning `*monolithServices.Module` with handlers / subscribers
   wired from `app.*` and `infra.*` constructors.
6. Add the service to the `modules` slice in `cmd/monolith/bootstrap/bootstrap.go`.
7. Run `go-arch-lint check` from your service dir, plus `make lint-go` from
   repo root. Both must be green.

That's the Golden Path. Resist the urge to invent a new shape.
