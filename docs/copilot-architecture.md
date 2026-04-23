# Druz9 Copilot — Architecture

Desktop AI assistant for developers. Stealth during screen-sharing, hotkey-driven,
multi-provider. This document defines the system boundaries, contracts, and
directory layout **before any code is written**. API-first: proto contracts land
first, implementation follows.

---

## 1. System overview

```
┌────────────────────────────────────────────────────────────┐
│  Druz9 Copilot (Electron desktop, macOS-first)             │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐ │
│  │ main process │   │ preload      │   │ renderer (React)│ │
│  │ (Node)       │◀─▶│ (contextBridge)◀─▶│ UI + state     │ │
│  │  - hotkeys   │   │              │   │                 │ │
│  │  - capture   │   └──────────────┘   └─────────────────┘ │
│  │  - windows   │                                          │
│  │  - api client│                                          │
│  └──────┬───────┘                                          │
└─────────┼──────────────────────────────────────────────────┘
          │ HTTPS / Connect-RPC (protobuf)
          │ Streaming via Connect server-stream
          ▼
┌────────────────────────────────────────────────────────────┐
│  backend/cmd/monolith  (existing Go monolith)              │
│                                                            │
│  NEW: backend/services/copilot/                            │
│    domain / app / infra / ports                            │
│                                                            │
│  Reuses:  auth (JWT middleware, UserIDFromContext)         │
│           shared/pkg (pgx pool, config, logger, bus)       │
│           ai_native/infra/openrouter.go (LLM client)       │
└──────┬──────────────────────────────────┬──────────────────┘
       │                                  │
       ▼                                  ▼
  ┌─────────┐                      ┌──────────────┐
  │Postgres │                      │ OpenRouter / │
  │ (sqlc)  │                      │ direct APIs  │
  └─────────┘                      └──────────────┘
```

**Key decisions.**

1. **New bounded context `copilot`** — separate from `ai_native` (which is for
   interview practice sessions with trap-injection). Copilot is a real-time
   assistant with different domain: conversations, screenshot ingestion, quota.
2. **Same monolith, same transport.** Connect-RPC with vanguard transcoding
   exactly like other services. Desktop uses the REST-transcoded path for
   unary calls, and the native Connect streaming path for `Analyze`/`Chat`.
3. **LLM provider is shared code, not a service call.** We do not call
   `ai_native` over RPC. Instead, `copilot/infra/llm.go` imports the same
   `openrouter.go` pattern (or lifts it into `shared/pkg/llm/`). Avoids
   network hops on the hot path.
4. **No new auth.** Desktop uses existing JWT issued by the `auth` service.
   Token refresh endpoint already exists; desktop stores tokens in OS keychain.
5. **No hardcoded values in the client.** Everything configurable —
   endpoints, model list, hotkey defaults, stealth flags — comes from
   `CopilotService.GetDesktopConfig` at startup.

---

## 2. Backend — `backend/services/copilot/`

Follows the canonical layout from `ai_native` (domain / app / infra / ports).

### 2.1 Directory layout

```
backend/services/copilot/
├── WIRING.md                  # cmd/monolith integration checklist
├── go.mod / go.sum
├── domain/
│   ├── entity.go              # Conversation, Message, Attachment, Quota
│   ├── repo.go                # Repository + LLMProvider interfaces
│   └── errors.go
├── app/
│   ├── analyze.go             # Screenshot → AI response (streaming)
│   ├── chat.go                # Follow-up message in conversation
│   ├── list_history.go
│   ├── get_conversation.go
│   ├── delete_conversation.go
│   ├── list_providers.go      # Available models (from config + subscription)
│   ├── get_quota.go
│   ├── get_desktop_config.go  # Remote config for client
│   └── rate_response.go
├── infra/
│   ├── postgres.go            # Conversation/Message repos
│   ├── llm_openrouter.go      # Reuses existing openrouter client pattern
│   ├── storage.go             # Screenshot blob storage (S3/local)
│   ├── db/                    # sqlc-generated
│   └── queries/
│       └── copilot.sql
└── ports/
    ├── server.go              # CopilotServiceHandler
    └── models.go              # proto↔domain converters
```

