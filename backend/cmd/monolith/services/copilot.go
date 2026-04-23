package services

import (
	copilotApp "druz9/copilot/app"
	copilotInfra "druz9/copilot/infra"
	copilotPorts "druz9/copilot/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewCopilot wires the "Druz9 Copilot" bounded context — the stealthy
// desktop AI assistant. Analyze and Chat are server-streaming; REST paths
// survive via vanguard but emit only a single final frame, so the desktop
// client prefers the native Connect streaming path for real token deltas.
//
// Screenshot bytes flow through Analyze/Chat and are discarded after the
// LLM returns — never persisted. See docs/copilot-architecture.md.
func NewCopilot(d Deps) *Module {
	conversations := copilotInfra.NewConversations(d.Pool)
	messages := copilotInfra.NewMessages(d.Pool)
	quotas := copilotInfra.NewQuotas(d.Pool)
	llm := copilotInfra.NewOpenRouter(d.Cfg.LLM.OpenRouterAPIKey)
	cfgProvider := copilotInfra.NewStaticConfigProvider()

	analyze := &copilotApp.Analyze{
		Conversations: conversations,
		Messages:      messages,
		Quotas:        quotas,
		LLM:           llm,
		Config:        cfgProvider,
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

	server := copilotPorts.NewCopilotServer(
		analyze, chat, listHistory, getConv, deleteConv,
		listProviders, getQuota, getConfig, rate,
		d.Log,
	)

	connectPath, connectHandler := druz9v1connect.NewCopilotServiceHandler(server)
	transcoder := mustTranscode("copilot", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Analyze / Chat stream — transcoder returns a single final
			// frame over REST. Desktop clients should use the Connect path.
			r.Post("/copilot/analyze", transcoder.ServeHTTP)
			r.Post("/copilot/conversations/{conversationId}/chat", transcoder.ServeHTTP)

			r.Get("/copilot/history", transcoder.ServeHTTP)
			r.Get("/copilot/conversations/{id}", transcoder.ServeHTTP)
			r.Delete("/copilot/conversations/{id}", transcoder.ServeHTTP)

			r.Get("/copilot/providers", transcoder.ServeHTTP)
			r.Get("/copilot/quota", transcoder.ServeHTTP)
			r.Get("/copilot/desktop-config", transcoder.ServeHTTP)

			r.Post("/copilot/messages/{messageId}/rate", transcoder.ServeHTTP)
		},
	}
}
