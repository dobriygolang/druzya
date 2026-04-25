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
	"context"
	"log/slog"
	"net/http"
	"strings"

	"druz9/cmd/monolith/services"
	"druz9/shared/pkg/logger"
	"druz9/shared/pkg/metrics"
	mw "druz9/shared/pkg/middleware"
	dotel "druz9/shared/pkg/otel"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
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
	// ResolveTier — функция резолвинга tier'а для аутентифицированного
	// user_id. nil допустимо (без subscription-сервиса tier всегда пустой
	// = free). Вызывается per-request после auth, результат кладётся в
	// context'е через sharedMw.WithUserTier.
	ResolveTier func(ctx context.Context, userID uuid.UUID) string
	Notify      *services.NotifyModule
	Modules     []*services.Module // every Module in mount order, including auth's
	// SyncHeartbeat — Phase C-3.1 middleware. Применяется ПОСЛЕ auth-gate'а
	// в /api/v1 chain'е и в Connect-mux'е (через wrap auth + tier).
	SyncHeartbeat *services.SyncHeartbeat
}

func buildHandler(d routerDeps) http.Handler {
	r := chi.NewRouter()
	// CORS должен быть ПЕРЕД RequireAuth — иначе preflight OPTIONS летит
	// в auth-middleware и возвращает 401, browser блокирует следующий
	// запрос с «Failed to fetch». См. cors.go для whitelist'а.
	cors := corsMiddleware()
	r.Use(cors)
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

	// Root-level routes (og-meta for link-preview bots, etc.). Mounted
	// OUTSIDE /api/v1 and outside the auth gate — handlers MUST treat
	// every request as anonymous and public.
	for _, m := range d.Modules {
		if m != nil && m.MountRoot != nil {
			m.MountRoot(r)
		}
	}

	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/ping", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"pong":true}`))
		})
		// TODO (openapi): add to shared/openapi.yaml so codegen owns the route.
		api.Post("/notify/telegram/webhook", d.Notify.WebhookHandler.HandlerFunc())

		api.Group(func(gated chi.Router) {
			gated.Use(restAuthGate(d.RequireAuth))
			gated.Use(tierEnrichment(d.ResolveTier))
			if d.SyncHeartbeat != nil {
				gated.Use(d.SyncHeartbeat.Middleware)
			}
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
			h := m.ConnectHandler
			if d.SyncHeartbeat != nil {
				h = d.SyncHeartbeat.Middleware(h)
			}
			connectMux.Handle(m.ConnectPath, d.RequireAuth(tierEnrichment(d.ResolveTier)(h)))
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

	// CORS должен оборачивать ОБА — и chi-rooted REST, и connectMux. На
	// chi мы уже навесили r.Use(cors), но connectMux идёт мимо chi, поэтому
	// applies CORS ещё раз снаружи. Header'ы идемпотентны — повторная
	// установка одного и того же значения безопасна.
	dispatcher := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		for _, p := range prefixes {
			if strings.HasPrefix(req.URL.Path, p) {
				connectMux.ServeHTTP(w, req)
				return
			}
		}
		r.ServeHTTP(w, req)
	})
	return cors(dispatcher)
}

