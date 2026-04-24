package services

import (
	"context"
	"log/slog"
	"os"

	copilotApp "druz9/copilot/app"
	copilotDomain "druz9/copilot/domain"
	copilotInfra "druz9/copilot/infra"
	copilotPorts "druz9/copilot/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewCopilot wires the "Druz9 Copilot" bounded context.
//
// Phase 12 additions: sessions (Start / End / GetAnalysis / List). A
// buffered channel + background goroutine bridges EndSession → analyzer
// so the Connect handler returns immediately and the LLM runs in the
// background.
//
// Screenshot bytes still flow client → server → LLM → /dev/null. See
// docs/copilot-architecture.md.
func NewCopilot(d Deps, docSearcher copilotDomain.DocumentSearcher) *Module {
	conversations := copilotInfra.NewConversations(d.Pool)
	messages := copilotInfra.NewMessages(d.Pool)
	quotas := copilotInfra.NewQuotas(d.Pool)
	sessions := copilotInfra.NewSessions(d.Pool)
	reports := copilotInfra.NewReports(d.Pool)
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
	cfgProvider := copilotInfra.NewStaticConfigProvider()

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
	compactor, compactionCfg, cwErr := BuildCompactionWorker(d.LLMChain, summaryStore, d.Log)
	if cwErr != nil && d.Log != nil {
		d.Log.Info("copilot: compaction worker disabled", "reason", cwErr)
	}

	analyze := &copilotApp.Analyze{
		Conversations: conversations,
		Messages:      messages,
		Quotas:        quotas,
		LLM:           llm,
		Config:        cfgProvider,
		Sessions:      sessions, // auto-attach new turns to live session
		DocSearcher:   docSearcher, // nil when documents module is disabled — RAG cleanly skipped
		Compactor:     compactor,
		CompactionCfg: compactionCfg,
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
	runAnalysis := &copilotApp.RunAnalysis{
		Sessions:     sessions,
		Messages:     messages,
		Reports:      reports,
		Analyzer:     analyzer,
		ReportURLFor: analyzer.ReportURLFor,
		Log:          d.Log,
	}

	server := copilotPorts.NewCopilotServer(
		analyze, chat, listHistory, getConv, deleteConv,
		listProviders, getQuota, getConfig, rate,
		startSession, endSession, getAnalysis, listSessions,
		d.Log,
	)

	connectPath, connectHandler := druz9v1connect.NewCopilotServiceHandler(server)
	transcoder := mustTranscode("copilot", connectPath, connectHandler)

	// Plain-REST handler for session↔document attach/detach. Sits
	// alongside the Connect transcoder on the same module — mounted
	// below in MountREST.
	sessionDocs := &copilotPorts.SessionDocumentsHandler{Sessions: sessions, Log: d.Log}

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/copilot/analyze", transcoder.ServeHTTP)
			r.Post("/copilot/conversations/{conversationId}/chat", transcoder.ServeHTTP)

			r.Get("/copilot/history", transcoder.ServeHTTP)
			r.Get("/copilot/conversations/{id}", transcoder.ServeHTTP)
			r.Delete("/copilot/conversations/{id}", transcoder.ServeHTTP)

			r.Get("/copilot/providers", transcoder.ServeHTTP)
			r.Get("/copilot/quota", transcoder.ServeHTTP)
			r.Get("/copilot/desktop-config", transcoder.ServeHTTP)

			r.Post("/copilot/messages/{messageId}/rate", transcoder.ServeHTTP)

			// Sessions.
			r.Post("/copilot/sessions", transcoder.ServeHTTP)
			r.Post("/copilot/sessions/{sessionId}/end", transcoder.ServeHTTP)
			r.Get("/copilot/sessions/{sessionId}/analysis", transcoder.ServeHTTP)
			r.Get("/copilot/sessions", transcoder.ServeHTTP)

			// Session ↔ documents attachment. Plain REST, not RPC —
			// see ports/session_docs.go for rationale.
			sessionDocs.Mount(r)
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
