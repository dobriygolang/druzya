# whiteboard_rooms

Shared multiplayer whiteboards (bible §9 Phase 6.5.4). Opaque Yjs-relay via
WebSocket; canvas binding is Excalidraw on the Hone client.

Private whiteboards live in a **different** bounded context (`hone` service,
migration 00015). Do not merge.

## Layout

```
domain/       Room, Participant entities + repo interfaces + errors
app/          Use cases: CreateRoom / GetRoom / ListMyRooms / DeleteRoom
              + PersistSnapshot (called from the hub's debounce timer)
infra/        Hand-rolled pgx repos (matches hone/ convention, not sqlc)
ports/
  server.go   Connect-RPC handlers — requires `make gen-proto`
  ws.go       Hub + roomHub + connection — Yjs opaque relay
  ws_handler.go  HTTP upgrade + auth + snapshot hydration
```

## Wire protocol (WebSocket)

Client and server exchange JSON envelopes `{kind, data}`:

| kind        | dir | payload shape              | persisted |
|-------------|-----|----------------------------|-----------|
| `snapshot`  | S→C | `{update: base64}`         | yes (hydration only — sent once on join) |
| `update`    | C→S→C | `{update: base64}` (Yjs diff) | last one stored as full state after 30s debounce |
| `awareness` | C↔S↔C | opaque (cursor, selection) | no |
| `ping`/`pong` | C↔S | null | — |

**Late-joiner flow.** On handshake the server sends a `snapshot` frame
carrying the most recent full Yjs state (in-memory hub first, Postgres
fallback). The client applies it via `Y.applyUpdate` before streaming its
own updates.

**Persistence.** `Hub.scheduleFlush` debounces every `update`/`snapshot`
by 30 s. On fire, `PersistSnapshot` writes the blob to
`whiteboard_rooms.snapshot` and extends `expires_at` by 24 h. The
empty-room exit also flushes immediately so the final state doesn't live
only in RAM.

## To finish wiring after merge

The monolith module is already registered (`services.NewWhiteboardRooms`
in `bootstrap.go`); the Connect handler import from
`druz9v1connect.NewWhiteboardRoomsServiceHandler` depends on regenerated
proto.

```bash
# 1. Regenerate proto bindings (buf + protoc-gen-*)
make gen-proto

# 2. Tidy up each go.mod — `go work sync` populates the new module.
go work sync

# 3. Apply the migration.
goose -dir backend/migrations postgres "$DATABASE_URL" up

# 4. Vet + tests.
cd backend/services/whiteboard_rooms && go vet ./...
golangci-lint run ./backend/services/whiteboard_rooms/...
```

## Client integration sketch (Hone / Excalidraw)

```ts
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Excalidraw } from '@excalidraw/excalidraw';

const ydoc = new Y.Doc();
const yElements = ydoc.getArray<Y.Map<unknown>>('elements');

// Custom envelope adapter: our server uses {kind, data:{update:b64}} —
// y-websocket's default binary protocol doesn't match, so we wrap it.
// See hone/src/renderer/src/api/whiteboard.ts (TBD).
```

See bible §9 for the product surface.
