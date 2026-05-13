package copilot

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	monolithServices "druz9/cmd/monolith/services"
	copilotApp "druz9/copilot/app"
	copilotDomain "druz9/copilot/domain"
	copilotInfra "druz9/copilot/infra"
	copilotPorts "druz9/copilot/ports"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/ratelimit"
	subDomain "druz9/subscription/domain"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewCopilot wires the "Druz9 Copilot" bounded context.
//
// Sessions (Start / End / GetAnalysis / List) bridge to a buffered
// channel + background goroutine: EndSession → analyzer, so the
// Connect handler returns immediately and the LLM runs in the
// background.
//
// Screenshot bytes still flow client → server → LLM → /dev/null. See
// docs/copilot-architecture.md.
func NewCopilot(d monolithServices.Deps, docSearcher copilotDomain.DocumentSearcher) *monolithServices.Module {
	conversations := copilotInfra.NewConversations(d.Pool)
	messages := copilotInfra.NewMessages(d.Pool)
	quotas := copilotInfra.NewQuotas(d.Pool)
	sessions := copilotInfra.NewSessions(d.Pool)
	reports := copilotInfra.NewReports(d.Pool)
	// Interview-prep repo. Reads / writes interview_prep_sessions
	// (DB v107). Implements both InterviewPrepRepo (writer-side:
	// StartActive/GetActive/EndActive) and InterviewPrepProvider
	// (reader-side, nil-safe per turn).
	interviewPreps := copilotInfra.NewInterviewPreps(d.Pool)

	// DynamicConfigProvider owns the SELECT against dynamic_config —
	// cmd/ должен оставаться pure facade, поэтому per-tier config
	// читается через метод инфраструктуры (PlanForTier), а не inline
	// pool.QueryRow внутри cmd/.
	dynCfg := copilotInfra.NewDynamicConfigProvider(d.Pool)
	var cfgProvider copilotDomain.ConfigProvider = dynCfg

	// Sync subscription.plan → copilot_quotas.plan. Раньше после Boosty
	// upgrade (subscriptions.plan = pro) юзер видел free-лимиты
	// потому что copilot_quotas жил в собственной таблице без
	// автосинка. Теперь WireSubscriptionQuota делает SetTier shared,
	// мы регистрируемся на его OnTierChanged hook.
	if d.SetTierUC != nil {
		d.SetTierUC.OnTierChanged = func(ctx context.Context, userID uuid.UUID, tier subDomain.Tier) error {
			plan := dynCfg.PlanForTier(ctx, tier)
			if err := quotas.UpdatePlan(ctx, userID, enums.SubscriptionPlan(plan.ID), plan.RequestsCap, plan.ModelsAllowed); err != nil {
				return fmt.Errorf("copilot: UpdatePlan: %w", err)
			}
			// Tier-downgrade graceful migration. Если новый tier
			// ограничивает models (Free whitelist = ["druz9/turbo"]),
			// сбрасываем pinned-модели в conversations которые теперь
			// недоступны. Next turn → DefaultModelID fallback (Turbo) →
			// continuation вместо ErrTierRequired. Pro/Max имеют
			// ModelsAllowed=nil → no-op.
			if n, err := conversations.ResetModelsNotIn(ctx, userID, plan.ModelsAllowed); err != nil {
				if d.Log != nil {
					d.Log.Warn("copilot: tier-downgrade conv reset failed",
						"err", err, "user", userID, "tier", tier)
				}
			} else if n > 0 && d.Log != nil {
				d.Log.Info("copilot: tier-downgrade reset conv models",
					"user", userID, "tier", tier, "reset", n)
			}
			return nil
		}
	}
	// Read-only gate into ai_mock.mock_sessions per ADR-001.
	// Single canonical cross-service read: see infra/mock_gate.go.
	mockGate := copilotInfra.NewMockSessionGate(d.Pool)
	// LLM dispatch: prefer the multi-provider chain when boot registered
	// at least one driver; fall back to direct-OpenRouter otherwise so
	// dev environments without GROQ_API_KEY still work. The chain is a
	// superset of OpenRouter's behaviour — when only the OpenRouter
	// driver is registered, it effectively emulates the legacy client
	// with proper typed errors.
	var llm copilotDomain.LLMProvider
	if d.LLMChain != nil {
		llm = copilotInfra.NewChainedLLM(d.LLMChain)
	} else {
		llm = copilotInfra.NewOpenRouter(d.Cfg.LLM.OpenRouterAPIKey)
	}

	analyzer := copilotInfra.NewLLMAnalyzer(
		d.Cfg.LLM.OpenRouterAPIKey,
		os.Getenv("COPILOT_ANALYZER_MODEL"),      // optional override; empty = gpt-4o-mini
		os.Getenv("COPILOT_REPORT_URL_TEMPLATE"), // optional override
	)

	// Context-compaction worker: sliding-window + фоновая суммаризация.
	// SummaryStore пишет running_summary в copilot_conversations. Worker
	// может быть nil (disabled-ветка), если LLMChain не был построен —
	// тогда Analyze просто обрезает prior до WindowSize без фонового
	// summary-пересчёта. См. services/compaction.go.
	summaryStore := copilotInfra.NewConversationSummaryStore(d.Pool)
	compactor, compactionCfg, cwErr := monolithServices.BuildCompactionWorker(d.LLMChain, summaryStore, d.Log)
	if cwErr != nil && d.Log != nil {
		d.Log.Info("copilot: compaction worker disabled", "reason", cwErr)
	}

	// Cross-product context provider for the Cue suggestion path.
	// Wraps intelligence's GetUserContext UC with a 60s Redis cache.
	// nil-safe at every level: when intelligence UC not wired
	// (d.IntelligenceUserContext=nil) or Redis is down, the suggestion
	// path falls back to generic prompts gracefully.
	//
	// userContextProvider is a typed nil-or-adapter. We assign it as an
	// interface field below; pass nil-interface (not typed nil) when
	// adapter is unbuilt to keep nil-checks in callers cheap.
	var userContextProvider copilotDomain.UserContextProvider
	if adapter := newUserContextAdapter(d.IntelligenceUserContext, d.Redis, d.Log); adapter != nil {
		userContextProvider = adapter
	}

	analyze := &copilotApp.Analyze{
		Conversations: conversations,
		Messages:      messages,
		Quotas:        quotas,
		LLM:           llm,
		Config:        cfgProvider,
		Sessions:      sessions,    // auto-attach new turns to live session
		DocSearcher:   docSearcher, // nil when documents module is disabled — RAG cleanly skipped
		KillSwitch:    d.KillSwitch,
		TokenQuota:    d.TokenQuota,
		MockGate:      mockGate,
		Compactor:     compactor,
		CompactionCfg: compactionCfg,
		// Cross-product context. nil-safe.
		UserContext: userContextProvider,
		// Interview-prep. nil-safe — when the user hasn't run the wizard,
		// LoadActivePrep returns an empty struct and the prep-block
		// emission collapses to nothing.
		InterviewPrep: interviewPreps,
		Log:           d.Log,
		Now:           d.Now,
	}
	chat := &copilotApp.Chat{Inner: analyze}
	listHistory := &copilotApp.ListHistory{Conversations: conversations}
	getConv := &copilotApp.GetConversation{Conversations: conversations, Messages: messages}
	deleteConv := &copilotApp.DeleteConversation{Conversations: conversations}
	listProviders := &copilotApp.ListProviders{Config: cfgProvider, Quotas: quotas}
	getQuota := &copilotApp.GetQuota{Quotas: quotas, Now: d.Now}
	getConfig := &copilotApp.GetDesktopConfig{Config: cfgProvider}
	rate := &copilotApp.RateMessage{Messages: messages}

	// Single-subscriber event pipeline for session-ended → analyzer. A
	// local buffered channel fits better than the generic eventbus: the
	// bus's event types don't include this domain yet, and making the
	// wiring generic for one consumer adds friction without value.
	sessionEvents := make(chan copilotApp.SessionEndedEvent, 32)
	publisher := channelPublisher{ch: sessionEvents}

	// Rate-limit 10/min per user на StartSession — защита LLM-бюджета free-tier:
	// без лимита юзер мог бы в цикле start/end и тихо жечь бюджет через бэкграунд-аналайзер.
	var startLimiter copilotDomain.RateLimiter
	if d.Redis != nil {
		startLimiter = copilotInfra.NewRedisRateLimiter(d.Redis)
	}
	startSession := &copilotApp.StartSession{Sessions: sessions, Limiter: startLimiter}
	endSession := &copilotApp.EndSession{
		Sessions:  sessions,
		Reports:   reports,
		Publisher: publisher,
		Log:       d.Log,
	}
	getAnalysis := &copilotApp.GetSessionAnalysis{Sessions: sessions, Reports: reports}
	listSessions := &copilotApp.ListSessions{Sessions: sessions}
	checkBlock := &copilotApp.CheckBlock{Gate: mockGate}

	// Interview-prep wizard use cases. ParseCV / ParseJD use the same
	// llmchain.ChatClient as Analyze (free LLM cascade) so no extra
	// credentials needed. nil-safe wiring: if d.LLMChain is nil (dev
	// without GROQ_API_KEY), the use cases would always 502 — we guard
	// by leaving them unwired in that branch.
	var (
		parseCVUC    *copilotApp.ParseCV
		parseJDUC    *copilotApp.ParseJD
		startPrepUC  *copilotApp.StartInterviewPrep
		getPrepUC    *copilotApp.GetActiveInterviewPrep
		endPrepUC    *copilotApp.EndInterviewPrep
	)
	if d.LLMChain != nil {
		parseCVUC = &copilotApp.ParseCV{Chain: d.LLMChain}
		parseJDUC = &copilotApp.ParseJD{Chain: d.LLMChain}
	}
	startPrepUC = &copilotApp.StartInterviewPrep{Preps: interviewPreps}
	getPrepUC = &copilotApp.GetActiveInterviewPrep{Preps: interviewPreps}
	endPrepUC = &copilotApp.EndInterviewPrep{Preps: interviewPreps}
	runAnalysis := &copilotApp.RunAnalysis{
		Sessions:     sessions,
		Messages:     messages,
		Reports:      reports,
		Analyzer:     analyzer,
		ReportURLFor: analyzer.ReportURLFor,
		// Bus fan-out: CoachListener picks it up to fold into coach memory.
		Bus: d.Bus,
		Log: d.Log,
	}

	server := copilotPorts.NewCopilotServer(
		analyze, chat, listHistory, getConv, deleteConv,
		listProviders, getQuota, getConfig, rate,
		startSession, endSession, getAnalysis, listSessions,
		checkBlock,
		d.Log,
	)
	// Attach interview-prep use cases. Direct field assignment (not
	// constructor) keeps the NewCopilotServer signature stable; the
	// server's compile-time interface check covers the handler set.
	server.ParseCVUC = parseCVUC
	server.ParseJDUC = parseJDUC
	server.StartInterviewPrepUC = startPrepUC
	server.GetActiveInterviewPrepUC = getPrepUC
	server.EndInterviewPrepUC = endPrepUC
	// Burst rate-limit on Analyze/Chat (поверх per-day CopilotQuota).
	// Защищает Groq pool от спайков одного юзера → не валит free-tier
	// shared rate-limit для других. nil-safe: dev без Redis → no limit.
	if d.Redis != nil {
		server.AnalyzeLimiter = ratelimit.NewRedisFixedWindow(d.Redis)
	}

	connectPath, connectHandler := druz9v1connect.NewCopilotServiceHandler(server)
	transcoder := monolithServices.MustTranscode("copilot", connectPath, connectHandler)

	// Plain-REST handler for session↔document attach/detach. Sits
	// alongside the Connect transcoder on the same module — mounted
	// below in MountREST.
	sessionDocs := &copilotPorts.SessionDocumentsHandler{Sessions: sessions, Log: d.Log}
	syncMemory := &copilotApp.SyncMemory{
		Conversations: conversations,
		Memory:        newMemorySink(d.IntelligenceMemory, d.Now),
	}
	memoryHandler := copilotPorts.NewMemoryHandler(copilotPorts.MemoryHandler{
		Sync: syncMemory,
		Log:  d.Log,
	})

	// Auto-trigger suggestion endpoint. Ephemeral — no conversation
	// persistence. Shares the LLM provider with Analyze/Chat but with
	// tighter temperature + token budget. UserContext provider injects
	// goal/memory/activity/radar as system-prompt prefix — moat vs
	// Cluely (nil-safe). InterviewPrep provider injects parsed CV+JD as
	// a second system block — tailored per-interview prior.
	suggest := &copilotApp.Suggest{
		LLM:           llm,
		Config:        cfgProvider,
		TokenQuota:    d.TokenQuota,
		UserContext:   userContextProvider,
		InterviewPrep: interviewPreps,
		Log:           d.Log,
	}
	var suggestLimiter *ratelimit.RedisFixedWindow
	if d.Redis != nil {
		suggestLimiter = ratelimit.NewRedisFixedWindow(d.Redis)
	}
	suggestionHandler := &copilotPorts.SuggestionHandler{
		Suggest:    suggest,
		Limiter:    suggestLimiter,
		KillSwitch: d.KillSwitch,
		Log:        d.Log,
	}

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Orphan copilot REST aliases удалены — Cue client дёргает
			// Connect-RPC напрямую (см. cue/src/main/api/*.ts:
			// client.getConversation/getQuota/rateMessage/...).
			// Sessions REST — реально используется Cue
			// (см. cue/src/main/api/sessions.ts).
			r.Post("/copilot/sessions", transcoder.ServeHTTP)
			r.Post("/copilot/sessions/{sessionId}/end", transcoder.ServeHTTP)
			r.Get("/copilot/sessions/{sessionId}/analysis", transcoder.ServeHTTP)
			r.Get("/copilot/sessions", transcoder.ServeHTTP)

			// Session ↔ documents attachment. Plain REST, not RPC —
			// see ports/session_docs.go for rationale.
			sessionDocs.Mount(r)
			r.Put("/copilot/memory/{conversationId}", memoryHandler.ServeHTTP)

			// Ephemeral auto-trigger suggestion.
			suggestionHandler.Mount(r)
		},
		Background: []func(ctx context.Context){
			// MUST go: App.Run calls each Background bg(rootCtx) inline,
			// so a blocking subscriber loop here would prevent the HTTP
			// server from ever reaching ListenAndServe (the rest of the
			// codebase's Background entries explicitly spawn — match that
			// convention, otherwise /health/ready times out forever).
			func(ctx context.Context) {
				sub := runAnalysisSubscriber(sessionEvents, runAnalysis, d.Log)
				go sub(ctx)
			},
			// Start воркера compaction (если создан) под rootCtx.
			// Внутри Start — fire-and-forget goroutines, не блокирует.
			func(ctx context.Context) {
				if compactor != nil {
					compactor.Start(ctx)
				}
			},
		},
		Shutdown: []func(ctx context.Context) error{
			func(context.Context) error {
				close(sessionEvents)
				return nil
			},
			// Drain in-flight compaction-jobs до закрытия Redis/pool.
			func(context.Context) error {
				if compactor != nil {
					compactor.Shutdown()
				}
				return nil
			},
		},
	}
}

// channelPublisher bridges EndSession's synchronous PublishSessionEnded
// call to the subscriber goroutine. On overflow we drop rather than
// block — a stuck Connect handler is worse than a best-effort guarantee
// on post-session reports. Ops can requeue by manually resetting
// stuck-in-pending report rows.
type channelPublisher struct {
	ch chan<- copilotApp.SessionEndedEvent
}

func (p channelPublisher) PublishSessionEnded(_ context.Context, ev copilotApp.SessionEndedEvent) {
	select {
	case p.ch <- ev:
	default:
	}
}

func runAnalysisSubscriber(
	ch <-chan copilotApp.SessionEndedEvent,
	run *copilotApp.RunAnalysis,
	log *slog.Logger,
) func(ctx context.Context) {
	return func(ctx context.Context) {
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-ch:
				if !ok {
					return
				}
				if err := run.Do(ctx, copilotApp.RunAnalysisInput{SessionID: ev.SessionID}); err != nil && log != nil {
					log.Warn("copilot.analyzer: run failed",
						"err", err, "session", ev.SessionID, "user", ev.UserID)
				}
			}
		}
	}
}
