package domain

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────
// Security: solution_hint must never leak through TaskPublic.
// ─────────────────────────────────────────────────────────────────────────

func TestBuildAssistantPrompt_EmbedsHint_ButPublicTaskDropsIt(t *testing.T) {
	t.Parallel()
	const secret = "TRICK-MONOTONIC-STACK"
	task := TaskWithHint{
		ID:           uuid.New(),
		Slug:         "largest-rect",
		Title:        "Largest Rectangle",
		Description:  "...",
		Difficulty:   enums.DifficultyHard,
		Section:      enums.SectionAlgorithms,
		SolutionHint: secret,
	}
	msgs := BuildAssistantPrompt(task, UserContext{ResponseLanguage: "en"}, "write a stack-based approach", "")
	if len(msgs) != 2 {
		t.Fatalf("expected system+user messages, got %d", len(msgs))
	}
	if !strings.Contains(msgs[0].Content, secret) {
		t.Fatalf("system prompt must embed the hint (LLM-only), got:\n%s", msgs[0].Content)
	}

	b, err := json.Marshal(task.ToPublic())
	if err != nil {
		t.Fatalf("marshal public task: %v", err)
	}
	if strings.Contains(string(b), secret) {
		t.Fatalf("public task JSON leaked solution_hint: %s", b)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Model selection
// ─────────────────────────────────────────────────────────────────────────

func TestPickModel_Priority(t *testing.T) {
	t.Parallel()
	defFree := enums.LLMModelGPT4oMini
	defPaid := enums.LLMModelGPT4o

	t.Run("user preference wins", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanFree, PreferredModel: enums.LLMModelClaudeSonnet4}
		got := PickModel(u, enums.SectionAlgorithms, defFree, defPaid)
		if got != enums.LLMModelClaudeSonnet4 {
			t.Fatalf("user preference should win, got %q", got)
		}
	})
	t.Run("free → defaultFree", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanFree}
		got := PickModel(u, enums.SectionAlgorithms, defFree, defPaid)
		if got != defFree {
			t.Fatalf("free plan should yield defaultFree %q, got %q", defFree, got)
		}
	})
	t.Run("paid → defaultPaid", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanSeeker}
		got := PickModel(u, enums.SectionAlgorithms, defFree, defPaid)
		if got != defPaid {
			t.Fatalf("seeker plan should yield defaultPaid %q, got %q", defPaid, got)
		}
	})
	t.Run("fallback when both defaults empty", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanFree}
		got := PickModel(u, enums.SectionAlgorithms, "", "")
		if got != enums.LLMModelGPT4oMini {
			t.Fatalf("expected gpt-4o-mini fallback, got %q", got)
		}
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Score computation
// ─────────────────────────────────────────────────────────────────────────

func TestComputeScores_BaselineZero(t *testing.T) {
	t.Parallel()
	got := ComputeScores(nil, nil, DefaultScoring())
	if got != (Scores{}) {
		t.Fatalf("expected zero scores for empty inputs, got %+v", got)
	}
}

func TestComputeScores_ContextFromPromptLength(t *testing.T) {
	t.Parallel()
	params := DefaultScoring()
	records := []ProvenanceRecord{
		{AIPrompt: "short"},
		{AIPrompt: strings.Repeat("a", params.ContextMinPromptLen+1)},
		{AIPrompt: strings.Repeat("b", params.ContextMinPromptLen+1)},
	}
	got := ComputeScores(records, nil, params)
	// baseline=10 + 2 long × 8 = 26
	if got.Context != params.ContextBaseline+2*params.ContextPerLong {
		t.Fatalf("context expected %d, got %d", params.ContextBaseline+2*params.ContextPerLong, got.Context)
	}
}

func TestComputeScores_JudgmentCatchesAndMisses(t *testing.T) {
	t.Parallel()
	params := DefaultScoring()
	// One trap caught via revise → +catch. One trap accepted → -miss.
	actions := []UserAction{
		{Action: ActionRevised, TargetTrap: true},
		{Action: ActionAccepted, TargetTrap: true},
		{Action: ActionAccepted, TargetTrap: false}, // non-trap accepted contributes to Delivery, not Judgment
	}
	got := ComputeScores(nil, actions, params)
	if got.Judgment != clamp(params.JudgmentPerCatch-params.JudgmentPerMissed, 0, params.Cap) {
		t.Fatalf("judgment expected %d, got %d", params.JudgmentPerCatch-params.JudgmentPerMissed, got.Judgment)
	}
	// Verification = one event per action, capped.
	if got.Verification != clamp(len(actions)*params.VerificationPerEvent, 0, params.Cap) {
		t.Fatalf("verification expected %d, got %d", len(actions)*params.VerificationPerEvent, got.Verification)
	}
	// Delivery: only the non-trap accepted record counts.
	if got.Delivery != params.DeliveryPerAccepted {
		t.Fatalf("delivery expected %d, got %d", params.DeliveryPerAccepted, got.Delivery)
	}
}

