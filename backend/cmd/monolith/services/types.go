// Package services holds per-domain wiring for the monolith. Each file
// constructs one bounded context (repositories + use cases + ports) and
// returns a Module describing the routes, subscribers and background tasks
// it contributes.
package services

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	authApp "druz9/auth/app"
	honeDomain "druz9/hone/domain"
	intelApp "druz9/intelligence/app"
	miDomain "druz9/mock_interview/domain"
	"druz9/shared/pkg/config"
	"druz9/shared/pkg/eventbus"
	"druz9/shared/pkg/killswitch"
	"druz9/shared/pkg/llmchain"
	"druz9/shared/pkg/quota"
	subApp "druz9/subscription/app"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Deps holds shared infrastructure handed to every per-domain wirer.
//
// We keep this struct deliberately flat — fields here are the few primitives
// that almost every service needs (db pool, redis, log, bus, config). Domain
// specific deps stay private to the file that wires them.
type Deps struct {
	Cfg         *config.Config
	Log         *slog.Logger
	Pool        *pgxpool.Pool
	Redis       *redis.Client
	Bus         *eventbus.InProcess
	TokenIssuer *authApp.TokenIssuer
	Now         func() time.Time
	// LLMChain is the shared multi-provider router. Typed as the
	// ChatClient interface rather than *llmchain.Chain so that the
	// monolith can opt-in to a decorator (semantic-cache via
	// llmcache.CachingChain) without touching each consumer.
	//
	// nil when no provider keys were configured at boot — services
	// must check and degrade to their feature-disabled branch (same
	// contract as OPENROUTER_API_KEY=""). Built once in bootstrap;
	// wiring details live in services/llmchain.go.
	LLMChain llmchain.ChatClient

	// KillSwitch — operator-controlled feature disable. Handlers on
	// the hot path (documents upload, URL fetch, transcription,
	// copilot analyze/suggestion) check this before doing work and
	// return 503 when flipped. nil-safe (always off).
	KillSwitch *killswitch.Switch

	// TokenQuota — per-user daily LLM token cap. Protects the shared
	// Groq free-tier pool from single-account drain. Copilot
	// Analyze/Suggest check before opening a stream and consume after
	// Done. nil-safe.
	TokenQuota *quota.DailyTokenQuota

	// HoneNotificationSender — optional. Set during bootstrap after notify
	// service wires. Used by hone.SendCueSessionToTelegram to push markdown
	// to user's Telegram chat. nil = TG follow-up disabled (UI shows
	// "telegram not linked").
	HoneNotificationSender honeDomain.NotificationSender

	// IntelligenceMemoryHook — optional. Set during bootstrap после
	// services.NewIntelligence(...). Hone-handlers'ы дёргают его
	// для записи side-effect episodes (reflection / standup / plan-events
	// / note-create / focus-session-done). Тип = hone/domain.MemoryHook
	// (узкий interface, hone-domain'ный) — monolith Adapter имплементирует.
	// nil-safe: hone-use-cases checkают перед вызовом.
	IntelligenceMemoryHook honeDomain.MemoryHook

	// IntelligenceMockMemoryHook — same idea as IntelligenceMemoryHook
	// but for the mock_interview bounded context. FinishPipeline writes
	// a `mock_pipeline_finished` episode through this hook so future
	// Daily Briefs can reference past sessions ("неделю назад sysdesign
	// 32, сегодня 71 — рост"). nil-safe: orchestrator guards every
	// call. Set in bootstrap right after NewIntelligence.
	IntelligenceMockMemoryHook miDomain.MemoryHook

	// IntelligenceMemory — direct access to the Coach episode store.
	// Used by chi-direct services (codex /open) that aren't bounded
	// contexts of their own and don't need a typed hook interface.
	// nil-safe; consumers guard.
	IntelligenceMemory *intelApp.Memory

	// StorageGate — Phase C quota guard. Hone оборачивает свои
	// write-routes (notes/whiteboards POST'ы) этим middleware'ом, чтобы
	// возвращать 413 quota_exceeded при превышении тарифа. nil-safe:
	// при отсутствии gate'а write'ы пропускаются без проверки. Built в
	// bootstrap'е до NewHone. Interface — конкретный тип живёт в
	// services/storage package (был вынесен туда, чтобы избежать
	// circular import services/types.go ↔ services/storage).
	StorageGate StorageGate

	// SyncHeartbeat — Phase C-3.1 device-revocation gate + throttled
	// last_seen_at UPDATE. Подключается в router.go gated REST chain.
	// nil-safe: при nil middleware превращается в passthrough.
	// Interface — конкретный тип (*sync.Heartbeat) живёт в
	// services/sync (вынесен туда, чтобы избежать cycle через Deps).
	SyncHeartbeat SyncHeartbeatGate

	// SyncEventBroker — Phase C-6.2 in-process pubsub для realtime SSE
	// push. Write-handlers (yjs append, vault encrypt/decrypt, sync push)
	// дёргают Publish*; SSE-subscriber'ы получают fan-out. nil-safe: при
	// nil publish — no-op (callers проверяют). Built в bootstrap до
	// модулей которые его используют. Interface — конкретный тип
	// (*sync.Broker) живёт в services/sync.
	SyncEventBroker SyncBroker

	// Quota wiring — populated by NewSubscription и потребляется enforce-
	// middleware'ами в whiteboard / editor / notes. Все three nil-safe:
	// при nil enforcement бесшумно skip'ается (не блокируем юзеров если
	// subscription-сервис не loaded — feature-degradation).
	QuotaResolver    *subApp.PolicyResolver
	QuotaTierGetter  *subApp.GetTier
	QuotaUsageReader subApp.UsageReader

	// SetTierUC — единый use-case изменения tier'а (admin SetTier +
	// Boosty webhook sync). Shared pointer чтобы другие модули могли
	// подписаться на side-effect: после Upsert subscription.plan
	// нужно flip'нуть copilot_quotas.plan + cap (раньше не sync'илось,
	// юзер платил но видел free-лимиты до перезагрузки сервиса).
	// Set'ится в WireSubscriptionQuota; NewCopilot устанавливает
	// SetTierUC.OnTierChanged hook.
	SetTierUC *subApp.SetTier
}

