package domain

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"druz9/shared/enums"
)

// ─────────────────────────────────────────────────────────────────────────
// Model selection
// ─────────────────────────────────────────────────────────────────────────

// PickModel picks the LLM model according to bible §8 priority:
//
//	user preference → task override → section override → company override → default
//
// The task override is passed via `taskModel` (empty = no override). Section
// override is currently a lookup; extendable via dynamic_config later. Company
// override is carried on CompanyContext.OverrideModel.
//
// defaultFree / defaultPaid come from cfg.LLM — free-tier users always land
// on DefaultFree, everyone else on DefaultPaid.
func PickModel(user UserContext, taskModel enums.LLMModel, section enums.Section, company CompanyContext, defaultFree, defaultPaid enums.LLMModel) enums.LLMModel {
	// 1. User preference (if valid).
	if user.PreferredModel.IsValid() {
		return user.PreferredModel
	}
	// 2. Task override.
	if taskModel.IsValid() {
		return taskModel
	}
	// 3. Section override. Currently empty — future hook. Keep the switch so
	//    we can audit it via `exhaustive`.
	switch section {
	case enums.SectionAlgorithms, enums.SectionSQL, enums.SectionGo,
		enums.SectionSystemDesign, enums.SectionBehavioral:
		// No per-section overrides yet. Intentional no-op.
	}
	// 4. Company override.
	if company.OverrideModel.IsValid() {
		return company.OverrideModel
	}
	// 5. Default by subscription.
	switch user.Subscription {
	case enums.SubscriptionPlanSeeker, enums.SubscriptionPlanAscendant:
		if defaultPaid.IsValid() {
			return defaultPaid
		}
	case enums.SubscriptionPlanFree:
		// fallthrough to free default below
	}
	if defaultFree.IsValid() {
		return defaultFree
	}
	// Last resort: never return an invalid model.
	return enums.LLMModelGPT4oMini
}

// ─────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────

// BuildSystemPrompt assembles the 4-block interviewer prompt (bible §8).
//
// IMPORTANT: solution_hint is embedded verbatim into block 2. This prompt is
// fed to the LLM — it MUST NEVER be persisted into mock_messages as a
// user/assistant message or logged.
func BuildSystemPrompt(s Session, t TaskWithHint, user UserContext, company CompanyContext, elapsed time.Duration, stress StressProfile, currentCode string) string {
	var b strings.Builder

	lang := user.ResponseLanguage
	if lang == "" {
		lang = "ru"
	}
	companyName := company.Name
	if companyName == "" {
		companyName = "target company"
	}
	level := company.Level
	if level == "" {
		level = "middle"
	}

	// Block 1 — interviewer role.
	b.WriteString("# ROLE\n")
	fmt.Fprintf(&b, "You are a senior interviewer at %s conducting a %s-level %s interview. ", companyName, level, s.Section.String())
	fmt.Fprintf(&b, "Respond in %s. Ask questions, probe deeply, never give away the solution.\n", lang)
	if s.DevilsAdvocate {
		b.WriteString("MODE: Devil's Advocate. You are an adversarial interviewer who pushes back hard on every statement, challenges assumptions, and forces the candidate to defend every choice.\n")
	}
	if s.PairedUserID != nil {
		b.WriteString("MODE: Paired. A second candidate is working on the same problem in a coordinated session. STUB: cross-session coordination not yet wired; keep the interview consistent per-candidate.\n")
	}

	// Block 2 — task + criteria + solution_hint (PRIVATE).
	b.WriteString("\n# TASK\n")
	fmt.Fprintf(&b, "Title: %s\nDifficulty: %s\n\n%s\n", t.Title, t.Difficulty.String(), t.Description)
	if t.SolutionHint != "" {
		// INTERNAL ONLY — this must NOT appear in any HTTP/WS response.
		b.WriteString("\n[INTERNAL REFERENCE — for your grading only, NEVER disclose or paraphrase to the candidate]\n")
		b.WriteString(t.SolutionHint)
		b.WriteString("\n")
	}

	// Block 3 — current code + elapsed + stress snapshot.
	b.WriteString("\n# STATE\n")
	fmt.Fprintf(&b, "Elapsed: %s of %dm.\n", elapsed.Truncate(time.Second), s.DurationMin)
	fmt.Fprintf(&b, "Stress snapshot: pauses=%d backspace=%d chaos=%d paste=%d.\n",
		stress.PausesScore, stress.BackspaceScore, stress.ChaosScore, stress.PasteAttempts)
	if currentCode != "" {
		b.WriteString("Current code:\n```\n")
		b.WriteString(currentCode)
		b.WriteString("\n```\n")
	}

	// Block 4 — rules.
	b.WriteString("\n# RULES\n")
	b.WriteString("- If the candidate is silent for more than 2 minutes, nudge with a leading question. Never give the solution.\n")
	b.WriteString("- Record every mistake internally; grade them at the end.\n")
	b.WriteString("- Keep answers concise. One interview-style message at a time.\n")
	b.WriteString("- If the candidate pastes a large block verbatim, probe: ask them to walk through it line by line.\n")

	return b.String()
}

