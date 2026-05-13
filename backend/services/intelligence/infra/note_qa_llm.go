package infra

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/llmchain"
)

// LLMChainNoteAnswerer — RAG-ответ по notes. При заданном
// coach.pinned_model в dynamic_config идёт через ModelOverride; иначе —
// TaskNoteQA routing.
type LLMChainNoteAnswerer struct {
	chain   llmchain.ChatClient
	cfg     CoachConfigReader
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainNoteAnswerer wires the adapter. chain MUST be non-nil.
// cfg may be nil — pin disabled (legacy task-routing).
func NewLLMChainNoteAnswerer(chain llmchain.ChatClient, cfg CoachConfigReader, log *slog.Logger) *LLMChainNoteAnswerer {
	if chain == nil {
		panic("intelligence.NewLLMChainNoteAnswerer: chain is required")
	}
	if log == nil {
		panic("intelligence.NewLLMChainNoteAnswerer: logger is required")
	}
	return &LLMChainNoteAnswerer{chain: chain, cfg: cfg, log: log, timeout: 30 * time.Second}
}

const noteQASystemPrompt = `You are answering a user's question using ONLY the notes provided below. Each note is numbered [1], [2], ... — these are the citation tokens.

Rules:
- Answer in markdown. Be concise (3-6 sentences typical). No greeting, no "based on the notes" preamble.
- Cite EVERY substantive claim using [N] referring to the note number. Multiple notes for one claim: [1,3].
- If the notes don't contain enough information to answer, say so plainly. DO NOT speculate. DO NOT make up facts.
- Do not mention "the notes" or "the documents". Just answer + cite.

Question and notes follow.`

// Answer assembles the prompt + calls the chain. Returns the markdown
// answer; citations are parsed by the use case.
func (a *LLMChainNoteAnswerer) Answer(ctx context.Context, in domain.AskNotesPromptInput) (string, error) {
	prompt := buildQAUserPrompt(in.Question, in.ContextNotes, in.PastEpisodes)

	ctx, cancel := context.WithTimeout(ctx, a.timeout)
	defer cancel()

	pinnedModel := ""
	if a.cfg != nil {
		pinnedModel = a.cfg.PinnedModel(ctx)
	}
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		req := llmchain.Request{
			Temperature: 0.3,
			MaxTokens:   600,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: noteQASystemPrompt},
				{Role: llmchain.RoleUser, Content: prompt},
			},
		}
		if pinnedModel != "" {
			req.ModelOverride = pinnedModel
		} else {
			req.Task = llmchain.TaskNoteQA
		}
		resp, err := a.chain.Chat(ctx, req)
		if err != nil {
			lastErr = err
			a.log.Warn("intelligence.LLMChainNoteAnswerer: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		out := strings.TrimSpace(resp.Content)
		if out == "" {
			lastErr = errors.New("empty response")
			continue
		}
		return out, nil
	}
	return "", fmt.Errorf("intelligence.LLMChainNoteAnswerer.Answer: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// MaxBodyChars caps each note's body in the prompt to keep total context
// well within 70B 32k limits even for a maxed-out 8-note top-K.
const MaxBodyChars = 1500

func buildQAUserPrompt(question string, ctxNotes []domain.NoteEmbedding, past []domain.Episode) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Question: %s\n\nNotes:\n", strings.TrimSpace(question))
	for i, n := range ctxNotes {
		body := n.Body
		if len(body) > MaxBodyChars {
			body = body[:MaxBodyChars] + "…"
		}
		fmt.Fprintf(&sb, "\n[%d] %s\n%s\n", i+1, n.Title, body)
	}
	if len(past) > 0 {
		sb.WriteString("\n\nPast questions/answers (for context — do not cite):\n")
		for _, e := range past {
			fmt.Fprintf(&sb, "- [%s] %s\n", e.OccurredAt.Format("2006-01-02"), e.Summary)
		}
	}
	return sb.String()
}