func TestComputeScores_CapsAt100(t *testing.T) {
	t.Parallel()
	params := DefaultScoring()
	// 30 trap catches would sum to 600 — must clamp to 100.
	actions := make([]UserAction, 0, 30)
	for i := 0; i < 30; i++ {
		actions = append(actions, UserAction{Action: ActionRejected, TargetTrap: true})
	}
	got := ComputeScores(nil, actions, params)
	if got.Judgment != params.Cap {
		t.Fatalf("judgment must cap at %d, got %d", params.Cap, got.Judgment)
	}
	if got.Verification != params.Cap {
		t.Fatalf("verification must cap at %d, got %d", params.Cap, got.Verification)
	}
}

func TestComputeScores_JudgmentCannotGoNegative(t *testing.T) {
	t.Parallel()
	params := DefaultScoring()
	actions := []UserAction{
		{Action: ActionAccepted, TargetTrap: true},
		{Action: ActionAccepted, TargetTrap: true},
	}
	got := ComputeScores(nil, actions, params)
	if got.Judgment != 0 {
		t.Fatalf("judgment must clamp at 0, got %d", got.Judgment)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Trap injection policy
// ─────────────────────────────────────────────────────────────────────────

func TestShouldInjectTrap_PolicyDisabled(t *testing.T) {
	t.Parallel()
	if ShouldInjectTrap(5, 0, TrapPolicy{EveryN: 0}) {
		t.Fatalf("EveryN=0 must disable injection")
	}
}

func TestShouldInjectTrap_HonorsMinTurns(t *testing.T) {
	t.Parallel()
	p := TrapPolicy{EveryN: 2, MinTurns: 3}
	for i := 1; i < 3; i++ {
		if ShouldInjectTrap(i, 0, p) {
			t.Fatalf("must not inject before MinTurns (i=%d)", i)
		}
	}
}

func TestShouldInjectTrap_Deterministic(t *testing.T) {
	t.Parallel()
	p := TrapPolicy{EveryN: 4, MinTurns: 1}
	// With seed=0 jitter=0, fires at 1,5,9...
	expect := map[int]bool{1: true, 2: false, 3: false, 4: false, 5: true, 6: false}
	for turn, want := range expect {
		got := ShouldInjectTrap(turn, 0, p)
		if got != want {
			t.Fatalf("seed=0 turn=%d want %v got %v", turn, want, got)
		}
	}
}

func TestShouldInjectTrap_RateOverManyTurns(t *testing.T) {
	t.Parallel()
	p := TrapPolicy{EveryN: 5, MinTurns: 1}
	fires := 0
	turns := 100
	for i := 1; i <= turns; i++ {
		if ShouldInjectTrap(i, SeedFromID("sess-xyz"), p) {
			fires++
		}
	}
	// Expected ~turns/EveryN = 20 fires, allow +/-2 for jitter boundary.
	if fires < 18 || fires > 22 {
		t.Fatalf("unexpected fire count over %d turns: %d", turns, fires)
	}
}

func TestSeedFromID_Stable(t *testing.T) {
	t.Parallel()
	a := SeedFromID("abc")
	b := SeedFromID("abc")
	c := SeedFromID("abd")
	if a != b {
		t.Fatalf("seed must be deterministic: %d vs %d", a, b)
	}
	if a == c {
		t.Fatalf("different inputs should (overwhelmingly) give different seeds")
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

func TestValidateCreate(t *testing.T) {
	t.Parallel()
	if err := ValidateCreate(enums.SectionAlgorithms, enums.DifficultyEasy); err != nil {
		t.Fatalf("happy path: %v", err)
	}
	if err := ValidateCreate("bogus", enums.DifficultyEasy); err == nil {
		t.Fatal("bad section should fail")
	}
	if err := ValidateCreate(enums.SectionAlgorithms, "bogus"); err == nil {
		t.Fatal("bad difficulty should fail")
	}
}

func TestValidateVerificationGate(t *testing.T) {
	t.Parallel()
	if err := ValidateVerificationGate(nil); err == nil {
		t.Fatal("empty records must fail the gate")
	} else if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("expected ErrInvalidState, got %v", err)
	}
	now := time.Now()
	records := []ProvenanceRecord{{}, {VerifiedAt: &now}}
	if err := ValidateVerificationGate(records); err != nil {
		t.Fatalf("one verified record should pass: %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ActionKind IsValid
// ─────────────────────────────────────────────────────────────────────────

func TestActionKind_IsValid(t *testing.T) {
	t.Parallel()
	for _, a := range []ActionKind{ActionAccepted, ActionRejected, ActionRevised} {
		if !a.IsValid() {
			t.Fatalf("%q should be valid", a)
		}
	}
	if ActionKind("bogus").IsValid() {
		t.Fatal("bogus action should be invalid")
	}
}
