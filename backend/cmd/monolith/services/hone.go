package services

import (
	"context"
	"log/slog"
	"time"

	honeApp "druz9/hone/app"
	honeDomain "druz9/hone/domain"
	honeInfra "druz9/hone/infra"
	honePorts "druz9/hone/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/ratelimit"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewHone wires the Hone desktop-cockpit bounded context.
//
// Adapter selection is governed by what's configured at boot:
//   - Synthesiser + CritiqueStreamer: real LLM-backed when d.LLMChain is
//     non-nil; otherwise NoLLM* floors return ErrLLMUnavailable (→ 503).
//   - Embedder: real Ollama-backed when OLLAMA_HOST is set; otherwise
//     NoEmbedder returns ErrEmbeddingUnavailable (→ 503 on GetNoteConnections).
//   - SkillAtlasReader: real adapter hits skill_nodes + atlas_nodes; when
//     the user has no rows yet, returns empty slice and the plan prompt
//     falls back to its generic-plan branch.
//
// The d.Pool / d.LLMChain / d.Cfg fields are the only inputs — all other
// per-domain dependencies are private to this file.
func NewHone(d Deps) *Module {
	plans := honeInfra.NewPlans(d.Pool)
	focus := honeInfra.NewFocus(d.Pool)
	streaks := honeInfra.NewStreaks(d.Pool)
	notes := honeInfra.NewNotes(d.Pool)
	whiteboards := honeInfra.NewWhiteboards(d.Pool)

	// LLM adapters — pick real vs floor per config.
	var (
		synthesiser      honeDomain.PlanSynthesizer
		critiqueStreamer honeDomain.CritiqueStreamer
		embedder         honeDomain.Embedder
	)
	if d.LLMChain != nil {
		synthesiser = honeInfra.NewLLMChainPlanSynthesiser(d.LLMChain, d.Log)
		critiqueStreamer = honeInfra.NewLLMChainCritiqueStreamer(d.LLMChain, d.Log)
		d.Log.Info("hone: LLM adapters wired (plan synthesis + whiteboard critique)")
	} else {
		synthesiser = honeInfra.NewNoLLMPlanSynthesiser()
		critiqueStreamer = honeInfra.NewNoLLMCritiqueStreamer()
		d.Log.Warn("hone: llmchain not configured — AI features (plan / critique) will return 503")
	}

	// Embedder wired off OLLAMA_HOST independently of the chain — the embed
	// model (bge-small) runs on the same sidecar that hosts the generative
	// floor model, but semantically they're separate concerns.
	if host := d.Cfg.LLMChain.OllamaHost; host != "" {
		embedder = honeInfra.NewHoneEmbedder(host, "") // "" → default bge-small
		d.Log.Info("hone: Ollama embedder wired", slog.String("ollama_host", host))
	} else {
		embedder = honeInfra.NewNoEmbedder()
		d.Log.Warn("hone: OLLAMA_HOST not set — notes auto-links will return 503")
	}

	// Cross-domain shim: weakest skill nodes from profile's tables. Lives
	// in adapters.go to keep boundaries clean (hone never imports profile).
	skills := NewHoneSkillAtlasAdapter(d.Pool)

	// Embedding job: async hook from CreateNote/UpdateNote. When a real
	// embedder is wired, the closure computes + persists the vector so
	// GetNoteConnections has warm data. When not wired, it's a debug log.
	embedFn := makeHoneEmbedJob(embedder, notes, d.Log)

	h := honeApp.NewHandler(honeApp.Handler{
		// Plan
		GeneratePlan:     &honeApp.GeneratePlan{Plans: plans, Skills: skills, Synthesiser: synthesiser, Log: d.Log, Now: d.Now},
		GetPlan:          &honeApp.GetPlan{Plans: plans, Now: d.Now},
		DismissPlanItem:  &honeApp.DismissPlanItem{Plans: plans, Now: d.Now},
		CompletePlanItem: &honeApp.CompletePlanItem{Plans: plans, Now: d.Now},

		// Focus
		StartFocus: &honeApp.StartFocus{Focus: focus, Log: d.Log, Now: d.Now},
		EndFocus:   &honeApp.EndFocus{Focus: focus, Streaks: streaks, Log: d.Log, Now: d.Now},
		GetStats:   &honeApp.GetStats{Streaks: streaks, Now: d.Now},

		// Notes
		CreateNote:         &honeApp.CreateNote{Notes: notes, EmbedFn: embedFn, Log: d.Log, Now: d.Now},
		UpdateNote:         &honeApp.UpdateNote{Notes: notes, EmbedFn: embedFn, Log: d.Log, Now: d.Now},
		GetNote:            &honeApp.GetNote{Notes: notes},
		ListNotes:          &honeApp.ListNotes{Notes: notes},
		DeleteNote:         &honeApp.DeleteNote{Notes: notes},
		GetNoteConnections: &honeApp.GetNoteConnections{Notes: notes, Embedder: embedder, Log: d.Log},

		// Whiteboards
		CreateWhiteboard:   &honeApp.CreateWhiteboard{Boards: whiteboards, Now: d.Now},
		UpdateWhiteboard:   &honeApp.UpdateWhiteboard{Boards: whiteboards, Now: d.Now},
		GetWhiteboard:      &honeApp.GetWhiteboard{Boards: whiteboards},
		ListWhiteboards:    &honeApp.ListWhiteboards{Boards: whiteboards},
		DeleteWhiteboard:   &honeApp.DeleteWhiteboard{Boards: whiteboards},
		CritiqueWhiteboard: &honeApp.CritiqueWhiteboard{Boards: whiteboards, Streamer: critiqueStreamer, Log: d.Log},

		Log: d.Log,
		Now: d.Now,
	})

	server := honePorts.NewHoneServer(h)
	// Rate-limit GenerateDailyPlan(force=true). Redis-less deployments
	// (tests) leave the limiter nil → the handler falls through unlimited.
	if d.Redis != nil {
		server = server.WithPlanLimiter(ratelimit.NewRedisFixedWindow(d.Redis))
	}
	connectPath, connectHandler := druz9v1connect.NewHoneServiceHandler(server)
	transcoder := mustTranscode("hone", connectPath, connectHandler)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Plan
			r.Post("/hone/plan/generate", transcoder.ServeHTTP)
			r.Get("/hone/plan", transcoder.ServeHTTP)
			r.Post("/hone/plan/dismiss", transcoder.ServeHTTP)
			r.Post("/hone/plan/complete", transcoder.ServeHTTP)
			// Focus
			r.Post("/hone/focus/start", transcoder.ServeHTTP)
			r.Post("/hone/focus/end", transcoder.ServeHTTP)
			r.Get("/hone/stats", transcoder.ServeHTTP)
			// Notes
			r.Post("/hone/notes", transcoder.ServeHTTP)
			r.Post("/hone/notes/update", transcoder.ServeHTTP)
			r.Get("/hone/notes", transcoder.ServeHTTP)
			r.Get("/hone/notes/{id}", transcoder.ServeHTTP)
			r.Post("/hone/notes/delete", transcoder.ServeHTTP)
			// Whiteboards
			r.Post("/hone/whiteboards", transcoder.ServeHTTP)
			r.Post("/hone/whiteboards/update", transcoder.ServeHTTP)
			r.Get("/hone/whiteboards", transcoder.ServeHTTP)
			r.Get("/hone/whiteboards/{id}", transcoder.ServeHTTP)
			r.Post("/hone/whiteboards/delete", transcoder.ServeHTTP)
			// GetNoteConnections / CritiqueWhiteboard — server-streaming.
			// Clients use Connect native transport, no REST alias needed.
		},
	}
}