### 2.2 Domain entities

```go
// domain/entity.go
type Conversation struct {
    ID        uuid.UUID
    UserID    uuid.UUID
    Title     string        // Auto-generated from first message
    Model     string        // Provider-qualified, e.g. "openai:gpt-5-mini"
    CreatedAt time.Time
    UpdatedAt time.Time
}

type Message struct {
    ID             uuid.UUID
    ConversationID uuid.UUID
    Role           MessageRole   // user | assistant | system
    Content        string        // Markdown (for voice: contains the transcript)
    HasScreenshot  bool          // flag only — the image itself is not stored
    TokensIn       int
    TokensOut      int
    LatencyMs      int
    Rating         *int          // -1 | 0 | +1 (after user feedback)
    CreatedAt      time.Time
}

// NOTE: Screenshots are NEVER persisted. They are streamed directly from the
// client → LLM provider → dropped after the completion returns. Only a boolean
// flag on the message record indicates that the user attached an image.
// Rationale: privacy, storage cost, simplicity. Trade-off: history cannot
// redisplay the original screenshot — the assistant's answer is the artifact.

type Quota struct {
    Plan         string   // free | pro | team
    RequestsUsed int
    RequestsCap  int      // -1 means unlimited
    ResetsAt     time.Time
    ModelsAllowed []string // provider-qualified ids
}

type LLMProvider interface {
    Stream(ctx context.Context, req CompletionRequest) (<-chan StreamEvent, error)
    Complete(ctx context.Context, req CompletionRequest) (CompletionResponse, error)
}
```

### 2.3 Database schema (new migration)

```sql
-- migrations/NNNNN_copilot.sql
CREATE TABLE copilot_conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX copilot_conversations_user_updated
    ON copilot_conversations(user_id, updated_at DESC);

CREATE TABLE copilot_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    content         TEXT NOT NULL,
    has_screenshot  BOOLEAN NOT NULL DEFAULT FALSE,  -- flag only, image not stored
    tokens_in       INT NOT NULL DEFAULT 0,
    tokens_out      INT NOT NULL DEFAULT 0,
    latency_ms      INT NOT NULL DEFAULT 0,
    rating          SMALLINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX copilot_messages_conv_created
    ON copilot_messages(conversation_id, created_at);

-- NOTE: Screenshots are intentionally NOT persisted. They flow
-- client → backend → LLM → discarded after the completion returns.
-- If we ever need to show originals in history, add copilot_attachments back.

CREATE TABLE copilot_quotas (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan            TEXT NOT NULL DEFAULT 'free',
    requests_used   INT NOT NULL DEFAULT 0,
    requests_cap    INT NOT NULL DEFAULT 20,
    resets_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '1 day'),
    models_allowed  TEXT[] NOT NULL DEFAULT ARRAY['openai:gpt-4o-mini']::TEXT[],
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.4 Configuration (no hardcode policy)

Everything client-visible lives in **`GetDesktopConfig` response**, driven by
server-side `CopilotConfig` YAML/env:

- Available models per plan (name, id, provider, speed-class, context window)
- Default model per plan
- Hotkey defaults (OS-qualified)
- Feature flags (voice, masquerade, stealth-overlay)
- Paywall copy & pricing (localized)
- Stealth compat matrix: which macOS / Chrome versions are known-bad
- Update channel URL
- Analytics opt-in default

The client **never** ships with hardcoded model names, pricing, or copy.
Defaults live in `backend/services/copilot/infra/config/defaults.yaml` and
are overridable by env.

---

## 3. API contracts — `proto/druz9/v1/copilot.proto`

Full proto lives in repo. Summary:

```protobuf
service CopilotService {
  // Unary: user taps screenshot, sends image + prompt, gets streaming response
  rpc Analyze(AnalyzeRequest) returns (stream AnalyzeEvent) {
    option (google.api.http) = {
      post: "/api/v1/copilot/analyze"
      body: "*"
    };
  }

  // Follow-up in existing conversation
  rpc Chat(ChatRequest) returns (stream ChatEvent) {
    option (google.api.http) = {
      post: "/api/v1/copilot/conversations/{conversation_id}/chat"
      body: "*"
    };
  }

  rpc ListHistory(ListHistoryRequest) returns (ListHistoryResponse) {
    option (google.api.http) = { get: "/api/v1/copilot/history" };
  }

  rpc GetConversation(GetConversationRequest) returns (Conversation) {
    option (google.api.http) = { get: "/api/v1/copilot/conversations/{id}" };
  }

  rpc DeleteConversation(DeleteConversationRequest) returns (google.protobuf.Empty) {
    option (google.api.http) = { delete: "/api/v1/copilot/conversations/{id}" };
  }

  rpc ListProviders(ListProvidersRequest) returns (ListProvidersResponse) {
    option (google.api.http) = { get: "/api/v1/copilot/providers" };
  }

  rpc GetQuota(GetQuotaRequest) returns (Quota) {
    option (google.api.http) = { get: "/api/v1/copilot/quota" };
  }

  rpc GetDesktopConfig(GetDesktopConfigRequest) returns (DesktopConfig) {
    option (google.api.http) = { get: "/api/v1/copilot/desktop-config" };
  }

  rpc RateMessage(RateMessageRequest) returns (google.protobuf.Empty) {
    option (google.api.http) = {
      post: "/api/v1/copilot/messages/{message_id}/rate"
      body: "*"
    };
  }
}

