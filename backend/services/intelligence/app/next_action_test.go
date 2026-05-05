package app

import (
	"strings"
	"testing"

	"druz9/intelligence/domain"
)

func TestParseNextAction_OK(t *testing.T) {
	raw := `{"action_kind":"focus_block","target":"de_streaming","rationale":"Last DE mock weak on streaming.","estimated_minutes":45}`
	out, err := parseNextAction(raw)
	if err != nil {
		t.Fatal(err)
	}
	if out.ActionKind != "focus_block" || out.EstimatedMinutes != 45 {
		t.Fatalf("bad parse: %+v", out)
	}
}

func TestParseNextAction_StripsFences(t *testing.T) {
	raw := "```json\n{\"action_kind\":\"checkpoint\",\"target\":\"step_3\",\"rationale\":\"All core read.\",\"estimated_minutes\":15}\n```"
	out, err := parseNextAction(raw)
	if err != nil {
		t.Fatal(err)
	}
	if out.ActionKind != "checkpoint" {
		t.Fatalf("bad parse: %+v", out)
	}
}

func TestParseNextAction_RejectsInvalidKind(t *testing.T) {
	raw := `{"action_kind":"go_running","target":"x","rationale":"y","estimated_minutes":10}`
	if _, err := parseNextAction(raw); err == nil || !strings.Contains(err.Error(), "invalid action_kind") {
		t.Fatalf("expected invalid kind error, got %v", err)
	}
}

func TestParseNextAction_RejectsEmptyRationale(t *testing.T) {
	raw := `{"action_kind":"focus_block","target":"x","rationale":"   ","estimated_minutes":30}`
	if _, err := parseNextAction(raw); err == nil || !strings.Contains(err.Error(), "empty rationale") {
		t.Fatalf("expected empty rationale error, got %v", err)
	}
}

func TestBuildNextActionPrompt_IncludesForkSection(t *testing.T) {
	in := NextActionInput{
		LearningState: LearningStateView{Mode: "explore", ExploreWeekIndex: 3},
		Fork: domain.ForkProgressSnapshot{
			Mode: "explore",
			ScoresByBranch: []domain.ForkBranchScore{
				{Branch: "mle", MockCount: 1, AvgScore: 60},
				{Branch: "de", MockCount: 3, AvgScore: 75, VoluntaryDeepDives: 4},
			},
		},
	}
	out := buildNextActionPrompt(in)
	if !strings.Contains(out, "FORK STATUS") || !strings.Contains(out, "mle") || !strings.Contains(out, "de") {
		t.Fatalf("expected fork section in prompt, got:\n%s", out)
	}
}
