package intelligence

import (
	"context"

	monolithServices "druz9/cmd/monolith/services"
	honeDomain "druz9/hone/domain"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	intelInfra "druz9/intelligence/infra"
	intelPorts "druz9/intelligence/ports"
	lsApp "druz9/learning_state/app"
	lsInfra "druz9/learning_state/infra"
	miDomain "druz9/mock_interview/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/metrics"
	"druz9/shared/pkg/rediscache"
	"time"

	"connectrpc.com/connect"
	"github.com/go-chi/chi/v5"
)

// NewIntelligence wires the AI-coach bounded context.
//
// Adapters:
//   - DailyBriefRepo: own table hone_daily_briefs.
//   - FocusReader / PlanReader / NotesReader: hand-rolled raw SQL over
//     hone_streak_days, hone_daily_plans, hone_notes. Live in this file
//     (not in intelligence/infra) so the intelligence service never
//     imports hone's domain — the boundary stays hard.
//   - BriefSynthesizer / NoteAnswerer: real LLM-backed when d.LLMChain is
//     non-nil; otherwise floor adapters return ErrLLMUnavailable (→ 503).
//   - Embedder: HoneEmbedder (bge-small via Ollama) when OLLAMA_HOST is
//     set; otherwise floor returns ErrEmbeddingUnavailable.
//
// MVP gating: open to all signed-in users (no Pro-gate). Add a TierReader
// dependency mirror of HoneServer.WithTier when the feature graduates.
// IntelligenceModule wraps the standard module with a publicly-readable
// MemoryHook — hone wiring taps into it to write side-effect episodes
// (reflections / standups / plan-skip-or-complete / note-create /
// focus-session-done).
type IntelligenceModule struct {
	*monolithServices.Module
	Memory   *intelApp.Memory
	Hook     honeDomain.MemoryHook
	MockHook miDomain.MemoryHook
	// Cross-product reader handles re-exposed для AI-tutor wiring (нужно
	// snapshot'у tutor'а). Bootstrap.go дёргает их при инициализации
	// aiTutor service.
	ExternalReader *intelInfra.ExternalActivityReader
	FocusReader    *intelInfra.FocusReader
	MockReader     *intelInfra.MockReader
	SkillReader    *intelInfra.SkillReader
	// LinkSuggester — Phase 5 LLM-rerank UC. Public, чтобы hone-bootstrap
	// мог прокинуть его через adapter в honeApp.SuggestNoteLinks.
	// nil-safe: при d.LLMChain == nil выставляется, но Do возвращает
	// ErrLLMUnavailable — caller fallback'нет на embedding-only.
	LinkSuggester *intelApp.SuggestNoteLinks
	// LogResourceUC — public для late-binding NoteCreator из hone bootstrap.
	// intelligence создаётся раньше hone, и NoteCreator (hone-репозиторий
	// notes + embed enqueue) ещё не существует на момент New(). Bootstrap
	// после honeServices.NewHone пишет mod.LogResourceUC.NoteCreator = ...
	LogResourceUC *intelApp.LogResource
	// InsightsRepo — public для curation_producers_cron (Phase 3.5d).
	InsightsRepo *intelInfra.InsightsPostgres
	// GetUserContextUC — C3 cross-product context fetcher (Phase J).
	// Public чтобы copilot-bootstrap мог обернуть его в
	// UserContextProvider adapter (Redis-cached) и заинжектить
	// в Suggest + Analyze.
	GetUserContextUC *intelApp.GetUserContext

	// X5 Atlas struggle marks (Phase J P2). Re-exposed public так что:
	//   • Cue ingestion path (services/intelligence/app/ingest_session_transcript.go
	//     side-effect adapter в bootstrap) может писать struggle сигналы
	//     по low-rating stages,
	//   • Hone reflection path (SaveFocusReflection side-effect) может
	//     писать при grade ≤2,
	//   • Mock pipeline (services/mock_interview) может писать при weak
	//     axis-score через event bus.
	MarkAtlasStruggleUC  *intelApp.MarkAtlasStruggle
	ListAtlasStrugglesUC *intelApp.ListAtlasStruggles
}

