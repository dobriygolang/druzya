# Contract-first with Buf + Connect-RPC

This repo's HTTP contract layer is **Protobuf + [Connect-RPC](https://connectrpc.com)**.
Connect serves native Connect, gRPC, gRPC-Web, and plain HTTP+JSON from one
`.proto` definition on one Go handler — with
[`vanguard-go`](https://github.com/connectrpc/vanguard-go) doing REST
transcoding via `google.api.http` annotations, so existing REST clients keep
working at `/api/v1/<domain>/*` paths.

**Status:** all 14 bounded contexts (auth, profile, daily, notify, cohort,
rating, arena, ai_mock, ai_native, slot, editor, season, podcast, admin) are
on Connect-RPC. OpenAPI + `oapi-codegen` have been retired; the historical
spec lives under [`docs/legacy/openapi-v1.yaml`](./legacy/openapi-v1.yaml) for
reference only (bible §16 narrative value).

## Where things live

| Thing | Path |
| --- | --- |
| Source contract | `proto/druz9/v1/*.proto` |
| Buf module config | `proto/buf.yaml` |
| Buf plugin config | `proto/buf.gen.yaml` |
| Vendored googleapis | `proto/google/api/{annotations,http}.proto` |
| Generated Go messages | `backend/shared/generated/pb/druz9/v1/*.pb.go` |
| Generated Connect server/client | `backend/shared/generated/pb/druz9/v1/druz9v1connect/*.connect.go` |
| Generated TS stubs | `frontend/src/api/generated/pb/druz9/v1/*.ts` |

Go plugins (`protoc-gen-go`, `protoc-gen-connect-go`, `buf`) are pinned in
`backend/tools/tools.go`. TS plugins (`@bufbuild/protoc-gen-es`,
`@connectrpc/protoc-gen-connect-es`) are pinned in `frontend/package.json`
devDeps and invoked from `frontend/node_modules/.bin`.

## Running codegen

```bash
make gen-proto   # buf generate
make gen         # everything (buf + sqlc + mockgen + openapi-typescript)
```

Generated files are **committed**. CI runs `make gen-check` to fail on drift.

## How REST still works

Each RPC in the proto declares a `google.api.http` rule, e.g.

```proto
rpc GetMyRatings(GetMyRatingsRequest) returns (GetMyRatingsResponse) {
  option (google.api.http) = {get: "/api/v1/rating/me"};
}
```

In `backend/cmd/monolith/main.go` we wrap the Connect handler with
`vanguard.NewTranscoder`. The transcoder inspects `google.api.http` at startup
and exposes two routes for the same RPC:

- `/druz9.v1.RatingService/GetMyRatings` (native Connect — JSON or binary proto)
- `GET /api/v1/rating/me` (REST — JSON body, same handler)

Both go through the same bearer-auth middleware, because the transcoder is a
plain `http.Handler` and we `chi.Mount` it inside the existing `requireAuth`
chain. Connect preserves the `http.Request` context, so
`sharedMw.UserIDFromContext(ctx)` still works unchanged inside handlers.

## Adding a new endpoint

1. Edit `proto/druz9/v1/<domain>.proto` — add a new `message` + an RPC with
   a `google.api.http` annotation matching the intended REST path.
2. `make gen-proto` — regenerates Go + TS.
3. Implement the generated `XxxServiceHandler` method in
   `backend/services/<domain>/ports/server.go`.
4. In `main.go`, call `NewXxxServiceHandler` + feed it to the vanguard
   transcoder. If the domain doesn't already have a transcoder wired, add
   the five-line block (`NewXxxServiceHandler`, `NewTranscoder`, REST mount
   inside `gated.Handle(...)`, `connectMux.Handle(...)`, and the prefix in
   `rootHandler`).
5. Update frontend: rewrite the React-Query hook in
   `frontend/src/lib/queries/<domain>.ts` to call
   `createPromiseClient(XxxService, transport)` where `transport` comes from
   `@connectrpc/connect-web`.

## Known snags

- **BSR (Buf Schema Registry) is unreachable in our network** — we vendor
  a tiny subset of googleapis under `proto/google/api/` instead of declaring
  `deps: [buf.build/googleapis/googleapis]` in `buf.yaml`. Re-introduce the
  dep once BSR auth is provisioned.
- **Connect-ES TS client is not yet wired from React components.** Generated
  TS files are committed; existing fetch-based `api()` calls still flow
  through vanguard REST for now. Swap them for Connect transports as each
  page is touched.
- **Proto3 nullability** — proto3 scalars default to zero values when absent,
  whereas some OpenAPI schemas had them optional. Domains that care about
  tri-state (`null` vs `false`) use either `optional bool` or a companion
  `<field>_set` flag (see `admin.ListAdminTasksRequest.is_active_set` for
  the pattern).
- **Streaming + REST** — `ai_native.SubmitPrompt` is a server-streaming RPC.
  Vanguard does NOT transcode streaming RPCs to REST unless the response is
  `google.api.HttpBody`; its REST path returns 415. Native Connect clients
  get full streaming; REST clients should migrate to Connect for that one
  endpoint.
- **solution_hint** — only `admin.AdminTask.solution_hint` exposes the
  field on the wire. Every other message (profile's atlas, daily's kata,
  arena's task, mock's task, native's task, editor's task) MUST NOT include
  it. The role=admin gate in `services/admin/ports/server.go` is the
  load-bearing guard.
