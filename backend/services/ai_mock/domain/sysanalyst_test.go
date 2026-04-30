package domain

import (
	"strings"
	"testing"
	"time"

	"druz9/shared/enums"
)

func TestIsSysanalystSection(t *testing.T) {
	t.Parallel()
	if !IsSysanalystSection(enums.SectionSysanalyst) {
		t.Error("SectionSysanalyst must be detected")
	}
	for _, s := range []enums.Section{
		enums.SectionAlgorithms, enums.SectionEnglishHR, enums.SectionTechLeadEM,
		enums.SectionProductAnalyst, "",
	} {
		if IsSysanalystSection(s) {
			t.Errorf("non-sysanalyst section misclassified: %s", s)
		}
	}
}

func TestBuildSysanalystSystemPrompt_ContainsRubric(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSysanalyst, DurationMin: 45}
	out := BuildSysanalystSystemPrompt(s, UserContext{}, CompanyContext{}, 5*time.Minute)
	for _, axis := range []string{"requirements", "modeling", "integration", "data", "process"} {
		if !strings.Contains(out, axis) {
			t.Errorf("rubric axis missing: %s", axis)
		}
	}
}

func TestBuildSysanalystSystemPrompt_DevilsAdvocate(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSysanalyst, DurationMin: 45, DevilsAdvocate: true}
	out := BuildSysanalystSystemPrompt(s, UserContext{}, CompanyContext{}, 0)
	if !strings.Contains(out, "Devil's Advocate") {
		t.Error("devil's advocate mode block missing")
	}
}

func TestBuildSysanalystSystemPrompt_RespectsLanguage(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSysanalyst, DurationMin: 45}
	out := BuildSysanalystSystemPrompt(s, UserContext{ResponseLanguage: "en"}, CompanyContext{}, 0)
	if !strings.Contains(out, "Respond in en") {
		t.Error("language override not honoured")
	}
}

func TestBuildSysanalystReportPrompt_ContainsAllAxes(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSysanalyst, DurationMin: 45}
	out := BuildSysanalystReportPrompt(s)
	for _, axis := range []string{
		`"requirements"`, `"modeling"`, `"integration"`, `"data"`, `"process"`,
	} {
		if !strings.Contains(out, axis) {
			t.Errorf("rubric section missing in report JSON shape: %s", axis)
		}
	}
}

func TestBuildSystemPrompt_DispatchesSysanalyst(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSysanalyst, DurationMin: 45}
	out := BuildSystemPrompt(s, TaskWithHint{}, UserContext{}, CompanyContext{}, 0, StressProfile{}, "")
	// The sysanalyst prompt includes the «working interview» phrase, the
	// generic system prompt does not.
	if !strings.Contains(out, "working interview") {
		t.Error("BuildSystemPrompt didn't dispatch to sysanalyst builder")
	}
}

func TestBuildReportPrompt_DispatchesSysanalyst(t *testing.T) {
	t.Parallel()
	s := Session{Section: enums.SectionSysanalyst, DurationMin: 45}
	out := BuildReportPrompt(s, TaskWithHint{}, StressProfile{})
	if !strings.Contains(out, "Sysanalyst") {
		t.Error("BuildReportPrompt didn't dispatch to sysanalyst grader")
	}
}
