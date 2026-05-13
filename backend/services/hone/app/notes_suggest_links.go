// Package app — AI-rerank поверх pgvector top-K.
//
// Pipeline:
//  1. Re-embed seed note (как и GetNoteConnections — anchor к текущей model).
//  2. SearchSimilarNotes — top-K (default 10) candidates через pgvector.
//  3. LLM rerank через инжектируемый LinkSuggester (TaskNotesLinkSuggest).
//  4. Filter score < 0.3, cap by req.Max (≤ 10), order DESC.
//
// Не пишет в БД — accepted-link persistence отложен (UI пока показывает
// suggestions эфемерно, кликом «pin» пользователь может добавить
// markdown-ссылку в body — для MVP этого достаточно).
package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// LinkSuggester — port для LLM-rerank'а. Реализация живёт в intelligence
// (services/intelligence/app.SuggestNoteLinks), wire'ится через bootstrap
// adapter — так hone не импортирует intelligence напрямую.
type LinkSuggester interface {
	Rerank(ctx context.Context, req LinkSuggestReq) ([]LinkSuggestion, error)
}

// LinkSuggestReq — input для rerank'а.
type LinkSuggestReq struct {
	TargetNoteID  uuid.UUID
	TargetTitle   string
	TargetSnippet string
	Candidates    []LinkCandidate
	Max           int
}

// LinkCandidate — один candidate из pgvector top-K.
type LinkCandidate struct {
	NoteID     uuid.UUID
	Title      string
	Snippet    string
	Similarity float32
}

// LinkSuggestion — output: id + score + reason (LLM-generated).
type LinkSuggestion struct {
	TargetNoteID uuid.UUID
	Score        float32
	Reason       string
}

// SuggestNoteLinks UC.
type SuggestNoteLinks struct {
	Notes     domain.NoteRepo
	Embedder  domain.Embedder
	Suggester LinkSuggester
	Log       *slog.Logger
}

// SuggestNoteLinksInput — wire body.
type SuggestNoteLinksInput struct {
	UserID uuid.UUID
	NoteID uuid.UUID
	Max    int // default 5, max 10
}

// SuggestNoteLinksOutput — to-port shape (uses domain types so ports
// layer reads it without leaking app).
type SuggestNoteLinksOutput struct {
	NoteID  uuid.UUID
	Title   string
	Snippet string
	Score   float32
	Reason  string
}

func (uc *SuggestNoteLinks) Do(ctx context.Context, in SuggestNoteLinksInput) ([]SuggestNoteLinksOutput, error) {
	if uc.Embedder == nil {
		return nil, fmt.Errorf("hone.SuggestNoteLinks: %w", domain.ErrEmbeddingUnavailable)
	}
	if uc.Suggester == nil {
		return nil, fmt.Errorf("hone.SuggestNoteLinks: suggester not configured")
	}
	max := in.Max
	if max <= 0 {
		max = 5
	}
	if max > 10 {
		max = 10
	}

	seed, err := uc.Notes.Get(ctx, in.UserID, in.NoteID)
	if err != nil {
		return nil, fmt.Errorf("hone.SuggestNoteLinks: seed: %w", err)
	}

	seedVec, modelName, embedErr := uc.Embedder.Embed(ctx, seed.Title+"\n\n"+seed.BodyMD)
	if embedErr != nil {
		return nil, fmt.Errorf("hone.SuggestNoteLinks: embed: %w", embedErr)
	}

	hits, err := uc.Notes.SearchSimilarNotes(ctx, in.UserID, seedVec, modelName, seed.ID, 0.55, 10)
	if err != nil {
		return nil, fmt.Errorf("hone.SuggestNoteLinks: similar: %w", err)
	}
	if len(hits) == 0 {
		return nil, nil
	}

	cands := make([]LinkCandidate, len(hits))
	titleByID := make(map[uuid.UUID]string, len(hits))
	snippetByID := make(map[uuid.UUID]string, len(hits))
	for i, h := range hits {
		cands[i] = LinkCandidate{
			NoteID:     h.ID,
			Title:      h.Title,
			Snippet:    h.Snippet,
			Similarity: h.Score,
		}
		titleByID[h.ID] = h.Title
		snippetByID[h.ID] = h.Snippet
	}

	suggs, err := uc.Suggester.Rerank(ctx, LinkSuggestReq{
		TargetNoteID:  seed.ID,
		TargetTitle:   seed.Title,
		TargetSnippet: snippetN(seed.BodyMD, 400),
		Candidates:    cands,
		Max:           max,
	})
	if err != nil {
		// LLM-fallback: возвращаем embedding-only ranking без reason'а.
		// Лучше показать что-то, чем ронять весь UI panel при rate-limit'е
		// провайдера.
		if uc.Log != nil {
			uc.Log.Warn("hone.SuggestNoteLinks: rerank failed, embedding fallback", "err", err)
		}
		out := make([]SuggestNoteLinksOutput, 0, max)
		for i, h := range hits {
			if i >= max {
				break
			}
			out = append(out, SuggestNoteLinksOutput{
				NoteID:  h.ID,
				Title:   h.Title,
				Snippet: h.Snippet,
				Score:   h.Score,
				Reason:  "",
			})
		}
		return out, nil
	}

	out := make([]SuggestNoteLinksOutput, 0, len(suggs))
	for _, s := range suggs {
		title, ok := titleByID[s.TargetNoteID]
		if !ok {
			continue // hallucination guard (defence in depth — UC уже фильтрует)
		}
		out = append(out, SuggestNoteLinksOutput{
			NoteID:  s.TargetNoteID,
			Title:   title,
			Snippet: snippetByID[s.TargetNoteID],
			Score:   s.Score,
			Reason:  s.Reason,
		})
	}
	if len(out) > max {
		out = out[:max]
	}
	return out, nil
}

func snippetN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
