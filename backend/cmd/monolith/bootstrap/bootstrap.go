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

	// Build the multi-provider LLM chain once. Errors from malformed
	// driver construction are fatal (operator needs to fix config);
	// "no providers configured" is not — BuildLLMChain returns nil and
	// downstream services degrade to their feature-disabled branch.
	llmChain, lcErr := services.BuildLLMChain(*cfg, log)
	if lcErr != nil {
		pool.Close()
		_ = rdb.Close()
		return nil, otelShutdown, fmt.Errorf("llmchain: %w", lcErr)
	}

	deps := services.Deps{
		Cfg: cfg, Log: log, Pool: pool, Redis: rdb,
		Bus: bus, Now: nowFunc(), LLMChain: llmChain,
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
		services.NewLobby(deps),
		services.NewCopilot(deps),
	}

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