// makeHoneEmbedJob returns the EmbedFn handed to CreateNote/UpdateNote. The
// function is fire-and-forget from the caller's perspective: the note is
// already saved, we just enrich it with an embedding when possible.
//
// A background-context is used intentionally — the HTTP request context is
// cancelled the moment the client gets their 200, but the embed job must
// outlive it. Errors are logged, not returned (no surface to return to).
func makeHoneEmbedJob(
	embedder honeDomain.Embedder,
	notes *honeInfra.Notes,
	log *slog.Logger,
) func(ctx context.Context, userID, noteID uuid.UUID, text string) {
	return func(ctx context.Context, userID, noteID uuid.UUID, text string) {
		vec, model, err := embedder.Embed(ctx, text)
		if err != nil {
			log.Debug("hone: embed skipped",
				slog.Any("err", err),
				slog.String("user_id", userID.String()),
				slog.String("note_id", noteID.String()))
			return
		}
		// Persist the vector. The note may have been updated again in the
		// meantime — that's fine, the next Update kicks a fresh embed job
		// and this write becomes harmless overwrite-of-identical-or-stale.
		//
		// time.Now() rather than Deps.Now because the embed goroutine runs
		// after the request context (and its clock) has been dismissed.
		if err := notes.SetEmbedding(ctx, userID, noteID, vec, model, time.Now().UTC()); err != nil {
			log.Warn("hone: embed persist failed",
				slog.Any("err", err),
				slog.String("note_id", noteID.String()))
		}
	}
}
