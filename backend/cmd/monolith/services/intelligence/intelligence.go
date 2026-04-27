package intelligence

import (
	"context"

	monolithServices "druz9/cmd/monolith/services"
	honeDomain "druz9/hone/domain"
	intelApp "druz9/intelligence/app"
	intelDomain "druz9/intelligence/domain"
	intelInfra "druz9/intelligence/infra"
	intelPorts "druz9/intelligence/ports"
	miDomain "druz9/mock_interview/domain"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/metrics"

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
}

func New(d monolithServices.Deps) IntelligenceModule {
	briefs := intelInfra.NewCachedDailyBriefs(
		intelInfra.NewDailyBriefs(d.Pool),
		intelInfra.NewBriefRedisKV(d.Redis),
		intelApp.CacheTTL,
		d.Log,
	)
	episodes := intelInfra.NewEpisodes(d.Pool)

	focusR := &intelFocusReader{pool: d.Pool}
	planR := &intelPlanReader{pool: d.Pool}
	notesR := &intelNotesReader{pool: d.Pool}
	// Cross-product readers — все опциональные. Coach prompt получает
	// сигналы и из Hone, и из druz9 (mocks/arena/kata) и из user'ского
	// Today (queue, daily notes). См. domain/repo.go BriefPromptInput
	// и services/intelligence.go cross-product readers ниже.
	mockR := &intelMockReader{pool: d.Pool}
	kataR := &intelKataReader{pool: d.Pool}
	arenaR := &intelArenaReader{pool: d.Pool}
	queueR := &intelQueueReader{pool: d.Pool}
	skillR := &intelSkillReader{pool: d.Pool}
	dailyR := &intelDailyNoteReader{pool: d.Pool}
	calR := &intelCalendarReader{pool: d.Pool}
	mockMsgR := &intelMockMessagesReader{pool: d.Pool}
	codexR := &intelCodexReader{pool: d.Pool}

	embedder := newIntelEmbedder(d)

	var (
		synth    intelDomain.BriefSynthesizer
		answerer intelDomain.NoteAnswerer
	)
	if d.LLMChain != nil {
		synth = intelInfra.NewLLMChainBriefSynthesiser(d.LLMChain, d.Log)
		answerer = intelInfra.NewLLMChainNoteAnswerer(d.LLMChain, d.Log)
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
			Kata:         kataR,
			Arena:        arenaR,
			Queue:        queueR,
			Skills:       skillR,
			DailyNotes:   dailyR,
			Calendar:     calR,
			MockMessages: mockMsgR,
			Codex:        codexR,
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

	server := intelPorts.NewIntelligenceServer(h, memory)
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
				r.Post("/intelligence/ask-notes", transcoder.ServeHTTP)
				r.Post("/intelligence/brief/ack", transcoder.ServeHTTP)
				r.Get("/intelligence/memory/stats", transcoder.ServeHTTP)
			},
			Background: []func(context.Context){
				func(ctx context.Context) { go worker.Run(ctx) },
			},
		},
		Memory:   memory,
		Hook:     newIntelligenceMemoryHook(memory, d.Log),
		MockHook: newMockMemoryHook(memory, d.Log),
	}
}
