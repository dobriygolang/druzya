// HTTP routing — chi router with the standard middleware chain, the
// connect-rpc mux mounted at root and a thin dispatcher that hands
// /druz9.v1.* paths to Connect before chi normalises them.
//
// Behaviour mirrors the pre-refactor monolith one-for-one: same middleware
// order, same /api/v1 gate (3 auth login paths and the public profile
// lookup bypass bearer auth), same WS routes outside /api/v1, same
// metrics + health placement.
package bootstrap

import (
	"log/slog"
	"net/http"
	"strings"

	"druz9/cmd/monolith/services"
	"druz9/shared/pkg/logger"
	"druz9/shared/pkg/metrics"
	mw "druz9/shared/pkg/middleware"
	dotel "druz9/shared/pkg/otel"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// routerDeps groups the inputs the router needs that aren't expressible
// via Module alone (auth gate function, notify webhook, infra handles for
// /health/ready).
type routerDeps struct {
	Log         *slog.Logger
	Pool        *pgxpool.Pool
	Redis       *redis.Client
	RequireAuth func(http.Handler) http.Handler
	Notify      *services.NotifyModule
	Modules     []*services.Module // every Module in mount order, including auth's
}

func buildHandler(d routerDeps) http.Handler {
	r := chi.NewRouter()
	r.Use(mw.RequestID)
	// Tracer must come BEFORE the request logger so the logger's trace_id
	// attr (added by logger.traceHandler) sees an active span.
	r.Use(dotel.WithTracer(dotel.Tracer("druz9/http")))
	r.Use(logger.Middleware(d.Log))
	r.Use(mw.Logger(d.Log))
	r.Use(mw.Recover(d.Log))
	// Prometheus per-route latency / error / count instrumentation.
	r.Use(metrics.ChiMiddleware)

	r.Get("/health", handleHealth)
	r.Get("/health/ready", readyHandler(d.Pool, d.Redis))
	// SECURITY: /metrics is INTERNAL-ONLY; nginx restricts access at the
	// edge (infra/nginx/nginx.prod.conf) — never expose externally.
	r.Handle("/metrics", metrics.Handler())

	// WebSockets live OUTSIDE /api/v1 — they auth via `?token=` query param
	// and must NOT be wrapped in the requireAuth middleware.
	r.Route("/ws", func(ws chi.Router) {
		for _, m := range d.Modules {
			if m != nil && m.MountWS != nil {
				m.MountWS(ws)
			}
		}
	})

	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"pong":true}`))
		})
		// TODO (openapi): add to shared/openapi.yaml so codegen owns the route.
		api.Post("/notify/telegram/webhook", d.Notify.WebhookHandler.HandlerFunc())

		api.Group(func(gated chi.Router) {
			gated.Use(restAuthGate(d.RequireAuth))
			for _, m := range d.Modules {
				if m != nil && m.MountREST != nil {
					m.MountREST(gated)
				}
			}
		})
	})

	// Native Connect paths live at the root (no /api/v1 prefix). chi's URL
	// normalisation breaks dotted service names, so we wrap chi in a plain
	// dispatcher and intercept /druz9.v1.* before chi sees them.
	connectMux := http.NewServeMux()
	for _, m := range d.Modules {
		if m == nil || m.ConnectPath == "" {
			continue
		}
		if m.RequireConnectAuth {
			connectMux.Handle(m.ConnectPath, d.RequireAuth(m.ConnectHandler))
		} else {
			connectMux.Handle(m.ConnectPath, m.ConnectHandler)
		}
	}

	prefixes := make([]string, 0, len(d.Modules))
	for _, m := range d.Modules {
		if m != nil && m.ConnectPath != "" {
			prefixes = append(prefixes, m.ConnectPath)
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		for _, p := range prefixes {
			if strings.HasPrefix(req.URL.Path, p) {
				connectMux.ServeHTTP(w, req)
				return
			}
		}
		r.ServeHTTP(w, req)
	})
}

// restAuthGate is the per-request bearer-auth middleware applied to every
// REST route except a small allow-list (the three login endpoints, plus
// the public profile lookup at /api/v1/profile/{username} which has no
// /me prefix).
func restAuthGate(requireAuth func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	publicPaths := map[string]struct{}{
		"/api/v1/auth/yandex":   {},
		"/api/v1/auth/telegram": {},
		"/api/v1/auth/refresh":  {},
	}
	isPublic := func(p string) bool {
		if _, ok := publicPaths[p]; ok {
			return true
		}
		// /api/v1/profile/{username} — public, but /api/v1/profile/me*
		// is NOT.
		if strings.HasPrefix(p, "/api/v1/profile/") && !strings.HasPrefix(p, "/api/v1/profile/me") {
			return true
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isPublic(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			requireAuth(next).ServeHTTP(w, r)
		})
	}
}
