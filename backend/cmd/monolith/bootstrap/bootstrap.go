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
	adminServices "druz9/cmd/monolith/services/admin"
	aiMockServices "druz9/cmd/monolith/services/ai_mock"
	aiTutorServices "druz9/cmd/monolith/services/ai_tutor"
	authServices "druz9/cmd/monolith/services/auth"
	circlesServices "druz9/cmd/monolith/services/circles"
	copilotServices "druz9/cmd/monolith/services/copilot"
	curationServices "druz9/cmd/monolith/services/curation"
	editorServices "druz9/cmd/monolith/services/editor"
	googleCalendarServices "druz9/cmd/monolith/services/google_calendar"
	honeServices "druz9/cmd/monolith/services/hone"
	intelligenceService "druz9/cmd/monolith/services/intelligence"
	notifyServices "druz9/cmd/monolith/services/notify"
	podcastServices "druz9/cmd/monolith/services/podcast"
	profileServices "druz9/cmd/monolith/services/profile"
	roomsServices "druz9/cmd/monolith/services/rooms"
	storageServices "druz9/cmd/monolith/services/storage"
	subscriptionServices "druz9/cmd/monolith/services/subscription"
	syncServices "druz9/cmd/monolith/services/sync"
	telemetryServices "druz9/cmd/monolith/services/telemetry"
	tracksServices "druz9/cmd/monolith/services/tracks"
	tutorServices "druz9/cmd/monolith/services/tutor"
	whiteboardRoomsServices "druz9/cmd/monolith/services/whiteboard_rooms"
	honeApp "druz9/hone/app"
	honeInfra "druz9/hone/infra"
	"druz9/shared/pkg/config"
	"druz9/shared/pkg/eventbus"
	"druz9/shared/pkg/killswitch"
	"druz9/shared/pkg/llmchain"
	"druz9/shared/pkg/metrics"
	"druz9/shared/pkg/quota"
	"druz9/shared/pkg/workerpool"
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

	// workerPools — drained на shutdown ДО Postgres/Redis-close, чтобы
	// last-в-полёте insight-gen / Categoriser tasks успели завершиться.
	workerPools []*workerpool.Pool

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

	// Bounded worker pools для detached-goroutine fan-out. Заменяют
	// raw `go func(){}` в hot-path'ах (intelligence GetDailyBrief →
	// GenerateInsights, hone CreateTask → Categoriser). Sizing:
	//  - insightsPool 20: insight gen — LLM-driven (5-15s), free-tier
	//    Groq/Cerebras rate-limit ~30 RPM, 20 даёт headroom без overload.
	//  - categoriserPool 30: Categoriser — короткий LLM hop (1-3s),
	//    bursty при опт-in юзерах кликающих CreateTask.
	insightsPool := workerpool.New("insights", 20, log)
	categoriserPool := workerpool.New("categoriser", 30, log)

	deps := services.Deps{
		Cfg: cfg, Log: log, Pool: pool, Redis: rdb,
		Bus: bus, Now: nowFunc(), LLMChain: llmChain,
		KillSwitch:      killswitch.New(rdb),
		TokenQuota:      quota.New(rdb, dailyCap),
		InsightsPool:    insightsPool,
		CategoriserPool: categoriserPool,
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
	// Expose notify SendNotification UC to subscription cron
	// (notify_trial_expiring). Wired via Deps так чтобы NewSubscription
	// мог построить TrialExpiringNotifier adapter. nil-safe: cron работает
	// без notifier'а (только Insight).
	deps.NotifySend = notify.Send

	statsMod := adminServices.NewStats(deps)

	// Pivot 2026-05-01: slot/rating/events/review services dropped (см
	// docs/feature/identity.md). Slot booking flow + ELO rating + standalone
	// events service выпиливаются как dead/redundant с tutor-toolkit pivot'ом.
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
	deps.IntelligenceLinkSuggester = intelligenceMod.LinkSuggester
	deps.IntelligenceLogResource = intelligenceMod.LogResourceUC
	// X5: mock pipeline struggle producer is wired through ai_mock
	// via this UC pointer. Wired BEFORE aiMockServices.NewAIMock /
	// NewMockInterview so the orchestrator's Struggle field gets the
	// adapter at construction time (NOT after via late-binding).
	deps.IntelligenceMarkAtlasStruggle = intelligenceMod.MarkAtlasStruggleUC
	// Insight upserter port — subscription notify_trial_expiring cron
	// пишет insight'ы через узкий interface. Wired до NewSubscription.
	deps.IntelligenceInsightUpserter = intelligenceMod.InsightsRepo
	// C3 cross-product context — copilot bootstrap wraps в cached
	// adapter и заинжектит в Suggest + Analyze (Phase J).
	deps.IntelligenceUserContext = intelligenceMod.GetUserContextUC
	// External-activity → coach_episode bridge. Hone AddExternalActivity
	// UC использует это чтобы AI-tutor recall + daily-brief видели
	// внешнее обучение (LeetCode / Coursera / books) как часть памяти.
	deps.ExternalActivityCoachAppender = honeServices.NewHoneCoachEpisodeAppender(
		intelligenceService.NewExternalActivityAppender(intelligenceMod.Memory),
	)

	// Tutor wires before its slot in the modules slice because ai_tutor
	// needs PushAssignment use case to forward proactive triggers
	// (OnFailedMock → assignment в Hone TaskBoard).
	tutorMod := tutorServices.NewTutor(deps, tutorServices.TutorDeps{
		Briefer:    tutorServices.NewBriefer(deps.LLMChain, deps.Log, deps.Now),
		NotifySend: notify.Send,
	})

	modules := []*services.Module{
		&auth.Module,
		statsMod,
		profileServices.NewProfile(deps),
		// Pivot 2026-05-01: arena (1v1/2v2/match/ELO matchmaker) +
		// rating + slot + review + events удалены. См
		// docs/feature/identity.md.
		aiMockServices.NewAIMock(deps),
		adminServices.NewAIModels(deps),
		// Codex catalogue (public read + admin CRUD over codex_articles).
		adminServices.NewCodex(deps),
		// Admin write surface for `llm_models` (public read = ai_models.go).
		// Personas — public catalogue + admin CRUD (Copilot expert mode).
		adminServices.NewPersonas(deps),
		// VPS retention sweep — see cleanup_crons.go header for tables/
		// policies. Pure background, no REST surface.
		adminServices.NewCleanupCrons(deps),
		// Phase-4 ADR-001 (Wave 2) — `cohort` removed (feature merged into circles).
		&notify.Module,
		editorServices.NewEditor(deps),
		podcastServices.NewPodcast(deps),
		adminServices.NewAdmin(deps),
		// Phase-4 ADR-001 — `achievements` removed (gamification cut, no UI surface).
		// 2026-05-11 — `vacancies` bounded context removed (off-identity: druz9 is
		// an AI-guide, not a job board).
		// Phase 1.7 — `friends` removed (social graph lives in TG channel + circles).
		honeServices.NewHone(deps),
		curationServices.NewCuration(deps),
		// F6 heuristic auto-promote — pure-Go signal refresher +
		// promote/deprecate toggles. Runs every 6h. Sits beside the
		// LLM-validated intelligence.AutoPromoteCron (daily) — both
		// are idempotent and operate on disjoint state via partial
		// indexes (promoted_at IS NULL / deprecated_at IS NULL).
		curationServices.NewAutoPromoteCron(deps),
		roomsServices.NewRooms(deps),
		roomsServices.NewSweepCron(deps),
		intelligenceMod.Module,
		intelligenceService.NewAutoPromoteCron(deps),
		intelligenceService.NewCurationProducersCron(deps, intelligenceMod.InsightsRepo),
		whiteboardRoomsServices.NewWhiteboardRooms(deps),
		circlesMod.Module,
		// Stream E: Google Calendar two-way sync. OAuth flow + 5-min pull
		// cron. Module degrades gracefully when GOOGLE_CLIENT_ID/SECRET unset
		// (RPCs return ErrUpstream from Google API, cron disabled).
		googleCalendarServices.NewGoogleCalendar(deps),
		aiMockServices.NewMockInterview(deps),
		// Pivot 2026-05-04: calendar bounded context выпилен — нулевые
		// frontend-вызовы /calendar/events*, ribbon на Hone Today
		// никогда не материализовался. Phase E1 (migration 00080)
		// дропнул personal_events table + CalendarReader/UpcomingInterview
		// legacy: coach больше не учитывает calendar pressure.
		// Phase 2 — curated learning Tracks (bounded context tracks).
		// Reads are auth-gated so the catalogue can show enrolment state.
		tracksServices.NewTracks(deps),
		// Phase A (2026-05-12, brainstorm follow-up) — opt-in product
		// telemetry. Single batch-write endpoint POST /telemetry/events;
		// 90-day retention via migration 00102. Без этого Phase B-I roadmap
		// шипает фичи на guess'ах.
		telemetryServices.NewTelemetry(deps),
		// Wave 2 of docs/feature/tutor.md — tutor as distribution
		// channel. Briefer wired via llmchain (Wave 2.5); the
		// constructor returns nil when LLMChain is nil (offline /
		// tests) and the use-case falls back to snapshot-only.
		// TutorDisplay still nil — the profile display-name reader
		// plugs in alongside /tutor frontend (Wave 2.6).
		tutorMod.Module,
		// AI-tutor (см docs/feature/ai-tutor.md). Reuse'ит существующий
		// tutor-сервис как relationship-store, использует llmchain для
		// chat / compaction.
		aiTutorServices.NewAITutor(deps, aiTutorServices.AITutorDeps{
			Chain:            deps.LLMChain,
			ExternalActivity: intelligenceMod.ExternalReader,
			Focus:            intelligenceMod.FocusReader,
			Mocks:            intelligenceMod.MockReader,
			Skills:           intelligenceMod.SkillReader,
			PushAssignment:   tutorMod.PushAssignment,
		}),
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
		workerPools:   []*workerpool.Pool{insightsPool, categoriserPool},
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
	// Drain bounded worker pools до Postgres/Redis: in-flight задачи
	// (insight upserts / categoriser SetStatus) пишут в БД и Redis.
	for _, p := range a.workerPools {
		p := p
		a.closers = append(a.closers, func(context.Context) error { return p.Close() })
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
	// Only the public HTML viewer at /p/{slug} lives in NewPublishing now —
	// the JSON endpoints are bound to the hone Connect server in NewHone.
	repo := honeInfra.NewPublishRepo(d.Pool, d.Log)
	return honeServices.PublishingDeps{
		Public: &honeApp.PublicView{Repo: repo, Log: d.Log},
		Log:    d.Log,
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
