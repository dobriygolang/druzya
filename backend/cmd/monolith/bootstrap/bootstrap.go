// Package bootstrap composes every bounded context into one running
// monolith. It owns initialisation order (otel → infra → bus → modules →
// router) and graceful shutdown (router → modules in reverse → infra).
//
// main() should be a 30-line shell over `bootstrap.New(cfg)` + `App.Run`.
// Anything more belongs in one of the files in this package or under
// services/.
package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"druz9/cmd/monolith/services"
	"druz9/shared/pkg/config"
	"druz9/shared/pkg/eventbus"
	"druz9/shared/pkg/killswitch"
	"druz9/shared/pkg/metrics"
	"druz9/shared/pkg/quota"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// App holds the composed monolith. Once New returns successfully it owns
// every resource it created — call Run to serve and Shutdown (or signal
// the rootCtx) to tear down cleanly.
type App struct {
	cfg     *config.Config
	log     *slog.Logger
	pool    *pgxpool.Pool
	redis   *redis.Client
	bus     *eventbus.InProcess
	httpSrv *http.Server
	notify  *services.NotifyModule
	modules []*services.Module

	// llmCacheClose — дренит worker-пул llmcache.SemanticCache при
	// graceful shutdown. Всегда non-nil (NoopCache.Close тоже no-op);
	// регистрируется через registerInfraClosers в общий closers-chain.
	llmCacheClose func() error

	// closers run in reverse-of-registration order during Shutdown. Each
	// one is recovered individually so a single bad cleanup can't take
	// the rest down.
	closers []func(context.Context) error
}

// New wires the entire process. otelShutdown is the only thing main needs
// to defer in addition to App.Shutdown — tracing initialises BEFORE the
// pgx tracer hook, so it must outlive the pool.
//
// Failures are returned wrapped; main converts them to slog.Error +
// os.Exit(1) so the call site stays trivial.
func New(ctx context.Context, cfg *config.Config) (app *App, otelShutdown func(), err error) {
	log := newLogger(cfg.Env)

	otelShutdown = initTracer(log)
	defer func() {
		// If any subsequent step fails, undo otel so the caller doesn't have
		// to remember a partial-init cleanup contract.
		if err != nil {
			otelShutdown()
		}
	}()

	pool, perr := newPostgres(ctx, cfg.PostgresDSN)
	if perr != nil {
		return nil, otelShutdown, fmt.Errorf("postgres pool: %w", perr)
	}
	rdb := newRedis(cfg)
	bus := newEventBus(log)

	// Start pgxpool stats sampler — populates druz9_pgxpool_* gauges from
	// pool.Stat() on a 15s tick. Stops when ctx is cancelled (app tear-down).
	metrics.RegisterPgxPoolCollector(ctx, pool, 0)

	// Build the multi-provider LLM chain once, оборачиваем семантическим
	// кешем (Ollama embedder + Redis). Ошибки конструкции драйверов —
	// фатальны (оператору нужно чинить конфиг); "no providers configured"
	// не фатально — BuildLLMChainWithCache возвращает nil ChatClient и
	// downstream-сервисы деградируют в disabled-ветку. Cache-shutdown
	// регистрируется ниже в registerInfraClosers через поле llmCacheClose.
	llmChain, llmCacheClose, lcErr := services.BuildLLMChainWithCache(*cfg, log, rdb)
	if lcErr != nil {
		pool.Close()
		_ = rdb.Close()
		return nil, otelShutdown, fmt.Errorf("llmchain: %w", lcErr)
	}

	// Daily token cap — env COPILOT_DAILY_TOKEN_CAP overrides the
	// default 200k/user/day. Tune to Groq free-tier headroom: a
	// reasonable interview user burns ~20k tokens/day (copilot +
	// suggestions), so 200k is a 10x headroom while still stopping a
	// runaway account at ~$6 of Groq paid-tier equivalent.
	dailyCap := 200_000
	if s := os.Getenv("COPILOT_DAILY_TOKEN_CAP"); s != "" {
		if n, perr := strconv.Atoi(s); perr == nil && n > 0 {
			dailyCap = n
		}
	}

	deps := services.Deps{
		Cfg: cfg, Log: log, Pool: pool, Redis: rdb,
		Bus: bus, Now: nowFunc(), LLMChain: llmChain,
		KillSwitch: killswitch.New(rdb),
		TokenQuota: quota.New(rdb, dailyCap),
	}

	// Auth must come first — its TokenIssuer + RequireAuth feed every
	// other module that needs WS auth or a connect mount behind bearer.
	auth, aerr := services.NewAuth(deps, os.Getenv("ENCRYPTION_KEY"))
	if aerr != nil {
		pool.Close()
		_ = rdb.Close()
		return nil, otelShutdown, fmt.Errorf("auth: %w", aerr)
	}
	deps.TokenIssuer = auth.Issuer

	rating := services.NewRating(deps)
	notify, nerr := services.NewNotify(deps)
	if nerr != nil {
		pool.Close()
		_ = rdb.Close()
		return nil, otelShutdown, fmt.Errorf("notify: %w", nerr)
	}
	// Cross-domain wiring: the bot's /start <code> handler talks to the
	// auth code repo via a thin adapter (see services/adapters.go).
	notify.Bot.SetCodeFiller(services.NewTelegramCodeFillerAdapter(auth.TelegramCodes))

	statsMod := services.NewStats(deps)

	// Slot must be wired before Review — review.CreateReview needs slot's
	// BookingRepo to validate ownership of the booking being reviewed.
	slotMod, slotBookings := services.NewSlot(deps)
	reviewMod := services.NewReview(deps, slotBookings)

	modules := []*services.Module{
		&auth.Module,
		statsMod,
		services.NewProfile(deps),
		services.NewDaily(deps),
		&rating.Module,
		services.NewArena(deps, rating.Repo),
		services.NewAIMock(deps),
		services.NewAINative(deps),
		slotMod,
		reviewMod,
		services.NewCohort(deps),
		&notify.Module,
		services.NewEditor(deps),
		services.NewSeason(deps),
		services.NewPodcast(deps),
		services.NewAdmin(deps),
		services.NewFeed(deps),
		services.NewVacancies(deps),
		services.NewAchievements(deps),
		services.NewFriends(deps),
		services.NewHone(deps),
		services.NewLobby(deps),
	}

	// Documents module is wired first so its searcher adapter can be
	// passed into copilot for RAG-context injection. When the module is
	// disabled (OLLAMA_HOST unset) the searcher is nil and copilot's
	// Analyze cleanly skips the RAG path.
	documentsMod, docSearcher := services.NewDocuments(deps)
	modules = append(modules,
		documentsMod,
		services.NewTranscription(deps),
		services.NewCopilot(deps, docSearcher),
	)

	registerSubscribers(bus, modules)

	handler := buildHandler(routerDeps{
		Log: log, Pool: pool, Redis: rdb,
		RequireAuth: auth.RequireAuth,
		Notify:      notify,
		Modules:     modules,
	})

	httpSrv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	a := &App{
		cfg: cfg, log: log,
		pool: pool, redis: rdb, bus: bus,
		httpSrv: httpSrv, notify: notify, modules: modules,
		llmCacheClose: llmCacheClose,
	}
	a.registerInfraClosers()
	return a, otelShutdown, nil
}

