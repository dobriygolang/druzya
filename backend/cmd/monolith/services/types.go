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
	"druz9/shared/pkg/config"
	"druz9/shared/pkg/eventbus"
	"druz9/shared/pkg/killswitch"
	"druz9/shared/pkg/llmchain"
	"druz9/shared/pkg/quota"

	"github.com/go-chi/chi/v5"
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

	// IntelligenceMemoryHook — optional. Set during bootstrap после
	// services.NewIntelligence(...). Hone-handlers'ы дёргают его
	// для записи side-effect episodes (reflection / standup / plan-events
	// / note-create / focus-session-done). Тип = hone/domain.MemoryHook
	// (узкий interface, hone-domain'ный) — monolith Adapter имплементирует.
	// nil-safe: hone-use-cases checkают перед вызовом.
	IntelligenceMemoryHook honeDomain.MemoryHook
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