// StorageGate is the cross-domain interface Hone (and any future writer)
// uses to wrap write-routes with the quota guard. Конкретный тип
// (*storage.StorageGate) живёт в `cmd/monolith/services/storage` —
// объявлен здесь как interface, чтобы services/types.go не импортировал
// services/storage (тот импортирует services для Deps/Module → cycle).
type StorageGate interface {
	Middleware(h http.Handler) http.Handler
}

// SyncBroker — interface that Deps.SyncEventBroker exposes to consumers
// (hone vault/yjs use-cases via honeDomain.SyncEventPublisher). Конкретный
// тип (*sync.Broker) живёт в `cmd/monolith/services/sync` — narrow
// interface here предотвращает cycle services/types.go ↔ services/sync.
type SyncBroker interface {
	PublishYjsAppend(userID uuid.UUID, entityKind, parentID string, originDeviceID uuid.UUID)
	PublishSyncChange(userID uuid.UUID, table string, originDeviceID uuid.UUID)
}

// SyncHeartbeatGate — interface that Deps.SyncHeartbeat exposes to
// router.go for middleware chaining. Конкретный тип (*sync.Heartbeat)
// живёт в `cmd/monolith/services/sync`.
type SyncHeartbeatGate interface {
	Middleware(next http.Handler) http.Handler
}

// Module is what every NewXxx returns: enough metadata for router.go to
// mount the domain and for bootstrap to register subscriptions, run
// background tasks and tear it all down.
type Module struct {
	// ConnectPath / ConnectHandler — native Connect-RPC mount. ConnectHandler
	// is already wrapped in a vanguard transcoder.
	ConnectPath    string
	ConnectHandler http.Handler

	// RequireConnectAuth toggles whether the connect mount sits behind
	// requireAuth. Auth itself is the only domain that does NOT, since the
	// login RPCs issue tokens.
	RequireConnectAuth bool

	// MountREST registers the REST routes for this module on the gated
	// /api/v1 sub-router. nil when the domain has no REST surface.
	MountREST func(r chi.Router)

	// MountPublicREST mounts routes on /api/v1 BUT outside the auth gate.
	// Use sparingly — currently only for guest-join endpoints (whiteboards /
	// code-rooms) where no token exists yet. The handler MUST do its own
	// authorization (e.g. visibility=private check).
	MountPublicREST func(r chi.Router)

	// MountWS registers WebSocket routes on the /ws sub-router. nil when the
	// domain has no sockets.
	MountWS func(r chi.Router)

	// MountRoot registers routes on the ROOT chi.Router, outside /api/v1
	// and outside any auth gate. Use sparingly — currently only used by
	// og-meta SEO routes (Phase 6: /c/{slug} og-stub for link-preview
	// bots). nil when the domain has no root-level surface.
	MountRoot func(r chi.Router)

	// Subscribers wires cross-domain event handlers onto the bus. Called
	// once during bootstrap.
	Subscribers []func(bus *eventbus.InProcess)

	// Background — long-running goroutines started under the root context.
	Background []func(ctx context.Context)

	// Shutdown closures, invoked in reverse-of-registration order during
	// graceful termination.
	Shutdown []func(ctx context.Context) error
}
