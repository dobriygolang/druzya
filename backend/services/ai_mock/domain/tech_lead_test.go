package domain

import (
	"strings"
	"testing"
	"time"

	"druz9/shared/enums"
)

// ─────────────────────────────────────────────────────────────────────────
// IsTechLeadEMSection — single dispatch helper.
// ─────────────────────────────────────────────────────────────────────────

func TestIsTechLeadEMSection(t *testing.T) {
	t.Parallel()
	if !IsTechLeadEMSection(enums.SectionTechLeadEM) {
		t.Error("SectionTechLeadEM must be detected")
	}
	for _, s := range []enums.Section{
		enums.SectionBehavioral, // engineering behavioral is NOT TL/EM
		enums.SectionAlgorithms,
		enums.SectionEnglishHR,
		enums.SectionSystemDesignSenior,
		"",
		"random",
	} {
		if IsTechLeadEMSection(s) {
			t.Errorf("Section(%q) must NOT be flagged as TL/EM", s)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// BuildTechLeadSystemPrompt
// ─────────────────────────────────────────────────────────────────────────

func TestBuildTechLeadSystemPrompt_ContainsRubricDimensions(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45}
	got := BuildTechLeadSystemPrompt(s, UserContext{}, CompanyContext{}, 0)

	for _, dim := range []string{"structure", "ownership", "impact", "learning"} {
		if !strings.Contains(got, dim) {
			t.Errorf("prompt missing TL/EM rubric dimension %q", dim)
		}
	}
}

func TestBuildTechLeadSystemPrompt_AdaptiveQuestionPool(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45}
	got := BuildTechLeadSystemPrompt(s, UserContext{}, CompanyContext{}, 0)

	// 15-scenario pool — verify the prompt actually carries enough
	// breadth (regression guard against a future trim that drops
	// scenarios below adaptability threshold).
	if !strings.Contains(got, "15 STAR scenarios") {
		t.Errorf("prompt must declare the pool size for the model to pick adaptively; got:\n%s", got)
	}
	// Spot-check a few canonical scenarios — not all 15, but enough
	// that a careless rewrite of the pool fails this test.
	for _, scenario := range []string{
		"underperformer",
		"Tech-debt vs feature",
		"production incident",
	} {
		if !strings.Contains(strings.ToLower(got), strings.ToLower(scenario)) {
			t.Errorf("scenario %q expected in question pool; got:\n%s", scenario, got)
		}
	}
}

func TestBuildTechLeadSystemPrompt_FillsLevelFallback(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45}
	// Empty company.Level should default to tech_lead (covers TL+EM).
	got := BuildTechLeadSystemPrompt(s, UserContext{}, CompanyContext{Level: ""}, 0)
	if !strings.Contains(got, "tech_lead position") {
		t.Errorf("blank company.Level must fall back to tech_lead; got:\n%s", got)
	}
	// Explicit override still respected.
	got2 := BuildTechLeadSystemPrompt(s, UserContext{}, CompanyContext{Level: "engineering_manager", Name: "Yandex"}, 0)
	if !strings.Contains(got2, "engineering_manager position") {
		t.Errorf("explicit company.Level must propagate; got:\n%s", got2)
	}
	if !strings.Contains(got2, "Yandex") {
		t.Errorf("company.Name must propagate; got:\n%s", got2)
	}
}

func TestBuildTechLeadSystemPrompt_DevilsAdvocateModeAdded(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45, DevilsAdvocate: true}
	got := BuildTechLeadSystemPrompt(s, UserContext{}, CompanyContext{}, 0)

	if !strings.Contains(got, "Devil's Advocate") {
		t.Errorf("devils_advocate=true must add the adversarial mode block; got:\n%s", got)
	}
}

func TestBuildTechLeadSystemPrompt_DoesNotLeakAlgorithmicFraming(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45}
	got := BuildTechLeadSystemPrompt(s, UserContext{}, CompanyContext{}, 0)

	for _, leak := range []string{"solution_hint", "Stress snapshot", "Current code", "Title:"} {
		if strings.Contains(got, leak) {
			t.Errorf("TL/EM prompt contains algorithmic-mock fragment %q (should be behavioral-only):\n%s", leak, got)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// BuildTechLeadReportPrompt
// ─────────────────────────────────────────────────────────────────────────

func TestBuildTechLeadReportPrompt_RubricKeysMatchOutputSchema(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45}
	got := BuildTechLeadReportPrompt(s)

	for _, k := range []string{
		`"structure":`,
		`"ownership":`,
		`"impact":`,
		`"learning":`,
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

func TestBuildTechLeadReportPrompt_NoUnrelatedRubricKeys(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45}
	got := BuildTechLeadReportPrompt(s)

	for _, k := range []string{
		// engineering rubric (BuildReportPrompt)
		`"problem_solving"`, `"code_quality"`, `"stress_handling"`,
		// English HR rubric
		`"clarity":`, `"accuracy":`, `"fluency":`,
		// Senior SD rubric
		`"depth":`, `"tradeoffs":`, `"failure_modes":`, `"pragmatism":`,
	} {
		if strings.Contains(got, k) {
			t.Errorf("TL/EM report prompt leaked unrelated rubric key %s", k)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatch via BuildSystemPrompt / BuildReportPrompt — TL/EM section
// must route to the dedicated builder, not engineering or other free-form.
// ─────────────────────────────────────────────────────────────────────────

func TestBuildSystemPrompt_RoutesToTechLead(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45}
	algoTask := TaskWithHint{Title: "Two Sum", Description: "find pair", SolutionHint: "two pointers"}

	got := BuildSystemPrompt(s, algoTask, UserContext{}, CompanyContext{}, time.Minute, StressProfile{}, "")

	if !strings.Contains(got, "hiring panel") {
		t.Errorf("expected TL/EM prompt; got:\n%s", got)
	}
	if strings.Contains(got, "Two Sum") || strings.Contains(got, "two pointers") {
		t.Errorf("dispatcher leaked algorithmic-task fields into TL/EM prompt:\n%s", got)
	}
}

func TestBuildReportPrompt_RoutesToTechLead(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionTechLeadEM, DurationMin: 45}
	got := BuildReportPrompt(s, TaskWithHint{}, StressProfile{PausesScore: 99})

	if !strings.Contains(got, `"structure":`) {
		t.Errorf("TL/EM report prompt missing rubric:\n%s", got)
	}
	if strings.Contains(got, "stress_analysis: ") || strings.Contains(got, "pauses=99") {
		t.Errorf("dispatcher leaked stress profile into TL/EM report:\n%s", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Section.IsTaskBased — confirm TL/EM joins the free-form set.
// (English HR + senior SD coverage already in the SD test file; this
// adds TL/EM without duplicating the engineering loop.)
// ─────────────────────────────────────────────────────────────────────────

func TestSection_IsTaskBased_TechLeadFreeform(t *testing.T) {
	t.Parallel()
	if enums.SectionTechLeadEM.IsTaskBased() {
		t.Errorf("SectionTechLeadEM must NOT be task-based")
	}
}