// restAuthGate is the per-request bearer-auth middleware applied to every
// REST route except a small allow-list (the three login endpoints, plus
// the public profile lookup at /api/v1/profile/{username} which has no
// /me prefix).
func restAuthGate(requireAuth func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	publicPaths := map[string]struct{}{
		"/api/v1/auth/yandex":             {},
		"/api/v1/auth/yandex/start":       {},
		"/api/v1/auth/telegram":           {},
		"/api/v1/auth/telegram/start":     {},
		"/api/v1/auth/telegram/poll":      {},
		"/api/v1/auth/refresh":            {},
		"/api/v1/stats/public":            {},
		"/api/v1/languages":               {},
		"/api/v1/onboarding/preview-kata": {},
		// /api/v1/status is the PUBLIC uptime / transparency surface — must
		// remain reachable without a bearer for anonymous visitors. The
		// handler is a thin wrapper over admin.GetStatusPage which itself
		// has no role gate (see services/admin/ports/status.go).
		"/api/v1/status": {},
		// /api/v1/support/ticket — форма поддержки на /help. Public, чтобы
		// и не-залогиненный мог написать. Авторизованный user_id берётся
		// из context'а (если bearer есть, middleware его положит).
		"/api/v1/support/ticket": {},
		// /api/v1/vacancies — read-only catalogue, public for SEO + the
		// "browse without sign-up" flow. Phase 5: /vacancies/analyze is
		// no longer public — match-score requires the user's stack.
		"/api/v1/vacancies": {},
		// /api/v1/ai/models — public model catalogue used by the AI-opponent
		// picker on /arena. Frontend needs it before sign-in to render the
		// premium-tier upsell, so it stays outside the bearer gate.
		"/api/v1/ai/models": {},
		// /api/v1/lobby/list — public discovery for /lobbies. Detail and
		// code-lookup paths (/lobby/{id}, /lobby/code/{code}) are also
		// public — see isPublic prefix check below.
		"/api/v1/lobby/list": {},
	}
	isPublic := func(_, p string) bool {
		if _, ok := publicPaths[p]; ok {
			return true
		}
		// /api/v1/profile/weekly/share/{token} — public weekly-report share
		// link (Phase C killer-stats). Резолвится по токену в БД, поэтому
		// bearer не нужен. Проверка отдельным префиксом, чтобы будущие
		// приватные /profile/weekly/* пути НЕ стали публичными по ошибке.
		if strings.HasPrefix(p, "/api/v1/profile/weekly/share/") {
			return true
		}
		// /api/v1/profile/{username} — public, but /api/v1/profile/me*
		// is NOT.
		if strings.HasPrefix(p, "/api/v1/profile/") && !strings.HasPrefix(p, "/api/v1/profile/me") {
			return true
		}
		// /api/v1/vacancies/{id} — public detail view. Saved-list paths
		// (/vacancies/saved, /vacancies/{id}/save, /vacancies/saved/{id})
		// AND /vacancies/analyze (Phase 5: requires user stack) stay gated.
		if strings.HasPrefix(p, "/api/v1/vacancies/") &&
			!strings.HasPrefix(p, "/api/v1/vacancies/saved") &&
			p != "/api/v1/vacancies/analyze" &&
			!strings.HasSuffix(p, "/save") {
			return true
		}
		// /api/v1/lobby/{id} (GET detail) and /api/v1/lobby/code/{code} —
		// public read-only paths. POST /lobby itself plus mutation suffixes
		// (/join, /leave, /start, /cancel) stay gated. We special-case
		// the bare /lobby pattern by requiring at least one extra segment.
		if strings.HasPrefix(p, "/api/v1/lobby/") &&
			!strings.HasSuffix(p, "/join") &&
			!strings.HasSuffix(p, "/leave") &&
			!strings.HasSuffix(p, "/start") &&
			!strings.HasSuffix(p, "/cancel") {
			return true
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isPublic(r.Method, r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			requireAuth(next).ServeHTTP(w, r)
		})
	}
}

// tierEnrichment — middleware, резолвящий subscription tier для
// аутентифицированного юзера и складывающий результат в context через
// sharedMw.WithUserTier. Запускается ПОСЛЕ auth middleware, поэтому в
// context'е уже есть UserID. Неавторизованный запрос / отсутствие
// subscription-записи / resolver == nil → tier остаётся пустым (free).
//
// Fail-open: любая ошибка резолвера silent (не ломает запрос). Кост —
// одно DB-чтение на запрос; измерим в Grafana после выкатки, если станет
// узким местом — добавим Redis-cache TTL 60s.
func tierEnrichment(resolve func(context.Context, uuid.UUID) string) func(http.Handler) http.Handler {
	if resolve == nil {
		return func(next http.Handler) http.Handler { return next }
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			uid, ok := mw.UserIDFromContext(r.Context())
			if !ok {
				next.ServeHTTP(w, r)
				return
			}
			if tier := resolve(r.Context(), uid); tier != "" {
				r = r.WithContext(mw.WithUserTier(r.Context(), tier))
			}
			next.ServeHTTP(w, r)
		})
	}
}
