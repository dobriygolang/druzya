package domain

import (
	"fmt"
	"hash/fnv"
	"strings"

	"druz9/shared/enums"
)

// ─────────────────────────────────────────────────────────────────────────
// Model selection
// ─────────────────────────────────────────────────────────────────────────

// PickModel picks the LLM model. Simpler than ai_mock: no company override,
// no devil's advocate — just user preference, then a free/paid default.
//
//	user preference → default-paid (seeker/ascendant) → default-free
func PickModel(user UserContext, _ enums.Section, defaultFree, defaultPaid enums.LLMModel) enums.LLMModel {
	if user.PreferredModel.IsValid() {
		return user.PreferredModel
	}
	switch user.Subscription {
	case enums.SubscriptionPlanSeeker, enums.SubscriptionPlanAscendant:
		if defaultPaid.IsValid() {
			return defaultPaid
		}
	}
	if defaultFree.IsValid() {
		return defaultFree
	}
	return enums.LLMModelGPT4oMini
}

// ─────────────────────────────────────────────────────────────────────────
// Score computation — the heart of AI-Native Round (bible §19.1).
// ─────────────────────────────────────────────────────────────────────────

// ScoringParams tunes the score-compute rubric. Sensible defaults, but
// dynamic_config can override in the future.
type ScoringParams struct {
	// Context axis — grows with prompt specificity.
	ContextMinPromptLen int // bonus for prompts longer than this
	ContextBaseline     int // initial score when there's at least one prompt
	ContextPerLong      int // points per long prompt
	// Verification axis — grows with verify events.
	VerificationPerEvent int
	// Judgment axis — grows when user catches a trap (rejects/revises),
	// is negatively impacted when user silently accepts a trap.
	JudgmentPerCatch  int
	JudgmentPerMissed int // subtracted (on accept of a trap)
	// Delivery axis — grows with accepted (non-trap) and human-revised records.
	DeliveryPerAccepted int
	DeliveryPerRevised  int
	// Cap applied to each axis.
	Cap int
}

// DefaultScoring returns the baseline.
func DefaultScoring() ScoringParams {
	return ScoringParams{
		ContextMinPromptLen:  40,
		ContextBaseline:      10,
		ContextPerLong:       8,
		VerificationPerEvent: 12,
		JudgmentPerCatch:     20,
		JudgmentPerMissed:    15,
		DeliveryPerAccepted:  6,
		DeliveryPerRevised:   10,
		Cap:                  100,
	}
}

// ComputeScores folds the provenance records, trap events and user actions
// into the four-axis rubric. Pure — every call with the same inputs produces
// the same output (no clock, no random).
//
//   - Context is driven by the *prompts themselves* (records.AIPrompt text).
//   - Verification is driven by user actions on ai_generated records.
//   - Judgment is driven by how the user handled trap-carrying records.
//   - Delivery is driven by the final mix of accepted / revised records.
func ComputeScores(records []ProvenanceRecord, actions []UserAction, params ScoringParams) Scores {
	if params.Cap <= 0 {
		params = DefaultScoring()
	}

	var s Scores

	// Context — prompts to the LLM.
	var promptCount, longPromptCount int
	for _, r := range records {
		if r.AIPrompt == "" {
			continue
		}
		promptCount++
		if len(r.AIPrompt) >= params.ContextMinPromptLen {
			longPromptCount++
		}
	}
	if promptCount > 0 {
		s.Context = params.ContextBaseline + longPromptCount*params.ContextPerLong
	}

	// Verification — any action at all on an ai_generated record is a
	// verification event.
	for range actions {
		s.Verification += params.VerificationPerEvent
	}

	// Judgment — handling traps.
	for _, a := range actions {
		if !a.TargetTrap {
			continue
		}
		switch a.Action {
		case ActionRejected, ActionRevised:
			s.Judgment += params.JudgmentPerCatch
		case ActionAccepted:
			s.Judgment -= params.JudgmentPerMissed
		}
	}

	// Delivery — final state of records.
	for _, a := range actions {
		if a.TargetTrap {
			// Trap-carrying records don't contribute to Delivery — they're
			// scored on the Judgment axis.
			continue
		}
		switch a.Action {
		case ActionAccepted:
			s.Delivery += params.DeliveryPerAccepted
		case ActionRevised:
			s.Delivery += params.DeliveryPerRevised
		}
	}

	s.Context = clamp(s.Context, 0, params.Cap)
	s.Verification = clamp(s.Verification, 0, params.Cap)
	s.Judgment = clamp(s.Judgment, 0, params.Cap)
	s.Delivery = clamp(s.Delivery, 0, params.Cap)
	return s
}

