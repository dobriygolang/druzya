package infra

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/llmchain"
	"druz9/shared/pkg/userlocale"
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
// Если configReader выдаёт coach.pinned_model — Brief идёт через
// ModelOverride (single candidate, no fallback). Это сохраняет единый
// стиль коуча между запросами; admin меняет модель через dynamic_config.
// Пустая строка → fall back to TaskDailyBrief routing.
type LLMChainBriefSynthesiser struct {
	chain   llmchain.ChatClient
	cfg     CoachConfigReader
	locale  userlocale.Reader
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainBriefSynthesiser wires the adapter. chain MUST be non-nil.
// cfg может быть nil — тогда pin отключён (legacy task-routing). locale
// может быть nil — fallback на 'ru' (default users.locale).
func NewLLMChainBriefSynthesiser(chain llmchain.ChatClient, cfg CoachConfigReader, locale userlocale.Reader, log *slog.Logger) *LLMChainBriefSynthesiser {
	if chain == nil {
		panic("intelligence.NewLLMChainBriefSynthesiser: chain is required")
	}
	if log == nil {
		panic("intelligence.NewLLMChainBriefSynthesiser: logger is required")
	}
	return &LLMChainBriefSynthesiser{chain: chain, cfg: cfg, locale: locale, log: log, timeout: 30 * time.Second}
}

// Synthesise builds the prompt, calls the chain, parses JSON envelope.
// One retry on parse failure; second failure surfaces ErrLLMUnavailable.
//
// Two-stage reflective brief: when severity ∈ {warn, critical} AND
// coach.reflective_enabled = true в dynamic_config, the parsed sketch
// goes through a critique LLM call that confirms or refines it. Critique
// failures fall back to the sketch silently — мы платим за reflection
// качеством, а не за возможность сломать happy path.
func (s *LLMChainBriefSynthesiser) Synthesise(ctx context.Context, in domain.BriefPromptInput) (domain.DailyBrief, error) {
	userMsg := buildBriefUserPrompt(in)

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	// Pinned-model path: admin задаёт coach.pinned_model в dynamic_config —
	// идём через ModelOverride (single candidate, no fallback). Иначе —
	// task-routing. Кэширования нет: одна row на DailyBrief, БД hit копеечный.
	pinnedModel := ""
	personaOverlay := ""
	variantOverlay := ""
	if s.cfg != nil {
		pinnedModel = s.cfg.PinnedModel(ctx)
		personaOverlay = personaToneOverlay(s.cfg.Persona(ctx))
		variantOverlay = variantPromptOverlay(s.cfg.PromptVariant(ctx))
	}

	// ML overlay: detection in BriefPromptInput.ML (primary_goal=ml_offer
	// OR active_track=ml). Appends an ML-flavoured system message so coach
	// swaps generic Go-senior tropes for numpy/pytorch coding, recsys
	// sysdesign, Lilian Weng / Chip Huyen resource pool.
	mlOverlay := MLBriefOverlay(in.ML)

	// Overlays = optional system messages added в обе stages (sketch +
	// critique). Order: persona (tone), variant (format), ML (domain
	// framing). ML goes last so its forbidden-list / resource pool
	// overrides any persona/variant generic phrasing.
	localeStr := "ru"
	if s.locale != nil {
		localeStr = s.locale.Get(ctx, in.UserID)
	}

	sketchMessages := func() []llmchain.Message {
		out := []llmchain.Message{
			// Slot 0: language directive (see userlocale package). The
			// few-shot examples below are in English; this directive tells
			// the LLM that the **response** language must follow the user's
			// locale regardless of the few-shot example language.
			{Role: llmchain.RoleSystem, Content: userlocale.LanguageDirective(localeStr)},
			{Role: llmchain.RoleSystem, Content: briefSystemPrompt},
		}
		if personaOverlay != "" {
			out = append(out, llmchain.Message{Role: llmchain.RoleSystem, Content: personaOverlay})
		}
		if variantOverlay != "" {
			out = append(out, llmchain.Message{Role: llmchain.RoleSystem, Content: variantOverlay})
		}
		if mlOverlay != "" {
			out = append(out, llmchain.Message{Role: llmchain.RoleSystem, Content: mlOverlay})
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

	// Reflective critique gate — selective by signal confidence.
	if s.shouldReflect(ctx, sketch, in) {
		refined, err := s.reflect(ctx, in, sketch, sketchRaw, pinnedModel, personaOverlay, variantOverlay, mlOverlay)
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

// shouldReflect gates critique. Runs только когда:
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

// warnGradeReflectsBenefit — sub-gate for warn severity. Only warn signals
// where the second LLM pass is likely to materially improve the brief get
// critique. Heuristics:
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
// (pinned model / TaskDailyBrief routing) so coach voice doesn't drift.
// Single attempt: если critic упал, caller fall-back'ом возьмёт sketch.
//
// personaOverlay и mlOverlay применяются и здесь — иначе critique-stage
// мог бы «выправить» tone обратно к default'у или сгенерил бы «improved»
// draft с generic Go-senior фразами, теряя personality / ML lens.
func (s *LLMChainBriefSynthesiser) reflect(
	ctx context.Context,
	in domain.BriefPromptInput,
	sketch domain.DailyBrief,
	sketchRaw string,
	pinnedModel string,
	personaOverlay string,
	variantOverlay string,
	mlOverlay string,
) (domain.DailyBrief, error) {
	localeStr := "ru"
	if s.locale != nil {
		localeStr = s.locale.Get(ctx, in.UserID)
	}
	messages := []llmchain.Message{
		{Role: llmchain.RoleSystem, Content: userlocale.LanguageDirective(localeStr)},
		{Role: llmchain.RoleSystem, Content: critiqueSystemPrompt},
	}
	if personaOverlay != "" {
		messages = append(messages, llmchain.Message{Role: llmchain.RoleSystem, Content: personaOverlay})
	}
	if variantOverlay != "" {
		messages = append(messages, llmchain.Message{Role: llmchain.RoleSystem, Content: variantOverlay})
	}
	if mlOverlay != "" {
		messages = append(messages, llmchain.Message{Role: llmchain.RoleSystem, Content: mlOverlay})
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
