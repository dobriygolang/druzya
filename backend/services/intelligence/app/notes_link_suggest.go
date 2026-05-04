// notes_link_suggest.go — Phase 5 AI-link suggestions для Notes UI.
//
// Pipeline:
//   1. Embed-based candidate retrieval — top-K notes по cosine similarity
//      к target note (existing embedding pipeline).
//   2. LLM rerank через TaskNotesLinkSuggest — JSON list
//      [{target_note_id, score, reason}].
//   3. Кэшируется per (target_note_id + candidate-hash) — caller имплементит
//      через Redis-обёртку, UC чисто-функциональный.
//
// UC намеренно не делает embedding-search сам — caller (handler) уже
// pull'ит candidates через NotesReader.SimilarNotes, передаёт сюда.
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// NotesLinkCandidate — candidate note для rerank'а.
type NotesLinkCandidate struct {
	NoteID  uuid.UUID
	Title   string
	Snippet string // first 200 chars body
	// SimilarityScore — pre-computed embedding cosine, передаётся для
	// контекста LLM'е (но LLM волен переопределить).
	SimilarityScore float64
}

// NotesLinkSuggestion — single output entry.
type NotesLinkSuggestion struct {
	TargetNoteID uuid.UUID `json:"target_note_id"`
	Score        float64   `json:"score"`  // 0..1
	Reason       string    `json:"reason"` // 1 sentence
}

// SuggestNoteLinks — UC.
type SuggestNoteLinks struct {
	Chain   llmchain.ChatClient
	Timeout time.Duration
}

// SuggestNoteLinksInput.
type SuggestNoteLinksInput struct {
	TargetNoteID    uuid.UUID
	TargetTitle     string
	TargetSnippet   string
	Candidates      []NotesLinkCandidate
	MaxSuggestions  int // default 5
}

// CacheKey deterministic — caller использует для Redis lookup.
func (in SuggestNoteLinksInput) CacheKey() string {
	h := sha256.New()
	h.Write([]byte(in.TargetNoteID.String()))
	h.Write([]byte("\x00"))
	ids := make([]string, len(in.Candidates))
	for i, c := range in.Candidates {
		ids[i] = c.NoteID.String()
	}
	sort.Strings(ids)
	h.Write([]byte(strings.Join(ids, ",")))
	return hex.EncodeToString(h.Sum(nil))[:16]
}

func (uc *SuggestNoteLinks) Do(ctx context.Context, in SuggestNoteLinksInput) ([]NotesLinkSuggestion, error) {
	if len(in.Candidates) == 0 {
		return nil, nil
	}
	max := in.MaxSuggestions
	if max <= 0 || max > 10 {
		max = 5
	}
	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	prompt := buildLinkPrompt(in)
	resp, err := uc.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskNotesLinkSuggest,
		JSONMode:    true,
		Temperature: 0.3,
		MaxTokens:   500,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: linkSuggestSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.SuggestNoteLinks: %w", err)
	}
	out, err := parseLinkSuggestions(resp.Content, in.Candidates)
	if err != nil {
		return nil, fmt.Errorf("intelligence.SuggestNoteLinks parse: %w", err)
	}
	if len(out) > max {
		out = out[:max]
	}
	return out, nil
}

const linkSuggestSystemPrompt = `You re-rank candidate notes against a target note for AI-suggested cross-links.

Output strict JSON ONLY (no markdown, no commentary):
[{"target_note_id":"<uuid>","score":<float 0..1>,"reason":"<1 sentence>"}]

Rules:
- Score 0..1 — your confidence the link is meaningful (semantic, not lexical).
- Discard candidates with score < 0.3 — empty array allowed.
- Reason cites WHY the link helps the user (concept overlap, prereq, contrast).
- Order by score DESC.`

func buildLinkPrompt(in SuggestNoteLinksInput) string {
	var b strings.Builder
	fmt.Fprintf(&b, "TARGET note %q:\n%s\n\n", in.TargetTitle, snippetN(in.TargetSnippet, 400))
	b.WriteString("CANDIDATES (id · title · cosine · snippet):\n")
	for _, c := range in.Candidates {
		fmt.Fprintf(&b, "  - %s · %q · cos=%.2f · %s\n",
			c.NoteID.String(), c.Title, c.SimilarityScore, snippetN(c.Snippet, 160))
	}
	b.WriteString("\nReturn re-ranked links.")
	return b.String()
}

func parseLinkSuggestions(raw string, allowed []NotesLinkCandidate) ([]NotesLinkSuggestion, error) {
	cleaned := stripFences(raw)
	var out []NotesLinkSuggestion
	if err := json.Unmarshal([]byte(cleaned), &out); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	allowedSet := make(map[uuid.UUID]struct{}, len(allowed))
	for _, c := range allowed {
		allowedSet[c.NoteID] = struct{}{}
	}
	filtered := out[:0]
	for _, s := range out {
		if _, ok := allowedSet[s.TargetNoteID]; !ok {
			continue // hallucination — LLM выдумал uuid
		}
		if s.Score < 0 || s.Score > 1 {
			continue
		}
		filtered = append(filtered, s)
	}
	return filtered, nil
}

func snippetN(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// Compile-time guard — UC использует чтобы избежать unused import warning.
var _ = domain.ErrLLMUnavailable
