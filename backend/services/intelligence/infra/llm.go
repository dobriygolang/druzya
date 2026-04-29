package infra

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/llmchain"
)

// ─── Floor adapters (no llmchain) ─────────────────────────────────────────

// NoLLMBriefSynthesiser returns ErrLLMUnavailable on every call.
type NoLLMBriefSynthesiser struct{}

// NewNoLLMBriefSynthesiser — floor constructor.
func NewNoLLMBriefSynthesiser() *NoLLMBriefSynthesiser { return &NoLLMBriefSynthesiser{} }

// Synthesise always returns ErrLLMUnavailable.
func (*NoLLMBriefSynthesiser) Synthesise(_ context.Context, _ domain.BriefPromptInput) (domain.DailyBrief, error) {
	return domain.DailyBrief{}, fmt.Errorf("intelligence.NoLLMBriefSynthesiser.Synthesise: %w", domain.ErrLLMUnavailable)
}

// NoLLMNoteAnswerer returns ErrLLMUnavailable on every call.
type NoLLMNoteAnswerer struct{}

// NewNoLLMNoteAnswerer — floor constructor.
func NewNoLLMNoteAnswerer() *NoLLMNoteAnswerer { return &NoLLMNoteAnswerer{} }

// Answer always returns ErrLLMUnavailable.
func (*NoLLMNoteAnswerer) Answer(_ context.Context, _ domain.AskNotesPromptInput) (string, error) {
	return "", fmt.Errorf("intelligence.NoLLMNoteAnswerer.Answer: %w", domain.ErrLLMUnavailable)
}

// ─── BriefSynthesiser (TaskDailyBrief) ────────────────────────────────────

// LLMChainBriefSynthesiser runs TaskDailyBrief in JSON-mode and parses
// the strict envelope into a DailyBrief.
//
// Phase III: если configReader выдаёт coach.pinned_model — Brief идёт
// через ModelOverride (single candidate, no fallback). Это сохраняет
// единый стиль коуча между запросами; admin меняет модель явно через
// dynamic_config. Пустая строка → fall back to TaskDailyBrief routing.
type LLMChainBriefSynthesiser struct {
	chain   llmchain.ChatClient
	cfg     CoachConfigReader
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainBriefSynthesiser wires the adapter. chain MUST be non-nil.
// cfg может быть nil — тогда pin отключён (legacy task-routing).
func NewLLMChainBriefSynthesiser(chain llmchain.ChatClient, cfg CoachConfigReader, log *slog.Logger) *LLMChainBriefSynthesiser {
	if chain == nil {
		panic("intelligence.NewLLMChainBriefSynthesiser: chain is required")
	}
	if log == nil {
		panic("intelligence.NewLLMChainBriefSynthesiser: logger is required")
	}
	return &LLMChainBriefSynthesiser{chain: chain, cfg: cfg, log: log, timeout: 30 * time.Second}
}

// Synthesise builds the prompt, calls the chain, parses JSON envelope.
// One retry on parse failure; second failure surfaces ErrLLMUnavailable.
func (s *LLMChainBriefSynthesiser) Synthesise(ctx context.Context, in domain.BriefPromptInput) (domain.DailyBrief, error) {
	userMsg := buildBriefUserPrompt(in)

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	// Phase III pin: если admin задал coach.pinned_model в dynamic_config,
	// идём через ModelOverride (single candidate, no fallback). Иначе —
	// task-routing. Кэширования здесь нет: одна row на DailyBrief, БД
	// hit копеечный.
	pinnedModel := ""
	if s.cfg != nil {
		pinnedModel = s.cfg.PinnedModel(ctx)
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		req := llmchain.Request{
			JSONMode:    true,
			Temperature: 0.4,
			MaxTokens:   700,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: briefSystemPrompt},
				{Role: llmchain.RoleUser, Content: userMsg},
			},
		}
		if pinnedModel != "" {
			req.ModelOverride = pinnedModel
		} else {
			req.Task = llmchain.TaskDailyBrief
		}
		resp, err := s.chain.Chat(ctx, req)
		if err != nil {
			lastErr = err
			s.log.Warn("intelligence.LLMChainBriefSynthesiser: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("user_id", in.UserID.String()))
			continue
		}
		brief, parseErr := parseBriefJSON(resp.Content, in)
		if parseErr != nil {
			lastErr = parseErr
			s.log.Warn("intelligence.LLMChainBriefSynthesiser: parse error",
				slog.Any("err", parseErr), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 200)))
			continue
		}
		return brief, nil
	}
	return domain.DailyBrief{}, fmt.Errorf("intelligence.LLMChainBriefSynthesiser.Synthesise: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// LLMChainNoteAnswerer runs TaskNoteQA in text mode against the assembled
// note context. One retry; second failure surfaces ErrLLMUnavailable.
// ─── interface guards ─────────────────────────────────────────────────────

var (
	_ domain.BriefSynthesizer = (*NoLLMBriefSynthesiser)(nil)
	_ domain.BriefSynthesizer = (*LLMChainBriefSynthesiser)(nil)
	_ domain.NoteAnswerer     = (*NoLLMNoteAnswerer)(nil)
	_ domain.NoteAnswerer     = (*LLMChainNoteAnswerer)(nil)
)
