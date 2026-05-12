// coding_grade_test.go — table-driven coverage for the Coding rubric UC.
// Uses an in-process fake chain (mirrors judge_test.go) so the parser +
// validation guards are exercised without burning provider quota.
package app

import (
	"context"
	"errors"
	"testing"

	"druz9/mock_interview/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// helper — build a coding-stage rig with the given attempt kind + stage
// kind. Reuses fakeStageRepoAlgo and fakeTaskRepoAlgo from algo_grade_test
// (same package).
func newCodingTestRig(t *testing.T, chain *fakeChain, attKind domain.AttemptKind, taskID *uuid.UUID, stageKind domain.StageKind) (*CodingGrader, uuid.UUID) {
	t.Helper()
	stageID := uuid.New()
	atts := newFakeAttempts()
	attID := uuid.New()
	atts.rows[attID] = domain.PipelineAttempt{
		ID:              attID,
		PipelineStageID: stageID,
		Kind:            attKind,
		TaskID:          taskID,
	}
	g := &CodingGrader{
		Chain:    chain,
		Attempts: atts,
		Tasks:    fakeTaskRepoAlgo{},
		Stages: &fakeStageRepoAlgo{row: domain.PipelineStage{
			ID:        stageID,
			StageKind: stageKind,
			Status:    domain.StageStatusInProgress,
		}},
	}
	return g, attID
}

func cannedCodingRubric(score int, strengths, weaknesses []string, suggestedLines []int, rubric string) llmchain.Response {
	// Build JSON by hand so this file doesn't need encoding/json — keeps the
	// test parity with judge_test.go's hand-rolled canned responses.
	strJSON := "[]"
	if len(strengths) > 0 {
		strJSON = `["` + strengths[0] + `"]`
		for i := 1; i < len(strengths); i++ {
			strJSON = strJSON[:len(strJSON)-1] + `,"` + strengths[i] + `"]`
		}
	}
	weakJSON := "[]"
	if len(weaknesses) > 0 {
		weakJSON = `["` + weaknesses[0] + `"]`
		for i := 1; i < len(weaknesses); i++ {
			weakJSON = weakJSON[:len(weakJSON)-1] + `,"` + weaknesses[i] + `"]`
		}
	}
	linesJSON := "[]"
	if len(suggestedLines) > 0 {
		linesJSON = "[" + itoa(suggestedLines[0])
		for i := 1; i < len(suggestedLines); i++ {
			linesJSON += "," + itoa(suggestedLines[i])
		}
		linesJSON += "]"
	}
	return llmchain.Response{
		Content: `{"score":` + itoa(score) +
			`,"strengths":` + strJSON +
			`,"weaknesses":` + weakJSON +
			`,"suggested_lines":` + linesJSON +
			`,"rubric_md":"` + rubric + `"}`,
	}
}

// ── Run() guards ────────────────────────────────────────────────────────

func TestCodingGrader_EmptyCode_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newCodingTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageCoding)
	_, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "   ", Language: "go"})
	if err == nil || !errors.Is(err, domain.ErrValidation) {
		t.Errorf("want ErrValidation, got %v", err)
	}
}

func TestCodingGrader_EmptyLanguage_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newCodingTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageCoding)
	_, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "x", Language: " "})
	if err == nil || !errors.Is(err, domain.ErrValidation) {
		t.Errorf("want ErrValidation, got %v", err)
	}
}

func TestCodingGrader_WrongAttemptKind_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newCodingTestRig(t, chain, domain.AttemptQuestionAnswer, nil, domain.StageCoding)
	_, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "x", Language: "go"})
	if err == nil || !errors.Is(err, domain.ErrConflict) {
		t.Errorf("want ErrConflict, got %v", err)
	}
}

func TestCodingGrader_WrongStageKind_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newCodingTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageAlgo)
	_, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "x", Language: "go"})
	if err == nil || !errors.Is(err, domain.ErrConflict) {
		t.Errorf("want ErrConflict on stage_kind=algo, got %v", err)
	}
}

// ── happy paths ─────────────────────────────────────────────────────────

func TestCodingGrader_HappyPath(t *testing.T) {
	chain := &fakeChain{responses: []llmchain.Response{cannedCodingRubric(
		4,
		[]string{"чистый код", "хорошее именование"},
		[]string{"нет обработки nil-input"},
		[]int{12, 18, 24},
		"Solid implementation, address nil-input.",
	)}}
	g, attID := newCodingTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageCoding)
	out, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "func main() {}", Language: "go"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Score != 4 {
		t.Errorf("score=%d, want 4", out.Score)
	}
	if len(out.Strengths) != 2 || out.Strengths[0] != "чистый код" {
		t.Errorf("strengths=%v", out.Strengths)
	}
	if len(out.SuggestedLines) != 3 {
		t.Errorf("suggested_lines=%v", out.SuggestedLines)
	}
	if out.Unavailable {
		t.Errorf("unavailable=true on happy path")
	}
}

func TestCodingGrader_ScoreClamped(t *testing.T) {
	// LLM returned out-of-range scores → clamp to 1..5.
	tests := []struct {
		raw, want int
	}{
		{raw: 0, want: 1},
		{raw: -2, want: 1},
		{raw: 7, want: 5},
		{raw: 100, want: 5},
	}
	for _, tc := range tests {
		chain := &fakeChain{responses: []llmchain.Response{cannedCodingRubric(
			tc.raw, nil, nil, nil, "test",
		)}}
		g, attID := newCodingTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageCoding)
		out, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "x", Language: "go"})
		if err != nil {
			t.Fatalf("raw=%d err=%v", tc.raw, err)
		}
		if out.Score != tc.want {
			t.Errorf("raw=%d clamped to %d, want %d", tc.raw, out.Score, tc.want)
		}
	}
}

func TestCodingGrader_SuggestedLinesDeduped(t *testing.T) {
	// Backend dedups + drops non-positive.
	chain := &fakeChain{responses: []llmchain.Response{cannedCodingRubric(
		3, nil, nil, []int{12, 12, 0, -3, 18, 18, 24}, "test",
	)}}
	g, attID := newCodingTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageCoding)
	out, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "x", Language: "go"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if len(out.SuggestedLines) != 3 {
		t.Errorf("suggested_lines=%v, want 3 unique positive", out.SuggestedLines)
	}
}

func TestCodingGrader_NilChain_ReturnsUnavailable(t *testing.T) {
	g, attID := newCodingTestRig(t, nil, domain.AttemptTaskSolve, nil, domain.StageCoding)
	g.Chain = nil
	out, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "x", Language: "go"})
	if err != nil {
		t.Fatalf("err=%v, want nil (unavailable path)", err)
	}
	if !out.Unavailable {
		t.Errorf("want unavailable=true, got %+v", out)
	}
}

func TestCodingGrader_LLMError_ReturnsUnavailable(t *testing.T) {
	chain := &fakeChain{err: errors.New("boom")}
	g, attID := newCodingTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageCoding)
	out, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "x", Language: "go"})
	if err != nil {
		t.Fatalf("err=%v, want nil", err)
	}
	if !out.Unavailable {
		t.Errorf("want unavailable=true on chain error")
	}
}

func TestCodingGrader_ParseFailure_ReturnsUnavailable(t *testing.T) {
	chain := &fakeChain{responses: []llmchain.Response{{Content: "not json at all"}}}
	g, attID := newCodingTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageCoding)
	out, err := g.Run(context.Background(), CodingRubricInput{AttemptID: attID, Code: "x", Language: "go"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if !out.Unavailable {
		t.Errorf("want unavailable=true on parse failure")
	}
}