// BuildReportPrompt assembles the specialised final-report system prompt. The
// LLM is asked to return JSON matching ReportDraft; a strict schema is listed
// inside the prompt.
func BuildReportPrompt(s Session, t TaskWithHint, stress StressProfile) string {
	var b strings.Builder
	b.WriteString("# ROLE\n")
	b.WriteString("You are the grader for a mock interview that just finished. Produce an objective assessment.\n\n")

	b.WriteString("# TASK CONTEXT\n")
	fmt.Fprintf(&b, "Section: %s | Difficulty: %s | Duration: %dm\n", s.Section, s.Difficulty, s.DurationMin)
	fmt.Fprintf(&b, "Title: %s\n%s\n", t.Title, t.Description)
	if t.SolutionHint != "" {
		// INTERNAL ONLY — same rule as BuildSystemPrompt.
		b.WriteString("\n[INTERNAL REFERENCE — grading only]\n")
		b.WriteString(t.SolutionHint)
		b.WriteString("\n")
	}

	fmt.Fprintf(&b, "\n# STRESS PROFILE\npauses=%d backspace=%d chaos=%d paste_attempts=%d\n",
		stress.PausesScore, stress.BackspaceScore, stress.ChaosScore, stress.PasteAttempts)

	b.WriteString(`
# OUTPUT
Return a single JSON object (no markdown fencing, no commentary) with this exact shape:
{
  "overall_score": <int 0..100>,
  "sections": {
    "problem_solving": {"score": <int>, "comment": "<string>"},
    "code_quality":    {"score": <int>, "comment": "<string>"},
    "communication":   {"score": <int>, "comment": "<string>"},
    "stress_handling": {"score": <int>, "comment": "<string>"}
  },
  "strengths": ["..."],
  "weaknesses": ["..."],
  "recommendations": [
    {"title": "...", "description": "...", "action_kind": "start_mock|solve_task|listen_podcast|open_atlas|open_arena", "action_ref": ""}
  ],
  "stress_analysis": "<string>"
}
`)
	return b.String()
}

// ─────────────────────────────────────────────────────────────────────────
// Stress scoring
// ─────────────────────────────────────────────────────────────────────────

// StressScoringParams are tunable coefficients (future dynamic_config hook).
// Defaults encoded from the bible spec.
type StressScoringParams struct {
	PauseThresholdMs int64 // event is counted only if DurationMs exceeds this
	PausePoints      int   // per pause
	BackspacePoints  int   // per backspace burst
	ChaosPoints      int   // per chaotic edit
	DimensionCap     int   // max value per score dimension (0..100)
}

// DefaultStressScoring returns the baseline spec.
//
// STUB-tunable: wire up dynamic_config reload at startup.
func DefaultStressScoring() StressScoringParams {
	return StressScoringParams{
		PauseThresholdMs: 120_000,
		PausePoints:      10,
		BackspacePoints:  5,
		ChaosPoints:      8,
		DimensionCap:     100,
	}
}

// ApplyStressEvents folds a batch of editor events into the prior profile and
// returns the new profile. Pure — all mutation happens on a copy.
func ApplyStressEvents(prior StressProfile, events []EditorEvent, params StressScoringParams) StressProfile {
	p := prior
	cap := params.DimensionCap
	if cap <= 0 {
		cap = 100
	}
	for _, e := range events {
		switch e.Type {
		case EditorEventPause:
			if e.DurationMs < params.PauseThresholdMs {
				continue
			}
			p.PausesScore = clampInt(p.PausesScore+params.PausePoints, 0, cap)
		case EditorEventBackspaceBurst:
			p.BackspaceScore = clampInt(p.BackspaceScore+params.BackspacePoints, 0, cap)
		case EditorEventChaoticEdit:
			p.ChaosScore = clampInt(p.ChaosScore+params.ChaosPoints, 0, cap)
		case EditorEventPasteAttempt:
			p.PasteAttempts++
		case EditorEventIdle:
			// Idle on its own doesn't bump any score — it's a UI hint.
		default:
			// Unknown: ignore.
		}
	}
	return p
}