message AnalyzeRequest {
  // New conversation or follow-up (if conversation_id set)
  string conversation_id = 1;      // optional
  string prompt_text = 2;          // optional — user's accompanying text
  string model = 3;                // provider-qualified, or empty → default
  repeated AttachmentInput attachments = 4;
  ClientContext client = 5;        // os, app version, hotkey used, focused_app hint
}

message AttachmentInput {
  AttachmentKind kind = 1;
  bytes data = 2;                  // base64 over JSON; raw bytes over Connect
  string mime_type = 3;            // image/png, audio/wav
  int32 width = 4;
  int32 height = 5;
}

message AnalyzeEvent {
  oneof event {
    ConversationCreated created = 1;  // emitted first (contains conversation_id, message_id)
    TokenDelta delta = 2;             // incremental assistant text
    Done done = 3;                    // final message metadata (tokens, latency)
    Error error = 4;
  }
}
```

**Streaming decisions.**

- Connect server-streaming, same as `ai_native.SubmitPrompt`.
- REST transcoding returns a single final JSON body (vanguard limitation) —
  acceptable fallback for non-streaming clients.
- Desktop uses the **native Connect path** `/druz9.v1.CopilotService/Analyze`
  over HTTPS to get real token deltas.
- On transient network error mid-stream: client replays `Chat` with
  `resume_from_message_id` (idempotency via message id).

---

## 4. Desktop client — `desktop/`

### 4.1 Stack decision

- **Electron + electron-vite + React 18 + TypeScript**.
- State: **zustand** (light, no ceremony).
- Styling: **CSS variables from `tokens.css` (generated from design tokens)** +
  CSS Modules. No styled-components — keep the renderer bundle small.
- API client: **@connectrpc/connect-web** with generated TypeScript stubs from
  the same `copilot.proto`. No duplicate schemas.
- Hotkeys: **electron-globalShortcut** in main process.
- Screenshots: **desktopCapturer** API (main process).
- Stealth window: `BrowserWindow.setContentProtection(true)` on macOS —
  verified to hide from Zoom/Meet/Chrome `getDisplayMedia`.
- Secure token storage: **keytar** (OS keychain on macOS/Windows).
- Auto-update: **electron-updater** (Squirrel.Mac on macOS).

### 4.2 Directory layout

```
desktop/
├── package.json
├── tsconfig.json
├── electron.vite.config.ts
├── electron-builder.yml            # build config for .app / .dmg
├── resources/
│   ├── icon.icns                   # default app icon
│   ├── icon.png
│   └── masquerade/                 # icons for "Notes", "Telegram" disguises
├── src/
│   ├── main/                       # Electron main process (Node)
│   │   ├── index.ts                # entry
│   │   ├── config/
│   │   │   └── bootstrap.ts        # fetches DesktopConfig on startup
│   │   ├── windows/
│   │   │   ├── compact.ts
│   │   │   ├── expanded.ts
│   │   │   ├── settings.ts
│   │   │   ├── onboarding.ts
│   │   │   ├── screenshot-overlay.ts
│   │   │   └── window-manager.ts
│   │   ├── hotkeys/
│   │   │   ├── registry.ts
│   │   │   └── actions.ts
│   │   ├── capture/
│   │   │   ├── screenshot.ts       # area + full-screen
│   │   │   └── voice.ts            # future
│   │   ├── auth/
│   │   │   ├── keychain.ts         # keytar wrapper
│   │   │   └── oauth.ts            # deep-link callback handler
│   │   ├── api/
│   │   │   ├── client.ts           # Connect-RPC transport
│   │   │   ├── analyze.ts          # streaming wrapper
│   │   │   └── generated/          # buf-generated TS stubs (git-ignored)
│   │   ├── permissions/
│   │   │   └── macos.ts            # Screen Recording, Accessibility checks
│   │   ├── masquerade/
│   │   │   └── rename.ts           # process name + icon swap
│   │   ├── updater/
│   │   │   └── index.ts
│   │   └── ipc/
│   │       ├── handlers.ts         # typed IPC handlers
│   │       └── channels.ts         # channel name constants
│   ├── preload/
│   │   └── index.ts                # contextBridge.exposeInMainWorld('druz9', api)
│   ├── renderer/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── app.tsx
│   │   ├── screens/                # mirrors design deliverables
│   │   │   ├── compact/
│   │   │   ├── expanded-chat/
│   │   │   ├── settings/
│   │   │   ├── onboarding/
│   │   │   ├── permissions/
│   │   │   ├── paywall/
│   │   │   ├── provider-picker/
│   │   │   ├── history/
│   │   │   └── screenshot-overlay/
│   │   ├── components/             # primitives: Button, Kbd, StatusDot, ...
│   │   ├── hooks/
│   │   │   ├── use-conversation.ts
│   │   │   ├── use-config.ts
│   │   │   └── use-hotkey-label.ts
│   │   ├── stores/
│   │   │   ├── auth.ts
│   │   │   ├── config.ts           # DesktopConfig from backend
│   │   │   ├── conversations.ts
│   │   │   └── quota.ts
│   │   ├── api/
│   │   │   └── index.ts            # wraps window.druz9 IPC
│   │   └── styles/
│   │       ├── tokens.css          # from design, source of truth
│   │       └── globals.css
│   └── shared/                     # types used in main AND renderer
│       ├── ipc.ts                  # IPC contract (typed)
│       ├── config.ts               # DesktopConfig type (matches proto)
│       └── errors.ts
└── native/                         # Phase 2 — Swift helper for deep stealth
```

### 4.3 IPC contract (main ↔ renderer)

Typed in `src/shared/ipc.ts`. Channels:

```typescript
export type IpcContract = {
  // Renderer → Main (invoke, awaitable)
  'auth:login-telegram':   () => Promise<AuthSession>;
  'auth:logout':           () => Promise<void>;
  'auth:session':          () => Promise<AuthSession | null>;

  'config:get':            () => Promise<DesktopConfig>;
  'config:refresh':        () => Promise<DesktopConfig>;

  'capture:screenshot-area': () => Promise<CaptureResult>;
  'capture:screenshot-full': () => Promise<CaptureResult>;

  'analyze:start':  (input: AnalyzeInput)  => Promise<{ streamId: string }>;
  'analyze:cancel': (streamId: string)     => Promise<void>;

  'hotkeys:register':     (bindings: HotkeyBinding[]) => Promise<void>;
  'hotkeys:capture-once': () => Promise<string>;  // for shortcut recorder

  'windows:show':        (name: WindowName) => Promise<void>;
  'windows:hide':        (name: WindowName) => Promise<void>;
  'windows:toggle-stealth': (on: boolean)   => Promise<void>;

  'permissions:check':   () => Promise<PermissionState>;
  'permissions:request': (p: PermissionKind) => Promise<void>;

  // Main → Renderer (events)
  'event:analyze-delta':   (p: { streamId: string; text: string }) => void;
  'event:analyze-done':    (p: { streamId: string; metadata: MessageMeta }) => void;
  'event:analyze-error':   (p: { streamId: string; error: ApiError }) => void;
  'event:hotkey-fired':    (p: { action: HotkeyAction }) => void;
  'event:config-updated':  (p: DesktopConfig) => void;
  'event:quota-updated':   (p: Quota) => void;
};
```

**Renderer never imports Electron or Node APIs.** All system access goes
through `window.druz9.*` exposed by preload.

---

## 5. Contract-first workflow

1. Land `proto/druz9/v1/copilot.proto` + regenerate Go and TS stubs
   (`make gen-proto` — existing Makefile target).
2. Land migration + sqlc queries. `make gen-sqlc` produces typed Go.
3. Stub `backend/services/copilot/` app/infra/ports. All unit tests pass
   with fake LLM provider before desktop connects.
4. Wire into `cmd/monolith`. Verify `curl /api/v1/copilot/desktop-config`
   returns a sensible default payload.
5. **Only then** scaffold `desktop/`. First run of the app fetches
   `desktop-config` and renders the compact window — nothing hardcoded.
6. Iterate: hotkeys → screenshot capture → analyze streaming → history →
   settings → paywall → masquerade.

---

## 6. What Phase 1 (MVP) intentionally excludes

- Windows/Linux builds (macOS only).
- Voice mode (proto message is defined but not implemented client-side).
- Multi-provider key-bring-your-own (single `Druz9 Cloud` provider only;
  UI shows the dropdown but only `Druz9 Cloud` is enabled).
- Auto-update (ship manual `.dmg` downloads).
- Notarization (dev-signed only; users accept unidentified-developer warning).
- Masquerade icon swap (UI visible, feature stubbed to log-only).
- Team plan.

All of these are defined in the contract so they can be enabled without
breaking changes.

---

## 7. Resolved decisions (locked)

1. **Screenshots are not persisted.** Client sends image bytes inline in the
   proto request; the backend forwards them to the LLM provider and discards
   them once the completion returns. Only a boolean `has_screenshot` flag
   on the message record tells history "this turn included an image". No S3,
   no attachments table.
2. **LLM provider code is copied, not shared.** `copilot/infra/llm_openrouter.go`
   is a fresh copy of the `ai_native` pattern. Phase 1 favors isolation;
   lift into `shared/pkg/llm/` only when a third consumer appears.
3. **Telegram OAuth is the primary login for desktop.** The existing Telegram
   bot / backend endpoint already issues JWTs from Telegram identity. Desktop
   flow: open browser → Telegram Login Widget → callback
   `druz9://auth/telegram?token=...` → main process catches deep-link →
   stores tokens in OS keychain. The `druz9://` URL scheme must be registered
   in the macOS app's `Info.plist`.