func New(d monolithServices.Deps) IntelligenceModule {
	briefs := intelInfra.NewCachedDailyBriefs(
		intelInfra.NewDailyBriefs(d.Pool),
		intelInfra.NewBriefRedisKV(d.Redis),
		intelApp.CacheTTL,
		d.Log,
	)
	episodes := intelInfra.NewEpisodes(d.Pool)

	focusR := intelInfra.NewFocusReader(d.Pool)
	planR := intelInfra.NewPlanReader(d.Pool)
	notesR := intelInfra.NewNotesReader(d.Pool)
	externalR := intelInfra.NewExternalActivityReader(d.Pool)
	// Cross-product readers — все опциональные. Coach prompt получает
	// сигналы и из Hone, и из druz9 (mocks/arena/kata) и из user'ского
	// Today (queue, daily notes). См. domain/repo.go BriefPromptInput
	// и services/intelligence/infra/cross_readers.go.
	mockR := intelInfra.NewMockReader(d.Pool)
	queueR := intelInfra.NewQueueReader(d.Pool)
	skillR := intelInfra.NewSkillReader(d.Pool)
	dailyR := intelInfra.NewDailyNoteReader(d.Pool)
	mockMsgR := intelInfra.NewMockMessagesReader(d.Pool)
	codexR := intelInfra.NewCodexReader(d.Pool)
	trackR := intelInfra.NewTrackReader(d.Pool)
	goalsR := intelInfra.NewGoalsReader(d.Pool)
	clubsR := intelInfra.NewClubReader(d.Pool)

	embedder := newIntelEmbedder(d)

	var (
		synth    intelDomain.BriefSynthesizer
		answerer intelDomain.NoteAnswerer
	)
	if d.LLMChain != nil {
		// Phase III: coach.pinned_model reader пишет в dynamic_config.
		// При выставленном pin'e DailyBrief + AskNotes идут через
		// ModelOverride — admin контролирует личность коуча явно.
		coachCfg := intelInfra.NewDBCoachConfigReader(d.Pool)
		synth = intelInfra.NewLLMChainBriefSynthesiser(d.LLMChain, coachCfg, d.Log)
		baseAnswerer := intelInfra.NewLLMChainNoteAnswerer(d.LLMChain, coachCfg, d.Log)
		// Phase V cost guardrail: 5-минутный Redis cache на AskNotes
		// LLM-ответы ловит дубликаты (юзер задаёт тот же вопрос после
		// рефреша вкладки). При nil-Redis — fallthrough на голый
		// answerer, fail-soft.
		if d.Redis != nil {
			answerer = intelInfra.NewCachedNoteAnswerer(
				baseAnswerer,
				intelInfra.NewBriefRedisKV(d.Redis),
				intelInfra.DefaultAskNotesCacheTTL,
				d.Log,
			)
		} else {
			answerer = baseAnswerer
		}
		d.Log.Info("intelligence: LLM adapters wired (daily brief + note QA)")
	} else {
		synth = intelInfra.NewNoLLMBriefSynthesiser()
		answerer = intelInfra.NewNoLLMNoteAnswerer()
		d.Log.Warn("intelligence: llmchain not configured — daily-brief / ask-notes will return 503")
	}

	memory := &intelApp.Memory{
		Episodes: episodes,
		Embed:    embedder,
		Log:      d.Log,
		Now:      d.Now,
	}

	// Phase 1.5 — Insights stream. Repo is pgx-backed; the use cases
	// are nil-safe wrapped (port checks for nil) so this stays robust
	// even before the periodic generator is wired.
	//
	// Phase 1.5b — generator is constructed BEFORE GetDailyBrief so we
	// can pass it as the optional Insights dependency: the brief
	// use-case then shares its prompt-input snapshot with the generator
	// in a detached goroutine, keeping both surfaces synchronised
	// without re-fetching readers.
	insightsRepo := intelInfra.NewInsightsPostgres(d.Pool)
	// Phase D4: Redis-backed TTL cache на ListInsights (was in-memory ttlcache
	// до R6 conflict resolution). 1h TTL — Today surface обновляется вечером
	// после reflection submit'а, invalidate'ится через pattern-delete
	// `insights:{uid}:*` в Generate/Ack путях. Cross-instance consistency:
	// invalidate в одной replica виден всем — was a problem с in-memory.
	// nil-safe: если Redis не wired (тесты) — cache=nil, ListInsights делает
	// прямой запрос (см. intelApp.ListInsights.Do).
	var insightsCache intelApp.InsightsListCache
	if d.Redis != nil {
		raw := rediscache.New[[]intelDomain.Insight](d.Redis, 1*time.Hour, "intelligence_insights")
		insightsCache = NewInsightsRedisCache(raw)
	}
	insightsInvalidator := intelApp.NewInsightsCacheInvalidator(insightsCache)
	listInsightsUC := &intelApp.ListInsights{Repo: insightsRepo, Cache: insightsCache}
	ackInsightUC := &intelApp.AckInsight{Repo: insightsRepo, CacheInvalidator: insightsInvalidator}
	generateInsightsUC := &intelApp.GenerateInsights{Repo: insightsRepo, Now: d.Now, CacheInvalidator: insightsInvalidator}

	// R4 perf: bounded pool для async insight gen (replaces raw `go
	// func()`). nil-safe — daily_brief.go falls back to raw goroutine.
	var insightsPool intelApp.AsyncSubmitter
	if d.InsightsPool != nil {
		insightsPool = d.InsightsPool
	}

	h := intelApp.NewHandler(intelApp.Handler{
		GetDailyBrief: &intelApp.GetDailyBrief{
			Briefs:      briefs,
			Focus:       focusR,
			Plans:       planR,
			Notes:       notesR,
			Synthesiser: synth,
			Log:         d.Log,
			Now:         d.Now,
			Memory:      memory,
			// Cross-product сигналы для smart Coach.
			Mocks:        mockR,
			Queue:        queueR,
			Skills:       skillR,
			DailyNotes:   dailyR,
			MockMessages: mockMsgR,
			Tracks:       trackR,
			Goals:        goalsR,
			Clubs:        clubsR,
			Codex:        codexR,
			// Phase 1.5b — share snapshot with the insight stream.
			Insights:     generateInsightsUC,
			InsightsPool: insightsPool,
		},
		AskNotes: &intelApp.AskNotes{
			Notes:    notesR,
			Embedder: embedder,
			Answerer: answerer,
			Log:      d.Log,
			Memory:   memory,
		},
		Log: d.Log,
	})

	server := intelPorts.NewIntelligenceServer(h, memory, listInsightsUC, ackInsightUC)

	// ── Phase 2 learning-companion (2026-05-04) ───────────────────────
	resourceEngagementR := intelInfra.NewResourceEngagementReader(d.Pool)
	forkProgressR := intelInfra.NewForkProgressReader(d.Pool)
	resourceLogRepo := intelInfra.NewResourceLogPostgres(d.Pool)

	server.ForkSnapshotUC = &intelApp.GetForkSnapshot{Reader: forkProgressR}
	server.LogResourceUC = &intelApp.LogResource{
		Repo: resourceLogRepo,
		// NoteCreator wiring — in Phase 5 (Notes apply). Сейчас nil →
		// reflection-flow пишется без auto-link, hone notes создаются
		// клиентом отдельно.
		NoteCreator: nil,
	}

	// Phase 2 mode persistence — learning_state mutator через adapter.
	lsRepo := lsInfra.NewPostgresRepo(d.Pool)
	server.LearningState = &learningStateAdapter{
		setMode: &lsApp.SetMode{Repo: lsRepo},
		setFork: &lsApp.SetFork{Repo: lsRepo},
		get:     &lsApp.GetState{Repo: lsRepo},
		pool:    d.Pool,
	}

	// Phase 2 finishers — activity stream + skill radar.
	server.ResourceTrailReader = resourceEngagementR
	server.SkillRadarUC = &intelApp.GetSkillRadar{Mocks: mockR}
	server.CoachStatsUC = &intelApp.GetCoachStats{
		Focus: focusR,
		Mocks: mockR,
	}

	// ── F2 LLM-driven milestones (2026-05-12) ──────────────────────────
	// (Defined before goal UCs так что они могут invalidate milestone cache
	// on goal mutation.)
	milestonesRepo := intelInfra.NewMilestonesPostgres(d.Pool)

	// ── F2 primary goal CRUD (2026-05-12) ──────────────────────────────
	primaryGoalsRepo := intelInfra.NewPrimaryGoals(d.Pool)
	server.CreateGoalUC = &intelApp.CreateGoal{Repo: primaryGoalsRepo, Now: d.Now}
	server.GetActiveGoalUC = &intelApp.GetActiveGoal{Repo: primaryGoalsRepo}
	server.UpdateGoalUC = &intelApp.UpdateGoal{
		Repo: primaryGoalsRepo, Now: d.Now, Milestones: milestonesRepo,
	}
	server.DeactivateGoalUC = &intelApp.DeactivateGoal{
		Repo: primaryGoalsRepo, Milestones: milestonesRepo,
	}

	// ── F2 LLM milestones wiring (continued) ─────────────────────────
	server.GenerateMilestonesUC = &intelApp.GenerateMilestones{
		Repo:  milestonesRepo,
		Goals: primaryGoalsRepo,
		Chain: d.LLMChain, // nil-safe — UC returns ErrLLMUnavailable when chain is nil
		Log:   d.Log,
		Now:   d.Now,
	}
	server.GetMilestonesUC = &intelApp.GetMilestones{Repo: milestonesRepo, Goals: primaryGoalsRepo}
	server.MarkMilestoneDoneUC = &intelApp.MarkMilestoneDone{Repo: milestonesRepo}

	// ── R3 Per-node coverage (2026-05-12) ──────────────────────────────
	nodeCoverageReader := intelInfra.NewNodeCoveragePostgres(d.Pool)
	server.GetNodeCoverageUC = &intelApp.GetNodeCoverage{Reader: nodeCoverageReader}

	// ── F1 Memory expansion Phase 2 (2026-05-12) ───────────────────────
	memoryEntriesReader := intelInfra.NewMemoryEntriesPostgres(d.Pool)
	server.ListMemoryEntriesUC = &intelApp.ListMemoryEntries{Reader: memoryEntriesReader}
	server.DeleteMemoryEntryUC = &intelApp.DeleteMemoryEntry{Reader: memoryEntriesReader}
	server.EditMemoryEntryUC = &intelApp.EditMemoryEntry{Reader: memoryEntriesReader}

	// ── X5 Atlas struggle marks (Phase J P2 2026-05-12) ────────────────
	// Cross-product handoff: any service can write «user stuck on X»
	// here; web AtlasPage reads via ListAtlasStruggles. Constructed BEFORE
	// F10/H2 wire-up so those UCs can inject MarkAtlasStruggle as a
	// side-effect port.
	atlasStruggleRepo := intelInfra.NewAtlasStrugglePostgres(d.Pool)
	markAtlasStruggleUC := &intelApp.MarkAtlasStruggle{
		Repo: atlasStruggleRepo,
		Now:  d.Now,
	}
	listAtlasStrugglesUC := &intelApp.ListAtlasStruggles{Repo: atlasStruggleRepo}
	clearAtlasStruggleUC := &intelApp.ClearAtlasStruggle{Repo: atlasStruggleRepo}
	server.MarkAtlasStruggleUC = markAtlasStruggleUC
	server.ListAtlasStrugglesUC = listAtlasStrugglesUC
	server.ClearAtlasStruggleUC = clearAtlasStruggleUC

	// ── F10 Cue session ingestion (2026-05-12) ─────────────────────────
	interviewSessionsRepo := intelInfra.NewInterviewSessions(d.Pool)
	server.IngestInterviewSessionUC = &intelApp.IngestSessionTranscript{
		Repo:   interviewSessionsRepo,
		Memory: memory, // *intelApp.Memory satisfies MemoryWriter via AppendAsync
		Now:    d.Now,
		// X5: when stages have self_rating ≤2, the UC fires a MarkAtlasStruggle
		// per stage. nil-safe — if StruggleMark is nil, the side-effect is skipped.
		StruggleMark: markAtlasStruggleUC,
	}
	server.ListInterviewSessionsUC = &intelApp.ListInterviewSessions{Repo: interviewSessionsRepo}

	// ── H2 Focus reflection persistence (Phase J 2026-05-12) ───────────
	focusReflectionsRepo := intelInfra.NewFocusReflectionsPostgres(d.Pool)
	server.SaveFocusReflectionUC = &intelApp.SaveFocusReflection{
		Repo:   focusReflectionsRepo,
		Memory: memory, // appends EpisodeFocusReflectionAdded для DailyBrief/Recall
		Now:    d.Now,
		// X5: when grade ≤2 AND task_pinned looks like an atlas node id,
		// fire MarkAtlasStruggle so the web AtlasPage highlights it.
		// nil-safe — UC checks StruggleMark before calling.
		StruggleMark: markAtlasStruggleUC,
	}
	server.ListFocusReflectionsUC = &intelApp.ListFocusReflections{Repo: focusReflectionsRepo}

	// ── C3 Cross-product context (Phase J 2026-05-12) ───────────────────
	// AtlasReader bridges into atlas_nodes via the simple ILIKE-ranking
	// adapter below. Goals + Episodes + ResourceEng + Mocks readers
	// already wired above.
	atlasReader := newAtlasReaderAdapter(d.Pool)
	getUserContextUC := &intelApp.GetUserContext{
		Goals:            primaryGoalsRepo,
		Episodes:         episodes,
		ResourceEng:      resourceEngagementR,
		Mocks:            mockR,
		AtlasReader:      atlasReader,
		MemoryLimit:      12,
		MemoryWindowDays: 14,
		Now:              d.Now,
	}
	server.GetUserContextUC = getUserContextUC

	if d.LLMChain != nil {
		server.NextActionUC = &intelApp.GetNextAction{
			Chain: d.LLMChain,
			Log:   d.Log,
		}
		server.NextActionContext = &nextActionLoader{
			fork:             forkProgressR,
			resourceTrail:    resourceEngagementR,
			mocks:            mockR,
			tracks:           trackR,
			focusReflections: focusReflectionsRepo,
		}
	}

	connectPath, connectHandler := druz9v1connect.NewIntelligenceServiceHandler(
		server,
		connect.WithInterceptors(metrics.ConnectInterceptor()),
	)
	transcoder := monolithServices.MustTranscode("intelligence", connectPath, connectHandler)

	// Embed worker — фон. Stop через app shutdown ctx (см. bootstrap).
	worker := &intelApp.EmbedWorker{
		Episodes: episodes,
		Embed:    embedder,
		Log:      d.Log,
	}

	// Retention worker — once-a-day sweep, deletes coach episodes older
	// than 90 days so the table stays bounded and Recall windows clean.
	retention := &intelApp.MemoryRetention{
		Episodes: episodes,
		Log:      d.Log,
		Now:      d.Now,
	}

	// Phase 1.5b — hourly sweep of expired insight rows. Bounded
	// retention symmetric with MemoryRetention.
	insightsSweep := &intelApp.InsightsSweeper{
		Repo: insightsRepo,
		Log:  d.Log,
	}

	return IntelligenceModule{
		Module: &monolithServices.Module{
			ConnectPath:        connectPath,
			ConnectHandler:     transcoder,
			RequireConnectAuth: true,
			MountREST: func(r chi.Router) {
				// daily-brief got chi-direct because vanguard's transcoder
				// was rejecting the JSON body in prod with 415 even though
				// every other transcoded route accepts the same Content-
				// Type. The use case is small enough that bypassing the
				// transcoder here is cheaper than chasing the Content-Type
				// negotiation quirk.
				dailyBriefDirect := newDailyBriefDirectHandler(h.GetDailyBrief, d.Log)
				r.Post("/intelligence/daily-brief", dailyBriefDirect)
				// Phase 1.5 insight stream — Hone web frontend дёргает напрямую.
				r.Get("/intelligence/insights", transcoder.ServeHTTP)
				r.Post("/intelligence/insights/{id}/ack", transcoder.ServeHTTP)
				// Pivot 2026-05-05: orphan REST aliases удалены —
				// Hone client дёргает Connect-RPC напрямую через
				// hone/api/intelligence.ts (askNotes/ackBrief/getMemoryStats/
				// getNextAction/getForkSnapshot/logResource/setLearningMode/
				// setForkBranch/getResourceTrail/getSkillRadar/getCoachStats).
				// Phase 5 — Hone /coach feed: last N days briefs newest-first.
				recentBriefs := newRecentBriefsHandler(briefs, d.Log)
				r.Get("/intelligence/briefs/recent", recentBriefs)
				// Phase 5 — admin /intelligence dashboard. Role check inside.
				adminStats := newAdminStatsHandler(d.Pool, d.Log)
				r.Get("/admin/intelligence/stats", adminStats)
				// Phase 4.3 — goals CRUD chi-direct (user-scoped via Bearer auth).
				goalsList, goalsCreate, goalsStatus, goalsDelete := newGoalsHandlers(goalsR, d.Log)
				r.Get("/goals", goalsList)
				r.Post("/goals", goalsCreate)
				r.Post("/goals/{id}/status", goalsStatus)
				r.Delete("/goals/{id}", goalsDelete)
			},
			Background: []func(context.Context){
				func(ctx context.Context) { go worker.Run(ctx) },
				func(ctx context.Context) { go retention.Run(ctx) },
				func(ctx context.Context) { go insightsSweep.Run(ctx) },
			},
		},
		Memory:           memory,
		Hook:             newIntelligenceMemoryHook(memory, d.Log),
		MockHook:         newMockMemoryHook(memory, d.Log),
		ExternalReader:   externalR,
		FocusReader:      focusR,
		MockReader:       mockR,
		SkillReader:      skillR,
		LinkSuggester:        &intelApp.SuggestNoteLinks{Chain: d.LLMChain},
		LogResourceUC:        server.LogResourceUC,
		InsightsRepo:         insightsRepo,
		GetUserContextUC:     getUserContextUC,
		MarkAtlasStruggleUC:  markAtlasStruggleUC,
		ListAtlasStrugglesUC: listAtlasStrugglesUC,
	}
}