// StressBoundaryCrossings reports boundary crossings (50, 80) between two
// profiles. Each crossing names the dimension and the threshold. Used to emit
// debounced `stress_update` WS events.
type StressBoundaryCrossings []StressCrossing

// StressCrossing is one dimension crossing a threshold upward.
type StressCrossing struct {
	Dimension string
	Threshold int
	Value     int
}

// DetectStressBoundaries returns the (50, 80) upward crossings between prior
// and next.
func DetectStressBoundaries(prior, next StressProfile) StressBoundaryCrossings {
	out := StressBoundaryCrossings{}
	check := func(dim string, a, b int) {
		for _, t := range []int{50, 80} {
			if a < t && b >= t {
				out = append(out, StressCrossing{Dimension: dim, Threshold: t, Value: b})
			}
		}
	}
	check("pauses", prior.PausesScore, next.PausesScore)
	check("backspace", prior.BackspaceScore, next.BackspaceScore)
	check("chaos", prior.ChaosScore, next.ChaosScore)
	return out
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ─────────────────────────────────────────────────────────────────────────
// Intervention watchdog
// ─────────────────────────────────────────────────────────────────────────

// InterventionWatch is a per-session watchdog that fires an intervention
// callback after `timeout` of silence. It is RESET on every user action via
// Poke. Stop releases its goroutine.
//
// Concurrency: Poke/Stop are safe from any goroutine. The fire callback runs
// on the watchdog's own goroutine; it should be cheap and non-blocking.
type InterventionWatch struct {
	timeout time.Duration
	fire    func()
	mu      sync.Mutex
	timer   *time.Timer
	stopped bool
}

// NewInterventionWatch constructs a stopped watch. Call Poke to start the
// first countdown.
func NewInterventionWatch(timeout time.Duration, fire func()) *InterventionWatch {
	return &InterventionWatch{timeout: timeout, fire: fire}
}

// Poke resets the countdown. If already stopped, does nothing.
func (w *InterventionWatch) Poke() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.stopped {
		return
	}
	if w.timer != nil {
		w.timer.Stop()
	}
	w.timer = time.AfterFunc(w.timeout, func() {
		// Re-check stopped at fire time; avoids a race where Stop ran
		// concurrently with the timer about to fire.
		w.mu.Lock()
		if w.stopped {
			w.mu.Unlock()
			return
		}
		w.mu.Unlock()
		w.fire()
	})
}

// Stop releases the timer. Subsequent Poke calls are no-ops.
func (w *InterventionWatch) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.stopped = true
	if w.timer != nil {
		w.timer.Stop()
		w.timer = nil
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────

// ToLLMMessages maps DB messages into the provider-agnostic chat format.
// Trims to the last `keep` messages (system prompt is added separately).
func ToLLMMessages(msgs []Message, keep int) []LLMMessage {
	if keep > 0 && len(msgs) > keep {
		msgs = msgs[len(msgs)-keep:]
	}
	out := make([]LLMMessage, 0, len(msgs))
	for _, m := range msgs {
		role := LLMRoleUser
		switch m.Role {
		case enums.MessageRoleSystem:
			role = LLMRoleSystem
		case enums.MessageRoleAssistant:
			role = LLMRoleAssistant
		case enums.MessageRoleUser:
			role = LLMRoleUser
		}
		out = append(out, LLMMessage{Role: role, Content: m.Content})
	}
	return out
}

// ValidateCreate enforces the openapi constraints before we hit the DB.
func ValidateCreate(companyID [16]byte, section enums.Section, diff enums.Difficulty, durationMin int) error {
	if !section.IsValid() {
		return fmt.Errorf("mock.ValidateCreate: invalid section %q", section)
	}
	if !diff.IsValid() {
		return fmt.Errorf("mock.ValidateCreate: invalid difficulty %q", diff)
	}
	if durationMin != 0 && (durationMin < 15 || durationMin > 120) {
		return fmt.Errorf("mock.ValidateCreate: duration_min out of range [15..120]: %d", durationMin)
	}
	return nil
}

// ContextDeadlineOK tests whether ctx is still alive; small wrapper used by
// streaming loops.
func ContextDeadlineOK(ctx context.Context) bool {
	return ctx.Err() == nil
}
