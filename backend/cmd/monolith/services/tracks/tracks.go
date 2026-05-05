// Package tracks wires the curated learning-tracks bounded context
// into the monolith.
package tracks

import (
	"context"
	"fmt"

	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/llmchain"
	tracksApp "druz9/tracks/app"
	tracksInfra "druz9/tracks/infra"
	tracksPorts "druz9/tracks/ports"

	"github.com/go-chi/chi/v5"
)

// NewTracks wires the bounded context.
func NewTracks(d monolithServices.Deps) *monolithServices.Module {
	repo := tracksInfra.NewPostgres(d.Pool)
	server := tracksPorts.NewServer(
		&tracksApp.ListCatalog{Catalog: repo},
		&tracksApp.GetTrack{Catalog: repo},
		&tracksApp.ListUserTracks{Members: repo},
		&tracksApp.JoinTrack{Members: repo},
		&tracksApp.AdvanceStep{Catalog: repo, Members: repo},
		&tracksApp.PauseTrack{Members: repo},
		&tracksApp.LeaveTrack{Members: repo},
		d.Log,
	)
	// Phase 3.2 — AI-generated custom path. nil-safe: без llmchain endpoint
	// возвращает Unimplemented, фронт показывает «coming soon» баннер.
	if d.LLMChain != nil {
		server.CustomPath = &tracksApp.GenerateCustomPath{
			LLM: &customPathLLMAdapter{chain: d.LLMChain},
		}
	}

	// Phase 2 step UX (2026-05-04). StartCheckpoint работает без LLM
	// (только catalog read), Submit требует chain — wire'им оба только
	// когда llmchain доступен, чтобы не отдавать broken Submit.
	server.StartCheckpointUC = &tracksApp.StartCheckpoint{
		Catalog:     repo,
		Checkpoints: repo,
	}
	if d.LLMChain != nil {
		server.SubmitCheckpointUC = &tracksApp.SubmitCheckpoint{
			Catalog:     repo,
			Checkpoints: repo,
			Chain:       d.LLMChain,
		}
	}

	connectPath, connectHandler := druz9v1connect.NewTracksServiceHandler(server)
	transcoder := monolithServices.MustTranscode("tracks", connectPath, connectHandler)
	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			r.Get("/tracks", transcoder.ServeHTTP)
			r.Get("/tracks/me", transcoder.ServeHTTP)
			r.Get("/tracks/{slug}", transcoder.ServeHTTP)
			r.Post("/tracks/{track_id}/join", transcoder.ServeHTTP)
			r.Post("/tracks/{track_id}/advance", transcoder.ServeHTTP)
			r.Post("/tracks/{track_id}/pause", transcoder.ServeHTTP)
			r.Post("/tracks/{track_id}/leave", transcoder.ServeHTTP)
			r.Post("/tracks/custom-path/generate", transcoder.ServeHTTP)
			// Pivot 2026-05-05: checkpoint/start + /submit REST-aliases
			// удалены — Hone использует Connect-RPC напрямую (см.
			// hone/api/tracks.ts: client.startCheckpoint / submitCheckpoint).
		},
	}
}

// customPathLLMAdapter — adapter llmchain.ChatClient → tracksApp.PathLLMDispatcher.
type customPathLLMAdapter struct{ chain llmchain.ChatClient }

func (a *customPathLLMAdapter) GenerateCustomPath(ctx context.Context, goal string) ([]tracksApp.CustomPathNode, error) {
	if a == nil || a.chain == nil {
		return nil, nil
	}
	prompt := tracksApp.PromptCustomPath(goal)
	resp, err := a.chain.Chat(ctx, llmchain.Request{
		Task: llmchain.TaskCustomPathGenerate,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: "Ты — coach по подготовке к собесу. Возвращай ТОЛЬКО валидный JSON."},
			{Role: llmchain.RoleUser, Content: prompt},
		},
		Temperature: 0.4,
		MaxTokens:   1500,
		JSONMode:    true,
	})
	if err != nil {
		return nil, fmt.Errorf("custom path chat: %w", err)
	}
	out, err := tracksApp.ParseLLMResponse(resp.Content)
	if err != nil {
		return nil, fmt.Errorf("parse llm response: %w", err)
	}
	return out, nil
}
