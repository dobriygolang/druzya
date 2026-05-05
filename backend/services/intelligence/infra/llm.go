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
//
// Phase 4.1 — two-stage reflective brief: when severity ∈ {warn, critical}
// AND coach.reflective_enabled = true в dynamic_config, the parsed sketch
// goes through a critique LLM call that either confirms or refines it.
// Critique failures fall back to the sketch silently — мы платим за
// reflection качеством, а не за возможность сломать happy path.
func (s *LLMChainBriefSynthesiser) Synthesise(ctx context.Context, in domain.BriefPromptInput) (domain.DailyBrief, error) {
	userMsg := buildBriefUserPrompt(in)

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	// Phase III pin: если admin задал coach.pinned_model в dynamic_config,
	// идём через ModelOverride (single candidate, no fallback). Иначе —
	// task-routing. Кэширования здесь нет: одна row на DailyBrief, БД
	// hit копеечный.
	pinnedModel := ""
	personaOverlay := ""
	variantOverlay := ""
	if s.cfg != nil {
		pinnedModel = s.cfg.PinnedModel(ctx)
		personaOverlay = personaToneOverlay(s.cfg.Persona(ctx))
		variantOverlay = variantPromptOverlay(s.cfg.PromptVariant(ctx))
	}

	// Phase 4.2 + Phase 5 — overlays = optional system messages added в обе
	// stages (sketch + critique). Order: persona, variant — persona задаёт
	// tone (warmth / rigor), variant — формат (terse / sharp). Variant идёт
	// последним, чтобы при конфликте перевешивать.
	sketchMessages := func() []llmchain.Message {
		out := []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: briefSystemPrompt},
		}
		if personaOverlay != "" {
			out = append(out, llmchain.Message{Role: llmchain.RoleSystem, Content: personaOverlay})
		}
		if variantOverlay != "" {
			out = append(out, llmchain.Message{Role: llmchain.RoleSystem, Content: variantOverlay})
		}
		out = append(out, llmchain.Message{Role: llmchain.RoleUser, Content: userMsg})
		return out
	}

	var (
		lastErr   error
		sketch    domain.DailyBrief
		sketchRaw string
		sketchOK  bool
	)
	for attempt := 0; attempt < 2; attempt++ {
		req := llmchain.Request{
			JSONMode:    true,
			Temperature: 0.4,
			MaxTokens:   700,
			Messages:    sketchMessages(),
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
		sketch = brief
		sketchRaw = resp.Content
		sketchOK = true
		break
	}
	if !sketchOK {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.LLMChainBriefSynthesiser.Synthesise: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
	}

	// Phase 4.1 — reflective critique gate (Phase R6 — selective by signal confidence).
	if s.shouldReflect(ctx, sketch, in) {
		refined, err := s.reflect(ctx, in, sketch, sketchRaw, pinnedModel, personaOverlay, variantOverlay)
		if err != nil {
			s.log.Warn("intelligence.LLMChainBriefSynthesiser: critique fell back to sketch",
				slog.Any("err", err), slog.String("user_id", in.UserID.String()),
				slog.String("severity", string(sketch.Severity)))
			return sketch, nil
		}
		return refined, nil
	}
	return sketch, nil
}

// shouldReflect — Phase R6 gated critique gate. Critique runs только когда:
//  1. coach.reflective_enabled == true в dynamic_config,
//  2. severity grade carries enough confidence to pay the second pass:
//     - critical → always (high stake, paying critique is justified)
//     - warn → only when (interview within 4-7d, OR repeated mock weak topic ≥3,
//     OR ≥2 abandoned mocks recent). Bare warn (e.g. low focus week) doesn't
//     benefit enough from a second pass to justify ~600 tokens.
//
// Cruise/nudge briefs always skip — quiet days don't need reflection.
//
// Result: ~30-40% reduction in critique calls vs always-on warn+critical.
func (s *LLMChainBriefSynthesiser) shouldReflect(ctx context.Context, sketch domain.DailyBrief, in domain.BriefPromptInput) bool {
	if s.cfg == nil {
		return false
	}
	if !s.cfg.ReflectiveEnabled(ctx) {
		return false
	}
	switch sketch.Severity {
	case domain.InsightSeverityCritical:
		return true
	case domain.InsightSeverityWarn:
		return warnGradeReflectsBenefit(in)
	case domain.InsightSeverityCruise, domain.InsightSeverityNudge:
		return false
	}
	return false
}

// warnGradeReflectsBenefit — Phase R6. Sub-gate for warn severity. Only
// warn signals where the second LLM pass is likely to materially improve
// the brief get critique. Heuristics:
//   - Repeated mock weak topic ≥3: pattern is real; critique can ground
//     the rationale in the count.
//   - Abandoned mocks ≥2: consistency-break warrants careful framing.
//
// Bare warn signals (low focus week, single skipped item × 2) skip —
// they're already easy to phrase well in one pass.
func warnGradeReflectsBenefit(in domain.BriefPromptInput) bool {
	if _, n := repeatedMockWeakTopic(in.Mocks); n >= 3 {
		return true
	}
	if in.MockAbandonedRecent >= 2 {
		return true
	}
	return false
}

// reflect — single-shot critique pass. Reuses the same chain config
// (pinned model / TaskDailyBrief routing) so we don't drift in what
// "coach voice" sounds like. Single attempt: если critic упал, caller
// fall-back'ом возьмёт sketch.
//
// personaOverlay (Phase 4.2) применяется и здесь — иначе critique-stage
// мог бы «выправить» tone обратно к default'у, что особенно заметно для
// strict/sparring персон.
func (s *LLMChainBriefSynthesiser) reflect(
	ctx context.Context,
	in domain.BriefPromptInput,
	sketch domain.DailyBrief,
	sketchRaw string,
	pinnedModel string,
	personaOverlay string,
	variantOverlay string,
) (domain.DailyBrief, error) {
	messages := []llmchain.Message{
		{Role: llmchain.RoleSystem, Content: critiqueSystemPrompt},
	}
	if personaOverlay != "" {
		messages = append(messages, llmchain.Message{Role: llmchain.RoleSystem, Content: personaOverlay})
	}
	if variantOverlay != "" {
		messages = append(messages, llmchain.Message{Role: llmchain.RoleSystem, Content: variantOverlay})
	}
	messages = append(messages, llmchain.Message{
		Role:    llmchain.RoleUser,
		Content: buildBriefCritiqueUserPrompt(in, sketchRaw),
	})
	req := llmchain.Request{
		JSONMode:    true,
		Temperature: 0.3,
		MaxTokens:   700,
		Messages:    messages,
	}
	if pinnedModel != "" {
		req.ModelOverride = pinnedModel
	} else {
		req.Task = llmchain.TaskDailyBrief
	}
	resp, err := s.chain.Chat(ctx, req)
	if err != nil {
		return domain.DailyBrief{}, fmt.Errorf("critique chain: %w", err)
	}
	refined, perr := parseBriefJSON(resp.Content, in)
	if perr != nil {
		return domain.DailyBrief{}, fmt.Errorf("critique parse: %w", perr)
	}
	// Carry over BriefID/GeneratedAt from sketch — critic не должен
	// генерировать новый id (он будет назначен в use case'е).
	refined.BriefID = sketch.BriefID
	refined.GeneratedAt = sketch.GeneratedAt
	return refined, nil
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
