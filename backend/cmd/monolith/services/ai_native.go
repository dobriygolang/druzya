package services

import (
	ainativeApp "druz9/ai_native/app"
	ainativeDomain "druz9/ai_native/domain"
	ainativeInfra "druz9/ai_native/infra"
	ainativePorts "druz9/ai_native/ports"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// NewAINative wires the "AI-native" round (bible §19.1): submit prompts,
// the LLM emits provenance, traps catch hallucinations, scoring runs at
// finish. SubmitPrompt is server-streaming — the REST mount returns 415,
// Connect clients get the full stream.
func NewAINative(d Deps) *Module {
	sessions := ainativeInfra.NewSessions(d.Pool)
	provenance := ainativeInfra.NewProvenance(d.Pool)
	tasks := ainativeInfra.NewTasks(d.Pool)
	users := ainativeInfra.NewUsers(d.Pool)
	llm := ainativeInfra.NewOpenRouter(d.Cfg.LLM.OpenRouterAPIKey)
	traps := ainativeInfra.NewStaticTrapStore()

	create := &ainativeApp.CreateSession{
		Sessions: sessions, Tasks: tasks, Users: users,
		DefaultModelFree: enums.LLMModel(d.Cfg.LLM.DefaultModelFree),
		DefaultModelPaid: enums.LLMModel(d.Cfg.LLM.DefaultModelPaid),
		Log:              d.Log, Now: d.Now,
	}
	submit := &ainativeApp.SubmitPrompt{
		Sessions: sessions, Provenance: provenance,
		Tasks: tasks, Users: users,
		LLM: llm, Traps: traps,
		Policy:  ainativeDomain.DefaultTrapPolicy(),
		Scoring: ainativeDomain.DefaultScoring(),
		Log:     d.Log,
	}
	verify := &ainativeApp.Verify{
		Sessions: sessions, Provenance: provenance,
		Scoring: ainativeDomain.DefaultScoring(), Log: d.Log,
	}
	getProv := &ainativeApp.GetProvenance{Sessions: sessions, Provenance: provenance}
	getScore := &ainativeApp.GetScore{Sessions: sessions}
	finish := &ainativeApp.Finish{
		Sessions: sessions, Provenance: provenance,
		Bus: d.Bus, Scoring: ainativeDomain.DefaultScoring(), Log: d.Log, Now: d.Now,
	}

	server := ainativePorts.NewNativeServer(
		create, submit, verify, getProv, getScore, finish, d.Log,
	)

	// Public model-catalogue endpoint — drives the frontend AI-opponent
	// picker. Empty when OPENROUTER_API_KEY is unset (frontend hides the
	// panel in that case rather than showing fake choices).
	models := ainativePorts.NewModelsHandler(d.Cfg.LLM.OpenRouterAPIKey != "")

	connectPath, connectHandler := druz9v1connect.NewNativeServiceHandler(server)
	transcoder := mustTranscode("native", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Post("/native/session", transcoder.ServeHTTP)
			r.Post("/native/session/{sessionId}/prompt", transcoder.ServeHTTP)
			r.Post("/native/session/{sessionId}/verify", transcoder.ServeHTTP)
			r.Get("/native/session/{sessionId}/provenance", transcoder.ServeHTTP)
			r.Get("/native/session/{sessionId}/score", transcoder.ServeHTTP)
			models.Mount(r)
		},
	}
}