4. **Proto location: `proto/druz9/v1/copilot.proto`** following existing
   convention.

---

## 8. Remaining work (roadmap to MVP)

### Phase 0 — Contracts (before any implementation)
- [ ] **Write `proto/druz9/v1/copilot.proto`** — full service definition per §3
      with all 9 RPCs, messages, and `google.api.http` annotations.
- [ ] **Run `make gen-proto`** — regenerate Go stubs
      (`backend/shared/generated/pb/druz9/v1/`) and TypeScript stubs
      (`frontend/src/api/generated/pb/`, to be symlinked/copied into desktop).
- [ ] **Write migration `backend/migrations/NNNNN_copilot.sql`** — the 3
      tables from §2.3 (without the dropped attachments table).
- [ ] **Write `backend/services/copilot/infra/queries/copilot.sql`** — sqlc
      queries for Conversation/Message/Quota repos.
- [ ] **Run `make gen-sqlc`** — generate typed Go query code.
- [ ] **Add `backend/services/copilot/infra/config/defaults.yaml`** — default
      `DesktopConfig` payload (model list, hotkeys, feature flags).

### Phase 1 — Backend service skeleton
- [ ] `copilot/domain/` — entity.go, repo.go, errors.go.
- [ ] `copilot/infra/postgres.go` — Conversation / Message / Quota repos.
- [ ] `copilot/infra/llm_openrouter.go` — copy from ai_native, adapt for
      streaming and vision input (image-aware messages).
