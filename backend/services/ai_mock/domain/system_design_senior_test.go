package domain

import (
	"strings"
	"testing"
	"time"

	"druz9/shared/enums"
)

// ─────────────────────────────────────────────────────────────────────────
// IsSystemDesignSeniorSection — single dispatch helper.
// ─────────────────────────────────────────────────────────────────────────

func TestIsSystemDesignSeniorSection(t *testing.T) {
	t.Parallel()
	if !IsSystemDesignSeniorSection(enums.SectionSystemDesignSenior) {
		t.Error("SectionSystemDesignSenior must be detected")
	}
	for _, s := range []enums.Section{
		enums.SectionSystemDesign, // engineering SD is NOT senior SD
		enums.SectionAlgorithms,
		enums.SectionEnglishHR,
		"",
		"random",
	} {
		if IsSystemDesignSeniorSection(s) {
			t.Errorf("Section(%q) must NOT be flagged as senior SD", s)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// BuildSystemDesignSeniorSystemPrompt
// ─────────────────────────────────────────────────────────────────────────

func TestBuildSystemDesignSeniorSystemPrompt_ContainsRubricDimensions(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	got := BuildSystemDesignSeniorSystemPrompt(s, UserContext{}, CompanyContext{}, 0)

	for _, dim := range []string{"depth", "tradeoffs", "failure_modes", "pragmatism"} {
		if !strings.Contains(got, dim) {
			t.Errorf("prompt missing senior-SD rubric dimension %q", dim)
		}
	}
}

func TestBuildSystemDesignSeniorSystemPrompt_StaffLevelByDefault(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	got := BuildSystemDesignSeniorSystemPrompt(s, UserContext{}, CompanyContext{Level: ""}, 0)

	// Empty company.Level should fall back to staff (not middle).
	if !strings.Contains(got, "staff-level") {
		t.Errorf("blank company.Level must default to staff-level framing; got:\n%s", got)
	}
}

func TestBuildSystemDesignSeniorSystemPrompt_RespectsExplicitCompanyLevel(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	got := BuildSystemDesignSeniorSystemPrompt(s, UserContext{}, CompanyContext{Level: "principal", Name: "Yandex"}, 0)

	if !strings.Contains(got, "principal-level") {
		t.Errorf("explicit company.Level=principal must propagate; got:\n%s", got)
	}
	if !strings.Contains(got, "Yandex") {
		t.Errorf("company.Name must propagate; got:\n%s", got)
	}
}

func TestBuildSystemDesignSeniorSystemPrompt_RendersElapsed(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	got := BuildSystemDesignSeniorSystemPrompt(s, UserContext{}, CompanyContext{}, 12*time.Minute+30*time.Second)

	if !strings.Contains(got, "12m30s") {
		t.Errorf("elapsed time must render; got:\n%s", got)
	}
	if !strings.Contains(got, "of 45m") {
		t.Errorf("duration must render alongside elapsed; got:\n%s", got)
	}
}

func TestBuildSystemDesignSeniorSystemPrompt_DevilsAdvocateModeAdded(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45, DevilsAdvocate: true}
	got := BuildSystemDesignSeniorSystemPrompt(s, UserContext{}, CompanyContext{}, 0)

	if !strings.Contains(got, "Devil's Advocate") {
		t.Errorf("devils_advocate=true must add the adversarial mode block; got:\n%s", got)
	}
}

func TestBuildSystemDesignSeniorSystemPrompt_DoesNotLeakAlgorithmicFraming(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	got := BuildSystemDesignSeniorSystemPrompt(s, UserContext{}, CompanyContext{}, 0)

	// Senior SD has NO concrete task — these phrases would mean the
	// algorithmic-mock prompt leaked through.
	for _, leak := range []string{"solution_hint", "Stress snapshot", "Current code", "Title:"} {
		if strings.Contains(got, leak) {
			t.Errorf("senior SD prompt contains algorithmic-mock fragment %q (should be SD-only):\n%s", leak, got)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// BuildSystemDesignSeniorReportPrompt
// ─────────────────────────────────────────────────────────────────────────

func TestBuildSystemDesignSeniorReportPrompt_RubricKeysMatchOutputSchema(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	got := BuildSystemDesignSeniorReportPrompt(s)

	for _, k := range []string{
		`"depth":`,
		`"tradeoffs":`,
		`"failure_modes":`,
		`"pragmatism":`,
		`"overall_score":`,
		`"strengths":`,
		`"weaknesses":`,
		`"recommendations":`,
	} {
		if !strings.Contains(got, k) {
			t.Errorf("report prompt missing required output key %s", k)
		}
	}
}

func TestBuildSystemDesignSeniorReportPrompt_NoEnglishOrEngineeringRubricKeys(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	got := BuildSystemDesignSeniorReportPrompt(s)

	for _, k := range []string{
		// engineering rubric (BuildReportPrompt)
		`"problem_solving"`, `"code_quality"`, `"stress_handling"`,
		// English HR rubric
		`"clarity":`, `"accuracy":`, `"fluency":`,
	} {
		if strings.Contains(got, k) {
			t.Errorf("senior SD report prompt leaked unrelated rubric key %s", k)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatch: BuildSystemPrompt / BuildReportPrompt route correctly when
// section is senior SD. Mirrors the English HR dispatch tests.
// ─────────────────────────────────────────────────────────────────────────

func TestBuildSystemPrompt_RoutesToSystemDesignSenior(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	algoTask := TaskWithHint{Title: "Design URL shortener", Description: "100k RPS", SolutionHint: "consistent hashing"}

	got := BuildSystemPrompt(s, algoTask, UserContext{}, CompanyContext{}, time.Minute, StressProfile{}, "")

	if !strings.Contains(got, "system design interviewer") {
		t.Errorf("expected senior SD prompt; got:\n%s", got)
	}
	if strings.Contains(got, "Design URL shortener") || strings.Contains(got, "consistent hashing") {
		t.Errorf("dispatcher leaked algorithmic-task fields into senior SD prompt:\n%s", got)
	}
}

func TestBuildReportPrompt_RoutesToSystemDesignSenior(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSystemDesignSenior, DurationMin: 45}
	got := BuildReportPrompt(s, TaskWithHint{}, StressProfile{PausesScore: 99})

	if !strings.Contains(got, `"depth":`) {
		t.Errorf("senior SD report prompt missing rubric:\n%s", got)
	}
	if strings.Contains(got, "stress_analysis: ") || strings.Contains(got, "pauses=99") {
		t.Errorf("dispatcher leaked stress profile into senior SD report:\n%s", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Section.IsTaskBased — gate for skipping task-pick at session creation.
// ─────────────────────────────────────────────────────────────────────────

func TestSection_IsTaskBased(t *testing.T) {
	t.Parallel()
	// Task-based: engineering 5.
	for _, s := range []enums.Section{
		enums.SectionAlgorithms, enums.SectionSQL, enums.SectionGo,
		enums.SectionSystemDesign, enums.SectionBehavioral,
	} {
		if !s.IsTaskBased() {
			t.Errorf("Section(%q) must be task-based", s)
		}
	}
	// Free-form (no task in DB): English HR + senior SD + unknown.
	for _, s := range []enums.Section{
		enums.SectionEnglishHR,
		enums.SectionSystemDesignSenior,
		"",
		"unknown",
	} {
		if s.IsTaskBased() {
			t.Errorf("Section(%q) must NOT be task-based", s)
		}
	}
}