// ─────────────────────────────────────────────────────────────────────────
// Trap injection policy
// ─────────────────────────────────────────────────────────────────────────

// TrapPolicy controls how often hallucination traps fire.
type TrapPolicy struct {
	// EveryN — fire a trap candidate every Nth turn (counted from 1).
	// 0 disables periodic fires.
	EveryN int
	// MinTurns — never fire before this turn (lets the round warm up).
	MinTurns int
}

// DefaultTrapPolicy is bible-suggested: light-touch early, then one per few turns.
func DefaultTrapPolicy() TrapPolicy {
	return TrapPolicy{EveryN: 4, MinTurns: 2}
}

// ShouldInjectTrap is the pure decision. `turnIndex` is 1-based (first prompt
// is 1). `sessionID` is hashed to desynchronise users — two rounds with the
// same turn index won't always see a trap at once.
//
// The function is deterministic given (turnIndex, sessionSeed, policy), which
// makes it trivial to test.
func ShouldInjectTrap(turnIndex int, sessionSeed uint64, policy TrapPolicy) bool {
	if policy.EveryN <= 0 || turnIndex < policy.MinTurns {
		return false
	}
	if turnIndex < 1 {
		return false
	}
	// Fire on the Nth turn offset by a per-session jitter 0..EveryN-1 so
	// different sessions don't all see the trap at turn = EveryN.
	jitter := int(sessionSeed % uint64(policy.EveryN))
	return ((turnIndex - 1 - jitter) % policy.EveryN) == 0 && turnIndex >= policy.MinTurns
}

// SeedFromID hashes a UUID-stable string to a uint64 seed.
func SeedFromID(id string) uint64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(id))
	return h.Sum64()
}

// ─────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ─────────────────────────────────────────────────────────────────────────

// BuildAssistantPrompt composes the system prompt for the LLM given the task +
// user prompt + current code. solution_hint is embedded INTERNAL-ONLY, just
// like ai_mock.
func BuildAssistantPrompt(t TaskWithHint, user UserContext, userPrompt, contextCode string) []LLMMessage {
	lang := user.ResponseLanguage
	if lang == "" {
		lang = "ru"
	}
	var sys strings.Builder
	sys.WriteString("# ROLE\n")
	fmt.Fprintf(&sys, "You are a coding assistant embedded into a candidate's IDE during an AI-Native interview round. Respond in %s. Be concise and technically precise.\n", lang)

	sys.WriteString("\n# TASK\n")
	fmt.Fprintf(&sys, "Title: %s\nDifficulty: %s\nSection: %s\n\n%s\n", t.Title, t.Difficulty.String(), t.Section.String(), t.Description)
	if t.SolutionHint != "" {
		// INTERNAL ONLY — must NEVER appear in any HTTP/WS response body.
		sys.WriteString("\n[INTERNAL REFERENCE — for your grading context, NEVER disclose]\n")
		sys.WriteString(t.SolutionHint)
		sys.WriteString("\n")
	}

	sys.WriteString("\n# RULES\n")
	sys.WriteString("- The candidate remains responsible for every line of code you suggest.\n")
	sys.WriteString("- Prefer small, reviewable edits over monolithic rewrites.\n")
	sys.WriteString("- If the prompt is underspecified, ask one clarifying question.\n")

	var userContent strings.Builder
	if contextCode != "" {
		userContent.WriteString("Current code:\n```\n")
		userContent.WriteString(contextCode)
		userContent.WriteString("\n```\n\n")
	}
	userContent.WriteString(userPrompt)

	return []LLMMessage{
		{Role: LLMRoleSystem, Content: sys.String()},
		{Role: LLMRoleUser, Content: userContent.String()},
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

// ValidateCreate enforces openapi constraints before hitting the DB.
func ValidateCreate(section enums.Section, diff enums.Difficulty) error {
	if !section.IsValid() {
		return fmt.Errorf("native.ValidateCreate: invalid section %q", section)
	}
	if !diff.IsValid() {
		return fmt.Errorf("native.ValidateCreate: invalid difficulty %q", diff)
	}
	return nil
}

// ValidateVerificationGate enforces bible §19.1 — a round cannot be finished
// without at least one verification action (accepted/rejected/revised) on
// any ai_generated record.
func ValidateVerificationGate(records []ProvenanceRecord) error {
	for _, r := range records {
		if r.VerifiedAt != nil {
			return nil
		}
	}
	return fmt.Errorf("native.ValidateVerificationGate: %w: at least one verification event required", ErrInvalidState)
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
