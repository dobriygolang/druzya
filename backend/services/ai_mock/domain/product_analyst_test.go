package domain

import (
	"strings"
	"testing"
	"time"

	"druz9/shared/enums"
)

func TestIsProductAnalystSection(t *testing.T) {
	t.Parallel()
	if !IsProductAnalystSection(enums.SectionProductAnalyst) {
		t.Error("SectionProductAnalyst must be detected")
	}
	for _, s := range []enums.Section{
		enums.SectionAlgorithms, enums.SectionEnglishHR, enums.SectionTechLeadEM,
		enums.SectionSysanalyst, "",
	} {
		if IsProductAnalystSection(s) {
			t.Errorf("non-PA section misclassified: %s", s)
		}
	}
}

func TestBuildProductAnalystSystemPrompt_ContainsRubric(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionProductAnalyst, DurationMin: 45}
	out := BuildProductAnalystSystemPrompt(s, UserContext{}, CompanyContext{}, 5*time.Minute)
	for _, axis := range []string{"metrics", "sql", "experimentation", "frameworks", "communication"} {
		if !strings.Contains(out, axis) {
			t.Errorf("rubric axis missing: %s", axis)
		}
	}
}

func TestBuildProductAnalystReportPrompt_ContainsAllAxes(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionProductAnalyst, DurationMin: 45}
	out := BuildProductAnalystReportPrompt(s)
	for _, axis := range []string{
		`"metrics"`, `"sql"`, `"experimentation"`, `"frameworks"`, `"communication"`,
	} {
		if !strings.Contains(out, axis) {
			t.Errorf("rubric section missing in report JSON shape: %s", axis)
		}
	}
}

func TestBuildSystemPrompt_DispatchesProductAnalyst(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionProductAnalyst, DurationMin: 45}
	out := BuildSystemPrompt(s, TaskWithHint{}, UserContext{}, CompanyContext{}, 0, StressProfile{}, "")
	if !strings.Contains(out, "Head of Product Analytics") {
		t.Error("BuildSystemPrompt didn't dispatch to PA builder")
	}
}

func TestBuildReportPrompt_DispatchesProductAnalyst(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionProductAnalyst, DurationMin: 45}
	out := BuildReportPrompt(s, TaskWithHint{}, StressProfile{})
	if !strings.Contains(out, "Product Analyst") {
		t.Error("BuildReportPrompt didn't dispatch to PA grader")
	}
}

func TestSection_IsTaskBased_NewSectionsAreFreeForm(t *testing.T) {
	t.Parallel()
	for _, s := range []enums.Section{
		enums.SectionSysanalyst, enums.SectionProductAnalyst,
	} {
		if s.IsTaskBased() {
			t.Errorf("%s must be free-form (IsTaskBased=false)", s)
		}
		if s.IsEngineering() {
			t.Errorf("%s must be non-engineering (IsEngineering=false)", s)
		}
	}
}
