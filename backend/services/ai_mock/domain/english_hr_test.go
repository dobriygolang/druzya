package domain

import (
	"strings"
	"testing"
	"time"

	"druz9/shared/enums"
)

// ─────────────────────────────────────────────────────────────────────────
// IsEnglishHRSection — single dispatch helper. Cheap, but every branching
// caller relies on it; a regression here mis-routes the entire round.
// ─────────────────────────────────────────────────────────────────────────

func TestIsEnglishHRSection(t *testing.T) {
	t.Parallel()
	if !IsEnglishHRSection(enums.SectionEnglishHR) {
		t.Error("SectionEnglishHR must be detected")
	}
	for _, s := range []enums.Section{
		enums.SectionAlgorithms,
		enums.SectionSQL,
		enums.SectionGo,
		enums.SectionSystemDesign,
		enums.SectionBehavioral,
		"",
		"random",
	} {
		if IsEnglishHRSection(s) {
			t.Errorf("Section(%q) must NOT be flagged as English HR", s)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// BuildEnglishHRSystemPrompt
// ─────────────────────────────────────────────────────────────────────────

func TestBuildEnglishHRSystemPrompt_ContainsRubricDimensions(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	got := BuildEnglishHRSystemPrompt(s, UserContext{}, CompanyContext{}, 5*time.Minute)

	for _, dim := range []string{"clarity", "accuracy", "range", "fluency"} {
		if !strings.Contains(got, dim) {
			t.Errorf("prompt missing rubric dimension %q", dim)
		}
	}
}

func TestBuildEnglishHRSystemPrompt_ForcesEnglishOnly(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	got := BuildEnglishHRSystemPrompt(s, UserContext{ResponseLanguage: "ru"}, CompanyContext{}, 0)

	if !strings.Contains(strings.ToLower(got), "english only") {
		t.Errorf("prompt must explicitly enforce English only, got:\n%s", got)
	}
	// Russian preference should be acknowledged but overridden, not honored.
	if !strings.Contains(got, "overrides to English") {
		t.Errorf("prompt must override the candidate's language preference, got:\n%s", got)
	}
}

func TestBuildEnglishHRSystemPrompt_FillsCompanyFallback(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	got := BuildEnglishHRSystemPrompt(s, UserContext{}, CompanyContext{Name: ""}, 0)

	if !strings.Contains(got, "an unnamed mid-sized tech company") {
		t.Errorf("empty company.Name must fall back to a neutral anchor; got:\n%s", got)
	}
}

func TestBuildEnglishHRSystemPrompt_RendersElapsed(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 25}
	got := BuildEnglishHRSystemPrompt(s, UserContext{}, CompanyContext{Name: "Yandex"}, 7*time.Minute+30*time.Second)

	if !strings.Contains(got, "7m30s") {
		t.Errorf("elapsed time must render in the STATE block, got:\n%s", got)
	}
	if !strings.Contains(got, "of 25m") {
		t.Errorf("session duration must render alongside elapsed; got:\n%s", got)
	}
	if !strings.Contains(got, "Yandex") {
		t.Errorf("company name must render in ROLE block; got:\n%s", got)
	}
}

func TestBuildEnglishHRSystemPrompt_DoesNotLeakAlgorithmicFraming(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	got := BuildEnglishHRSystemPrompt(s, UserContext{}, CompanyContext{Name: "Acme"}, 0)

	// Engineering-mock leakage symptoms — these phrases appear in the
	// algo prompt but make no sense in HR.
	for _, leak := range []string{"solution_hint", "Stress snapshot", "Current code"} {
		if strings.Contains(got, leak) {
			t.Errorf("English HR prompt contains algorithmic-mock fragment %q (should be HR-only):\n%s", leak, got)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// BuildEnglishHRReportPrompt
// ─────────────────────────────────────────────────────────────────────────

func TestBuildEnglishHRReportPrompt_RubricKeysMatchOutputSchema(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	got := BuildEnglishHRReportPrompt(s)

	for _, k := range []string{
		`"clarity":`,
		`"accuracy":`,
		`"range":`,
		`"fluency":`,
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

func TestBuildEnglishHRReportPrompt_NoEngineeringRubricKeys(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	got := BuildEnglishHRReportPrompt(s)

	for _, k := range []string{`"problem_solving"`, `"code_quality"`, `"stress_handling"`} {
		if strings.Contains(got, k) {
			t.Errorf("English HR report prompt leaked engineering rubric key %s", k)
		}
	}
}

func TestBuildEnglishHRReportPrompt_OutputBlockIsValidJSONShape(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	prompt := BuildEnglishHRReportPrompt(s)

	// Extract the JSON template inside `# OUTPUT … }`. We don't need it
	// to be valid JSON literally (placeholders are angle-brackets), but
	// we want to fail fast if the structure is broken (unbalanced
	// braces, etc.) since the model's output is parsed downstream.
	open := strings.IndexByte(prompt, '{')
	close := strings.LastIndexByte(prompt, '}')
	if open < 0 || close <= open {
		t.Fatalf("OUTPUT block must contain a {...} skeleton")
	}
	skeleton := prompt[open : close+1]
	depth := 0
	for _, r := range skeleton {
		switch r {
		case '{':
			depth++
		case '}':
			depth--
			if depth < 0 {
				t.Fatalf("unbalanced braces in OUTPUT skeleton")
			}
		}
	}
	if depth != 0 {
		t.Fatalf("OUTPUT skeleton braces unbalanced (final depth=%d)", depth)
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Dispatch: BuildSystemPrompt / BuildReportPrompt route to English HR
// when section matches. Without these, a future refactor of the
// algorithmic prompt builder could silently drift the dispatch.
// ─────────────────────────────────────────────────────────────────────────

func TestBuildSystemPrompt_RoutesToEnglishHR(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	// Algorithmic-mock-shaped task; the dispatcher must IGNORE this and
	// route to the English HR builder, which never reads task fields.
	algoTask := TaskWithHint{Title: "Two Sum", Description: "find pair", SolutionHint: "two pointers"}

	got := BuildSystemPrompt(s, algoTask, UserContext{}, CompanyContext{Name: "Acme"}, time.Minute, StressProfile{}, "")

	if !strings.Contains(got, "HR recruiter") {
		t.Errorf("expected English HR prompt, but got something else:\n%s", got)
	}
	if strings.Contains(got, "Two Sum") || strings.Contains(got, "two pointers") {
		t.Errorf("dispatcher leaked algorithmic-task fields into English HR prompt:\n%s", got)
	}
}

func TestBuildReportPrompt_RoutesToEnglishHR(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionEnglishHR, DurationMin: 30}
	got := BuildReportPrompt(s, TaskWithHint{}, StressProfile{PausesScore: 99})

	// English HR rubric key MUST appear; the engineering rubric keys
	// MUST NOT. PausesScore=99 is intentionally extreme — if it leaks
	// into the prompt we know the dispatcher is broken.
	if !strings.Contains(got, `"clarity":`) {
		t.Errorf("English HR report prompt missing rubric:\n%s", got)
	}
	if strings.Contains(got, "stress_analysis: ") || strings.Contains(got, "pauses=99") {
		t.Errorf("dispatcher leaked stress profile into English HR report:\n%s", got)
	}
}

// (Brace-balance check above already protects against accidental quote
// breakage in the OUTPUT skeleton; we don't json.Unmarshal it because
// the angle-bracket placeholders make a literal parse irrelevant.)
