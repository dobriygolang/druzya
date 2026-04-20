package domain

import (
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────
// Security: solution_hint lives in the prompt, never in the public DTO.
// This is the single most important test in the domain.
// ─────────────────────────────────────────────────────────────────────────

func TestBuildSystemPrompt_IncludesSolutionHintInPromptButNotInPublicTask(t *testing.T) {
	t.Parallel()
	const secret = "THE-HINT-IS-USE-TWO-POINTERS"
	task := TaskWithHint{
		ID:           uuid.New(),
		Slug:         "two-sum",
		Title:        "Two Sum",
		Description:  "Find pair.",
		Difficulty:   enums.DifficultyMedium,
		Section:      enums.SectionAlgorithms,
		SolutionHint: secret,
	}
	s := Session{
		ID:          uuid.New(),
		Section:     enums.SectionAlgorithms,
		Difficulty:  enums.DifficultyMedium,
		DurationMin: 45,
	}
	user := UserContext{Subscription: enums.SubscriptionPlanFree, ResponseLanguage: "en"}
	comp := CompanyContext{Name: "Yandex", Level: "middle"}

	prompt := BuildSystemPrompt(s, task, user, comp, 0, StressProfile{}, "")

	if !strings.Contains(prompt, secret) {
		t.Fatalf("expected LLM prompt to contain the solution_hint for the model's grading context, got:\n%s", prompt)
	}

	// The client-facing shape MUST NOT expose the hint.
	pub := task.ToPublic()
	// Serialise via JSON just like the ports layer would.
	b, err := json.Marshal(pub)
	if err != nil {
		t.Fatalf("marshal public: %v", err)
	}
	body := string(b)
	if strings.Contains(body, secret) {
		t.Fatalf("TaskPublic JSON leaked solution_hint: %s", body)
	}
	if strings.Contains(strings.ToLower(body), "hint") {
		t.Fatalf("TaskPublic JSON references 'hint' (it should not): %s", body)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Model selection priority — bible §8
// ─────────────────────────────────────────────────────────────────────────

func TestPickModel_Priority(t *testing.T) {
	t.Parallel()
	defFree := enums.LLMModelGPT4oMini
	defPaid := enums.LLMModelGPT4o

	t.Run("user preference wins", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanFree, PreferredModel: enums.LLMModelClaudeSonnet4}
		got := PickModel(u, enums.LLMModelGPT4o, enums.SectionAlgorithms, CompanyContext{OverrideModel: enums.LLMModelGeminiPro}, defFree, defPaid)
		if got != enums.LLMModelClaudeSonnet4 {
			t.Fatalf("user preference should win, got %q", got)
		}
	})

	t.Run("task override over company default", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanFree}
		got := PickModel(u, enums.LLMModelClaudeSonnet4, enums.SectionAlgorithms, CompanyContext{OverrideModel: enums.LLMModelGeminiPro}, defFree, defPaid)
		if got != enums.LLMModelClaudeSonnet4 {
			t.Fatalf("task override should beat company, got %q", got)
		}
	})

	t.Run("company override over defaults", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanFree}
		got := PickModel(u, "", enums.SectionAlgorithms, CompanyContext{OverrideModel: enums.LLMModelGeminiPro}, defFree, defPaid)
		if got != enums.LLMModelGeminiPro {
			t.Fatalf("company override should win over default, got %q", got)
		}
	})

	t.Run("free plan → defaultFree", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanFree}
		got := PickModel(u, "", enums.SectionAlgorithms, CompanyContext{}, defFree, defPaid)
		if got != defFree {
			t.Fatalf("free plan should yield defaultFree %q, got %q", defFree, got)
		}
	})

	t.Run("paid plan → defaultPaid", func(t *testing.T) {
		u := UserContext{Subscription: enums.SubscriptionPlanSeeker}
		got := PickModel(u, "", enums.SectionAlgorithms, CompanyContext{}, defFree, defPaid)
		if got != defPaid {
			t.Fatalf("seeker plan should yield defaultPaid %q, got %q", defPaid, got)
		}
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Stress scoring at boundaries
// ─────────────────────────────────────────────────────────────────────────

func TestStressScoring_CappedAt100(t *testing.T) {
	t.Parallel()
	params := DefaultStressScoring()
	prior := StressProfile{}

	// Feed 30 qualifying pauses — score would be 300 but must cap at 100.
	evs := make([]EditorEvent, 0, 30)
	for i := 0; i < 30; i++ {
		evs = append(evs, EditorEvent{Type: EditorEventPause, DurationMs: 130_000})
	}
	got := ApplyStressEvents(prior, evs, params)
	if got.PausesScore != 100 {
		t.Fatalf("expected pauses_score=100 (capped), got %d", got.PausesScore)
	}

	// Below-threshold pauses should NOT increment.
	got2 := ApplyStressEvents(StressProfile{}, []EditorEvent{{Type: EditorEventPause, DurationMs: 1000}}, params)
	if got2.PausesScore != 0 {
		t.Fatalf("short pause must not score, got %d", got2.PausesScore)
	}

	// Backspace & chaos arithmetic.
	got3 := ApplyStressEvents(StressProfile{}, []EditorEvent{
		{Type: EditorEventBackspaceBurst},
		{Type: EditorEventBackspaceBurst},
		{Type: EditorEventChaoticEdit},
		{Type: EditorEventPasteAttempt},
		{Type: EditorEventPasteAttempt},
	}, params)
	if got3.BackspaceScore != 10 {
		t.Errorf("backspace expected 10, got %d", got3.BackspaceScore)
	}
	if got3.ChaosScore != 8 {
		t.Errorf("chaos expected 8, got %d", got3.ChaosScore)
	}
	if got3.PasteAttempts != 2 {
		t.Errorf("paste_attempts expected 2, got %d", got3.PasteAttempts)
	}
}

func TestDetectStressBoundaries_50And80(t *testing.T) {
	t.Parallel()
	prior := StressProfile{PausesScore: 49, BackspaceScore: 79, ChaosScore: 10}
	next := StressProfile{PausesScore: 55, BackspaceScore: 85, ChaosScore: 10}

	crossings := DetectStressBoundaries(prior, next)
	// pauses: 49→55 crosses 50
	// backspace: 79→85 crosses 80
	// chaos: 10→10 no crossing
	if len(crossings) != 2 {
		t.Fatalf("expected 2 crossings, got %d: %+v", len(crossings), crossings)
	}

	// No crossings when already above threshold on both ends.
	prior2 := StressProfile{PausesScore: 55}
	next2 := StressProfile{PausesScore: 60}
	if got := DetectStressBoundaries(prior2, next2); len(got) != 0 {
		t.Fatalf("no new crossings expected, got %+v", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Intervention watchdog
// ─────────────────────────────────────────────────────────────────────────

func TestInterventionWatch_ResetsOnPoke(t *testing.T) {
	t.Parallel()
	var fired int32
	w := NewInterventionWatch(50*time.Millisecond, func() { atomic.AddInt32(&fired, 1) })
	defer w.Stop()

	w.Poke()
	// Repeatedly reset before the deadline.
	for i := 0; i < 5; i++ {
		time.Sleep(20 * time.Millisecond)
		w.Poke()
	}
	// At this point ~100ms have elapsed but the watchdog has kept being reset.
	if atomic.LoadInt32(&fired) != 0 {
		t.Fatalf("expected 0 fires before timeout elapses, got %d", fired)
	}

	// Let it fire this time.
	time.Sleep(100 * time.Millisecond)
	if atomic.LoadInt32(&fired) == 0 {
		t.Fatalf("expected watchdog to fire once after idle")
	}
}

func TestInterventionWatch_StopPreventsFire(t *testing.T) {
	t.Parallel()
	var fired int32
	w := NewInterventionWatch(20*time.Millisecond, func() { atomic.AddInt32(&fired, 1) })
	w.Poke()
	w.Stop()
	time.Sleep(50 * time.Millisecond)
	if atomic.LoadInt32(&fired) != 0 {
		t.Fatalf("Stop must prevent fire; got %d", fired)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

func TestValidateCreate(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	if err := ValidateCreate(id, enums.SectionAlgorithms, enums.DifficultyEasy, 45); err != nil {
		t.Fatalf("happy path: %v", err)
	}
	if err := ValidateCreate(id, "bogus", enums.DifficultyEasy, 45); err == nil {
		t.Fatal("bad section should fail")
	}
	if err := ValidateCreate(id, enums.SectionAlgorithms, enums.DifficultyEasy, 10); err == nil {
		t.Fatal("too-short duration should fail")
	}
	if err := ValidateCreate(id, enums.SectionAlgorithms, enums.DifficultyEasy, 200); err == nil {
		t.Fatal("too-long duration should fail")
	}
	// 0 is allowed — it means "use server default".
	if err := ValidateCreate(id, enums.SectionAlgorithms, enums.DifficultyEasy, 0); err != nil {
		t.Fatalf("duration=0 (use default) should be OK, got %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ToLLMMessages
// ─────────────────────────────────────────────────────────────────────────

func TestToLLMMessages_TrimsToKeep(t *testing.T) {
	t.Parallel()
	msgs := []Message{
		{Role: enums.MessageRoleUser, Content: "1"},
		{Role: enums.MessageRoleAssistant, Content: "2"},
		{Role: enums.MessageRoleUser, Content: "3"},
		{Role: enums.MessageRoleAssistant, Content: "4"},
	}
	got := ToLLMMessages(msgs, 2)
	if len(got) != 2 {
		t.Fatalf("expected 2, got %d", len(got))
	}
	if got[0].Content != "3" || got[1].Content != "4" {
		t.Fatalf("expected last two messages, got %+v", got)
	}
	if got[1].Role != LLMRoleAssistant {
		t.Fatalf("role mapping broken, got %v", got[1].Role)
	}
}

func TestBuildReportPrompt_EmbedsHintForGrader(t *testing.T) {
	t.Parallel()
	const secret = "TRICK-IS-MONOTONIC-STACK"
	t_ := TaskWithHint{Title: "T", Description: "D", SolutionHint: secret}
	s := Session{Section: enums.SectionAlgorithms, Difficulty: enums.DifficultyHard, DurationMin: 60}
	out := BuildReportPrompt(s, t_, StressProfile{})
	if !strings.Contains(out, secret) {
		t.Fatalf("grader prompt must include hint for accurate scoring")
	}
	if !strings.Contains(out, "overall_score") {
		t.Fatalf("grader prompt must specify JSON schema")
	}
}