// registerInfraClosers wires the closers that bookend per-module shutdown:
// HTTP server first (stop accepting), then per-module Shutdown (in reverse
// of construction), then Postgres + Redis.
func (a *App) registerInfraClosers() {
	a.closers = append(a.closers, func(ctx context.Context) error {
		return a.httpSrv.Shutdown(ctx)
	})
	for i := len(a.modules) - 1; i >= 0; i-- {
		m := a.modules[i]
		if m == nil {
			continue
		}
		a.closers = append(a.closers, m.Shutdown...)
	}
	// llmcache drain идёт ПЕРЕД Redis-close: воркеры пишут в Redis на
	// flush'е in-flight Store-job'ов, если мы закроем Redis раньше —
	// получим ошибки дрейна в логе.
	if a.llmCacheClose != nil {
		a.closers = append(a.closers, func(context.Context) error { return a.llmCacheClose() })
	}
	a.closers = append(a.closers,
		func(context.Context) error { a.pool.Close(); return nil },
		func(context.Context) error { return a.redis.Close() },
	)
}

// Run starts every Background goroutine, fires the Telegram-webhook
// registration (skipped in local), then blocks on ListenAndServe until
// rootCtx is cancelled. Returns nil on graceful shutdown.
func (a *App) Run(rootCtx context.Context) error {
	for _, m := range a.modules {
		if m == nil {
			continue
		}
		for _, bg := range m.Background {
			bg(rootCtx)
		}
	}

	// Register Telegram webhook with BotFather once HTTP is up (skip in
	// local). The 2s sleep mirrors the pre-refactor behaviour — the
	// listener needs a beat to come online before BotFather hits it.
	if a.cfg.Env != "local" {
		go func() {
			time.Sleep(2 * time.Second)
			if err := a.notify.RegisterWebhook(rootCtx); err != nil {
				a.log.Warn("notify.telegram.RegisterWebhook failed", "err", err)
			}
		}()
	}

	srvErr := make(chan error, 1)
	go func() {
		a.log.Info("monolith starting", "addr", a.cfg.HTTPAddr, "env", a.cfg.Env)
		if err := a.httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			srvErr <- err
			return
		}
		srvErr <- nil
	}()

	select {
	case <-rootCtx.Done():
		a.log.Info("shutdown initiated")
		return nil
	case err := <-srvErr:
		return err
	}
}

// Shutdown invokes every closer with the given deadline. Errors are logged
// individually and returned as a joined error so callers can decide
// whether to exit non-zero.
func (a *App) Shutdown(ctx context.Context) error {
	var errs []error
	for _, c := range a.closers {
		if err := c(ctx); err != nil {
			a.log.Warn("shutdown step failed", "err", err)
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