- [ ] `copilot/app/` — 9 use cases (Analyze, Chat, ListHistory,
      GetConversation, DeleteConversation, ListProviders, GetQuota,
      GetDesktopConfig, RateMessage).
- [ ] `copilot/ports/server.go` + `ports/models.go` — proto↔domain
      converters, Connect-RPC handler.
- [ ] **Unit tests** for every use case with a fake LLM provider.
- [ ] `copilot/WIRING.md` — integration checklist for monolith.

### Phase 2 — Wire into monolith (COMPLETE ✅)
- [x] `backend/cmd/monolith/services/copilot.go` — wiring module assembles
      repos, LLM, config provider, 10 use cases, ports server.
- [x] `go.work` includes `./backend/services/copilot`.
- [x] `backend/cmd/monolith/go.mod` has `require druz9/copilot ...` +
      `replace druz9/copilot => ../../services/copilot`.
- [x] `bootstrap/bootstrap.go` modules slice includes
      `services.NewCopilot(deps)`.
- [x] REST routes mounted under `/api/v1/copilot/*`.
- [x] `backend/services/copilot/WIRING.md` — integration checklist.
- [x] Full monolith builds cleanly (`go build ./...`).
- [ ] Integration test with real JWT — deferred to Phase 3 once the
      desktop client can drive real requests.
