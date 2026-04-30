---
name: add-rpc
description: Add a new Connect-RPC endpoint to the druz9 Go monolith — proto definition, server handler, codegen, and TypeScript client wiring. Use when extending an existing service with a new method, or wiring a fresh service entirely.
---

# Добавить Connect-RPC endpoint

druz9 — contract-first. Источник правды — `.proto` в `proto/druz9/v1/`. Из неё генерится Go-сервер (Connect-RPC) и TS-клиент. Любой shortcut вокруг этого порядка ломает CI.

## Когда применять

- Нужен новый метод в существующем сервисе.
- Нужен новый сервис целиком.
- Добавляется `google.api.http` REST-альтернатива к существующему методу.

## Не применять

- Если фича чисто фронтовая (не нужен бэкенд) — это не задача для proto.
- Если уже есть похожий endpoint и можно расширить параметры — обнови существующий, не плоди.

## Шаги

### 1. Спроектировать proto

Открой `proto/druz9/v1/<service>.proto`. Если сервис новый — создай файл и зарегистрируй в `buf.yaml`/`buf.gen.yaml`.

```proto
service HoneService {
  // Добавляем новый метод
  rpc UpdateNoteTitle(UpdateNoteTitleRequest) returns (UpdateNoteTitleResponse) {
    option (google.api.http) = {
      patch: "/api/v1/hone/notes/{id}/title"
      body: "*"
    };
  }
}

message UpdateNoteTitleRequest {
  string id = 1;
  string title = 2;
}

message UpdateNoteTitleResponse {
  Note note = 1;
}
```

Правила:
- Имена методов в `PascalCase`, поля в `snake_case`.
- Streaming методы помечай явно (`stream` в request/response).
- Если есть REST-альтернатива — обязательно `google.api.http` аннотация.
- Не добавляй имплементационные детали (DB column names) в proto.

### 2. Codegen

```bash
make gen-proto
```

Это поднимет:
- `backend/shared/generated/pb/druz9/v1/<service>.pb.go` — Go типы.
- `backend/shared/generated/pb/druz9/v1/druz9v1connect/<service>.connect.go` — Go server + client interfaces.
- `frontend/src/api/generated/pb/druz9/v1/<service>_connect.ts` — TS клиент.

Эти файлы коммитятся. Не редактируй руками.

### 3. Имплементация в Go

`backend/services/<name>/ports/server.go` — handler-метод, который вызывает app-layer:

```go
func (s *HoneServer) UpdateNoteTitle(
    ctx context.Context,
    req *connect.Request[v1.UpdateNoteTitleRequest],
) (*connect.Response[v1.UpdateNoteTitleResponse], error) {
    userID, err := middleware.UserIDFromContext(ctx)
    if err != nil {
        return nil, httperr.Unauthenticated(err)
    }

    note, err := s.app.UpdateNoteTitle(ctx, app.UpdateNoteTitleInput{
        UserID: userID,
        ID:     req.Msg.Id,
        Title:  req.Msg.Title,
    })
    if err != nil {
        return nil, httperr.FromDomain(err) // mapping ErrNotFound → NotFound и т.п.
    }

    return connect.NewResponse(&v1.UpdateNoteTitleResponse{
        Note: domainNoteToProto(note),
    }), nil
}
```

`backend/services/<name>/app/<usecase>.go` — собственно use-case:

```go
type UpdateNoteTitleInput struct {
    UserID uuid.UUID
    ID     uuid.UUID
    Title  string
}

func (uc *Usecases) UpdateNoteTitle(ctx context.Context, in UpdateNoteTitleInput) (*domain.Note, error) {
    if err := validateTitle(in.Title); err != nil {
        return nil, fmt.Errorf("hone.UpdateNoteTitle: %w", err)
    }
    note, err := uc.notes.UpdateTitle(ctx, in.UserID, in.ID, in.Title)
    if err != nil {
        return nil, fmt.Errorf("hone.UpdateNoteTitle: %w", err)
    }
    return note, nil
}
```

Если в `domain/repo.go` нет нужного метода — добавь интерфейс там, имплементируй в `infra/postgres.go`.

### 4. Тест

`app/<usecase>_test.go` через hand-rolled fake (имплементирующий `domain.NoteRepo`):

```go
func TestUpdateNoteTitle_emptyTitle(t *testing.T) {
    uc := newTestUsecases(t)
    _, err := uc.UpdateNoteTitle(ctx, app.UpdateNoteTitleInput{Title: ""})
    require.ErrorIs(t, err, domain.ErrInvalidTitle)
}
```

Покрываем:
- Happy path.
- Permission denied (другой user).
- Not found.
- Invalid input.

### 5. Wiring

Если сервис новый — зарегистрируй в `backend/cmd/monolith/services/<name>.go`:

```go
func WireHone(d *bootstrap.Deps) v1connect.HoneServiceHandler {
    repo := infra.NewPostgresRepo(d.DB)
    uc := app.NewUsecases(repo, d.LLMChain, d.Embedder)
    return ports.NewHoneServer(uc)
}
```

И в `bootstrap.go` добавь mount:

```go
mux.Handle(v1connect.NewHoneServiceHandler(WireHone(deps), interceptors...))
```

### 6. Frontend wiring

Web (`frontend/`) — typed wrapper в `frontend/src/api/`:

```typescript
import { HoneService } from "@generated/pb/druz9/v1/hone_connect";
import { transport } from "./apiClient";

export const honeClient = createPromiseClient(HoneService, transport);

// Использование в компоненте:
const { mutate } = useMutation({
  mutationFn: (input) => honeClient.updateNoteTitle(input),
});
```

Hone (`hone/`) — то же, но через свой `hone/src/renderer/src/api/transport.ts`.

### 7. Проверки перед коммитом

```bash
make gen-check     # codegen drift
make lint-go       # golangci-lint
make test-go       # go test -race
cd frontend && npm run typecheck
cd hone && npm run typecheck    # если задействован
```

## Anti-patterns

- ❌ Писать REST-handler руками рядом с Connect-handler. `google.api.http` + vanguard это сделают за тебя.
- ❌ Добавлять метод в `ports/` без app-метода. Ports — тонкий слой DTO ↔ domain, бизнес-логика в `app/`.
- ❌ Импортировать сервис A из сервиса B. Если кажется что нужно — это событие в `shared/domain/events.go`.
- ❌ Возвращать сырой `error` из handler'а. `httperr.FromDomain(err)` маппит в Connect-RPC коды.
- ❌ Хардкодить `userID` в request. Достаём из bearer-аутентификации через `middleware.UserIDFromContext`.

## Related

- [.ai/skills/add-migration.md](./add-migration.md) — если нужны новые таблицы
- [.ai/skills/llmchain-task.md](./llmchain-task.md) — если endpoint вызывает LLM
- [docs/tech/backend.md](../../docs/tech/backend.md) — общая структура
