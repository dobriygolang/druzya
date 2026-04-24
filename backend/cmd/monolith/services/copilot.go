package services

import (
	"context"
	"log/slog"
	"os"

	copilotApp "druz9/copilot/app"
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
func NewCopilot(d Deps) *Module {
	conversations := copilotInfra.NewConversations(d.Pool)
	messages := copilotInfra.NewMessages(d.Pool)
	quotas := copilotInfra.NewQuotas(d.Pool)
	sessions := copilotInfra.NewSessions(d.Pool)
	reports := copilotInfra.NewReports(d.Pool)
	llm := copilotInfra.NewOpenRouter(d.Cfg.LLM.OpenRouterAPIKey)
	cfgProvider := copilotInfra.NewStaticConfigProvider()

	analyzer := copilotInfra.NewLLMAnalyzer(
		d.Cfg.LLM.OpenRouterAPIKey,
		os.Getenv("COPILOT_ANALYZER_MODEL"),       // optional override; empty = gpt-4o-mini
		os.Getenv("COPILOT_REPORT_URL_TEMPLATE"), // optional override
	)

	analyze := &copilotApp.Analyze{
		Conversations: conversations,
		Messages:      messages,
		Quotas:        quotas,
		LLM:           llm,
		Config:        cfgProvider,
		Sessions:      sessions, // auto-attach new turns to live session
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

	startSession := &copilotApp.StartSession{Sessions: sessions}
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
		},
		Background: []func(ctx context.Context){
			runAnalysisSubscriber(sessionEvents, runAnalysis, d.Log),
		},
		Shutdown: []func(ctx context.Context) error{
			func(context.Context) error {
				close(sessionEvents)
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
