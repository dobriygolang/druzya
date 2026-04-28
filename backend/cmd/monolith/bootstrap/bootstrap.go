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

	arenaDomain "druz9/arena/domain"
	arenaPorts "druz9/arena/ports"
	"druz9/cmd/monolith/services"
	adminServices "druz9/cmd/monolith/services/admin"
	aiMockServices "druz9/cmd/monolith/services/ai_mock"
	arenaServices "druz9/cmd/monolith/services/arena"
	authServices "druz9/cmd/monolith/services/auth"
	circlesServices "druz9/cmd/monolith/services/circles"
	copilotServices "druz9/cmd/monolith/services/copilot"
	dailyServices "druz9/cmd/monolith/services/daily"
	editorServices "druz9/cmd/monolith/services/editor"
	eventsServices "druz9/cmd/monolith/services/events"
	honeServices "druz9/cmd/monolith/services/hone"
	intelligenceService "druz9/cmd/monolith/services/intelligence"
	notifyServices "druz9/cmd/monolith/services/notify"
	podcastServices "druz9/cmd/monolith/services/podcast"
	profileServices "druz9/cmd/monolith/services/profile"
	ratingServices "druz9/cmd/monolith/services/rating"
	reviewServices "druz9/cmd/monolith/services/review"
	slotServices "druz9/cmd/monolith/services/slot"
	storageServices "druz9/cmd/monolith/services/storage"
	subscriptionServices "druz9/cmd/monolith/services/subscription"
	syncServices "druz9/cmd/monolith/services/sync"
	whiteboardRoomsServices "druz9/cmd/monolith/services/whiteboard_rooms"
	honeApp "druz9/hone/app"
	honeInfra "druz9/hone/infra"
	ratingInfra "druz9/rating/infra"
	"druz9/shared/enums"
	"druz9/shared/pkg/config"
	"druz9/shared/pkg/eventbus"
	"druz9/shared/pkg/killswitch"
	"druz9/shared/pkg/llmchain"
	"druz9/shared/pkg/metrics"
	"druz9/shared/pkg/quota"
	subApp "druz9/subscription/app"
	subDomain "druz9/subscription/domain"
	subInfra "druz9/subscription/infra"
	"strconv"

	"github.com/google/uuid"
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
	notify  *notifyServices.NotifyModule
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
	llmChain, llmRawChain, llmCacheClose, lcErr := adminServices.BuildLLMChainWithCache(*cfg, log, rdb, pool, ctx)

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

	// КРИТИЧНО: Subscription quota deps wire'ятся ПЕРВЫМИ — иначе модули
	// (Hone/Editor/Whiteboard) initialised with by-value `deps` захватят
	// nil-фы в своих closures (`d.QuotaResolver`, `d.QuotaTierGetter`,
	// `d.QuotaUsageReader`), и каждый EnforceCreate fall-through'нет в
	// permissive ветку. Юзер сможет создавать notes/rooms/boards
	// бесконечно, OVER LIMIT UI cosmetic only. Pass via &deps чтобы
	// модификации QuotaResolver/etc были видны всем последующим NewX(deps)
	// вызовам (deps уже изменён, копии в NewX будут содержать valid pointers).
	subscriptionServices.WireSubscriptionQuota(&deps)

	// Auth must come first — its TokenIssuer + RequireAuth feed every
	// other module that needs WS auth or a connect mount behind bearer.
	auth, aerr := authServices.NewAuth(deps, os.Getenv("ENCRYPTION_KEY"))
	if aerr != nil {
		pool.Close()
		_ = rdb.Close()
		return nil, otelShutdown, fmt.Errorf("auth: %w", aerr)
	}
	deps.TokenIssuer = auth.Issuer

	rating := ratingServices.NewRating(deps)
	notify, nerr := notifyServices.NewNotify(deps)
	if nerr != nil {
		pool.Close()
		_ = rdb.Close()
		return nil, otelShutdown, fmt.Errorf("notify: %w", nerr)
	}
	// Cross-domain wiring: the bot's /start <code> handler talks to the
	// auth code repo via a thin adapter (see services/adapters.go).
	notify.Bot.SetCodeFiller(notifyServices.NewTelegramCodeFillerAdapter(auth.TelegramCodes))
	// Hone → notify TG follow-up. Set BEFORE honeServices.NewHone(deps)
	// runs (NewHone reads deps.HoneNotificationSender by value into the
	// SendCueSessionToTelegram use case). nil-safe: при пустом TG-токене
	// notify.Bot живой но без api → adapter всё равно сконструируется,
	// фактический Send вернёт error и Hone отдаст 5xx.
	deps.HoneNotificationSender = honeServices.NewHoneNotificationAdapter(notify.Bot, notify.Prefs)

	statsMod := adminServices.NewStats(deps)

	// Slot must be wired before Review — review.CreateReview needs slot's
	// BookingRepo to validate ownership of the booking being reviewed.
	slotMod, slotBookings := slotServices.NewSlot(deps)
	reviewMod := reviewServices.NewReview(deps, slotBookings)
	// Circles wired ahead of `modules` so Events can borrow its handlers
	// for the CircleAuthority gate without a second instantiation.
	circlesMod := circlesServices.NewCircles(deps)
	// Intelligence wired ahead so its MemoryHook is available to Hone
	// (Hone-handlers'ы вызывают Hook.OnReflectionAdded etc).
	// Storage gate должен быть построен ДО Hone — Hone оборачивает свои
	// write-routes этим gate'ом, чтобы возвращать 413 при quota_exceeded.
	storageMod, storageGate := storageServices.NewStorage(deps)
	deps.StorageGate = storageGate

	// SyncEventBroker строится ПЕРВЫМ — sync.NewSync (push handler) и
	// yjs_persistence.NewYjsPersistence захватывают его через deps; если
	// nil на момент их конструирования, push notifications не сработают.
	syncEventsMod, syncEventBroker := syncServices.NewSyncEvents(deps)
	deps.SyncEventBroker = syncEventBroker

	syncMod, syncHeartbeat := syncServices.NewSync(deps)
	deps.SyncHeartbeat = syncHeartbeat

	intelligenceMod := intelligenceService.New(deps)
	deps.IntelligenceMemoryHook = intelligenceMod.Hook
	deps.IntelligenceMockMemoryHook = intelligenceMod.MockHook
	deps.IntelligenceMemory = intelligenceMod.Memory

	modules := []*services.Module{
		&auth.Module,
		statsMod,
		profileServices.NewProfile(deps),
		dailyServices.NewDaily(deps),
		&rating.Module,
		arenaServices.NewArena(deps, buildArenaEloFunc(rating.Repo)),
		aiMockServices.NewAIMock(deps),
		adminServices.NewAIModels(deps),
		// Admin CRUD over the canonical `tasks` table (Arena 1v1/2v2 +
		// Daily Kata pool). Backend for the Arena Tasks tab in /admin.
		arenaServices.NewAdminArenaTasks(deps),
		// Public per-day status history → spark bars on /status.
		adminServices.NewStatusHistory(deps),
		// Per-user mock-interview insights aggregator → /insights live cards.
		aiMockServices.NewMockInsights(deps),
		// Codex catalogue (public read + admin CRUD over codex_articles).
		adminServices.NewCodex(deps),
		// Admin write surface for `llm_models` (public read = ai_models.go).
		adminServices.NewAdminAIModels(deps),
		// Personas — public catalogue + admin CRUD (Copilot expert mode).
		adminServices.NewPersonas(deps),
		// VPS retention sweep — see cleanup_crons.go header for tables/
		// policies. Pure background, no REST surface.
		adminServices.NewCleanupCrons(deps),
		// Phase-4 ADR-001 — `ai_native` removed (NativeRoundPage was a
		// legacy mock-round flow with no UI entry point); `season` removed
		// (incomplete season pass, no UI surface). Event publishers in
		// rating/arena/daily/ai_mock keep firing but no subscriber listens
		// — that's fine, the bus is fan-out-without-FK.
		slotMod,
		reviewMod,
		// Phase-4 ADR-001 (Wave 2) — `cohort` removed (feature merged into circles).
		&notify.Module,
		editorServices.NewEditor(deps),
		podcastServices.NewPodcast(deps),
		adminServices.NewAdmin(deps),
		circlesServices.NewFeed(deps),
		adminServices.NewVacancies(deps),
		// Phase-4 ADR-001 — `achievements` removed (gamification cut, no UI surface).
		circlesServices.NewFriends(deps),
		honeServices.NewHone(deps),
		intelligenceMod.Module,
		whiteboardRoomsServices.NewWhiteboardRooms(deps),
		circlesMod.Module,
		aiMockServices.NewMockInterview(deps),
		eventsServices.NewEvents(deps, circlesMod),
		circlesServices.NewLobby(deps),
		subscriptionServices.NewSubscription(deps),
		storageMod,
		syncMod,
		syncEventsMod,
		honeServices.NewYjsPersistence(buildHoneYjsDeps(deps)),
		honeServices.NewVault(buildHoneVaultDeps(deps)),
		honeServices.NewPublishing(buildHonePublishingDeps(deps)),
		adminServices.NewLLMChainAdmin(deps, llmRawChain, llmRegisteredProviders(llmRawChain)),
	}

	// Documents module is wired first so its searcher adapter can be
	// passed into copilot for RAG-context injection. When the module is
	// disabled (OLLAMA_HOST unset) the searcher is nil and copilot's
	// Analyze cleanly skips the RAG path.
	documentsMod, docSearcher := copilotServices.NewDocuments(deps)
	modules = append(modules,
		documentsMod,
		copilotServices.NewTranscription(deps),
		copilotServices.NewCopilot(deps, docSearcher),
	)

	registerSubscribers(bus, modules)

	// Tier-enrichment resolver — отдельный экземпляр subscription use-case'а
	// специально для HTTP-middleware. Не разделяем с subscription-Module'ом,
	// потому что там он — app-level компонент, а тут — infra-layer тонкий
	// шим. Clock = RealClock (UTC), errors silent (fail-open до free).
	subPg := subInfra.NewPostgres(pool)
	subGetTier := subApp.NewGetTier(subPg, subDomain.RealClock{})
	resolveTier := func(ctx context.Context, uid uuid.UUID) string {
		tier, err := subGetTier.Do(ctx, uid)
		if err != nil {
			log.WarnContext(ctx, "tierEnrichment: resolve failed — fail-open to free",
				"err", err, "user_id", uid.String())
			return ""
		}
		return string(tier)
	}

	handler := buildHandler(routerDeps{
		Log: log, Pool: pool, Redis: rdb,
		RequireAuth:   auth.RequireAuth,
		ResolveTier:   resolveTier,
		Notify:        notify,
		Modules:       modules,
		SyncHeartbeat: syncHeartbeat,
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

// llmRegisteredProviders — nil-safe wrapper над Chain.RegisteredProviders()
// для передачи в services.NewLLMChainAdmin. Admin-UI использует это чтобы
// live-preview знал какие звенья цепочки реально достижимы.
func llmRegisteredProviders(chain *llmchain.Chain) []string {
	if chain == nil {
		return nil
	}
	return chain.RegisteredProviders()
}

// ── Hone wiring helpers (Phase: repo-leak refactor) ─────────────────────
// Конструируют typed Deps для трёх hone-модулей. Repo+Publisher строятся
// из общих deps.Pool / deps.SyncEventBroker; SyncEventBroker реализует
// honeDomain.SyncEventPublisher (PublishYjsAppend/PublishSyncChange).

func buildHonePublishingDeps(d services.Deps) honeServices.PublishingDeps {
	repo := honeInfra.NewPublishRepo(d.Pool, d.Log)
	return honeServices.PublishingDeps{
		Publish:   &honeApp.PublishNote{Repo: repo, Log: d.Log},
		Unpublish: &honeApp.UnpublishNote{Repo: repo, Log: d.Log},
		Status:    &honeApp.PublishStatus{Repo: repo, Log: d.Log},
		BulkMeta:  &honeApp.BulkNotesMeta{Repo: repo, Log: d.Log},
		Public:    &honeApp.PublicView{Repo: repo, Log: d.Log},
		ShareToWeb: &honeApp.ShareToWeb{
			Repo:      repo,
			Publisher: d.SyncEventBroker,
			// EmbedFn is owned by NewHone — re-indexing after ShareToWeb
			// happens via the next client UpdateNote, which already re-queues
			// the embed. Wiring EmbedFn here would require threading the
			// hone-private embedder through Deps; left for a follow-up.
			EmbedFn: nil,
			Log:     d.Log,
		},
		MakePrivate: &honeApp.MakePrivate{
			Repo:      repo,
			Publisher: d.SyncEventBroker,
			Log:       d.Log,
		},
		Log: d.Log,
	}
}

func buildHoneVaultDeps(d services.Deps) honeServices.VaultDeps {
	repo := honeInfra.NewVaultRepo(d.Pool, d.Log)
	return honeServices.VaultDeps{
		Init:    &honeApp.VaultInit{Repo: repo, Log: d.Log},
		GetSalt: &honeApp.VaultGetSalt{Repo: repo, Log: d.Log},
		Encrypt: &honeApp.VaultEncryptNote{Repo: repo, Publisher: d.SyncEventBroker, Log: d.Log},
		Decrypt: &honeApp.VaultDecryptNote{Repo: repo, Publisher: d.SyncEventBroker, Log: d.Log},
		Log:     d.Log,
	}
}

func buildHoneYjsDeps(d services.Deps) honeServices.YjsPersistenceDeps {
	repo := honeInfra.NewYjsRepo(d.Pool, d.Log)
	return honeServices.YjsPersistenceDeps{
		Append:  &honeApp.YjsAppend{Repo: repo, Publisher: d.SyncEventBroker, Log: d.Log},
		Updates: &honeApp.YjsPullUpdates{Repo: repo, Log: d.Log},
		Compact: &honeApp.YjsCompact{Repo: repo, Publisher: d.SyncEventBroker, Log: d.Log},
		Log:     d.Log,
	}
}

// ── Arena ELO lookup wiring ───────────────────────────────────────────────
// Bridges rating's per-user ratings list to arena's UserEloFunc port. Lives
// in bootstrap (not arena/) so arena no longer imports druz9/rating —
// pre-condition for extracting arena into a separate process later.
func buildArenaEloFunc(repo *ratingInfra.Postgres) arenaPorts.UserEloFunc {
	return func(ctx any, userID uuid.UUID, section enums.Section) int {
		c, _ := ctx.(context.Context)
		if c == nil {
			c = context.Background()
		}
		list, err := repo.List(c, userID)
		if err != nil {
			return arenaDomain.InitialELO
		}
		for _, r := range list {
			if r.Section == section {
				return r.Elo
			}
		}
		return arenaDomain.InitialELO
	}
}