- [ ] Per-IP rate-limit middleware on Analyze/Chat — deferred; quota
      inside the use case is already the primary defense.

### Phase 3 — Desktop scaffold (`desktop/`)
- [ ] `package.json`, `tsconfig.json`, `electron.vite.config.ts`,
      `electron-builder.yml`.
- [ ] Main process: window manager, hotkey registry, screenshot capture,
      macOS permissions wrapper, deep-link handler for
      `druz9://auth/telegram`.
- [ ] Preload: typed `contextBridge` per §4.3 IPC contract.
- [ ] Renderer: React + zustand + `tokens.css` from design.
- [ ] API client: Connect-RPC transport with streaming handler for Analyze.
- [ ] Keytar wrapper for token storage.

### Phase 4 — UI screens (wire design → code)
- [ ] Compact window + 4 states.
- [ ] Expanded chat + streaming rendering + markdown/code blocks.
- [ ] Screenshot overlay (area picker).
- [ ] Provider picker modal.
- [ ] Onboarding flow (welcome → permissions → Telegram login → demo).
- [ ] Permissions screens (macOS Screen Recording / Accessibility).
- [ ] Settings (tabs: General, Hotkeys, AI Providers, Subscription, About).
- [ ] History panel.
- [ ] Paywall / quota-reached modal.
- [ ] Menu bar states.
- [ ] Masquerade preview (name & icon swap — UI only in MVP).

### Phase 5 — Ship prep
- [ ] Dev code-signing cert on the machine (so `.app` launches without
      Gatekeeper block during testing).
- [ ] `npm run build:mac` produces a working `.dmg`.
- [ ] Smoke test on real Zoom / Meet / Chrome screen-share: compact window
      is invisible to the viewer, visible to the user.
- [ ] README with "how to run locally" + "how to build `.dmg`".
- [ ] **Out of scope for MVP** (see §6): notarization, auto-update, voice,
      BYO API keys, Windows build, masquerade activation, team plan.
