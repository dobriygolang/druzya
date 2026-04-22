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
	"druz9/shared/pkg/config"
	"druz9/shared/pkg/eventbus"

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

	// Subscribers wires cross-domain event handlers onto the bus. Called
	// once during bootstrap.
	Subscribers []func(bus *eventbus.InProcess)

	// Background — long-running goroutines started under the root context.
	Background []func(ctx context.Context)

	// Shutdown closures, invoked in reverse-of-registration order during
	// graceful termination.
	Shutdown []func(ctx context.Context) error
}
