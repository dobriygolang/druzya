// sysdesign_grade_test.go — coverage for the SysDesign 5-axis rubric.
package app

import (
	"context"
	"errors"
	"testing"

	"druz9/mock_interview/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

func newSysDesignTestRig(t *testing.T, chain *fakeChain, attKind domain.AttemptKind, taskID *uuid.UUID, stageKind domain.StageKind) (*SysDesignGrader, uuid.UUID) {
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
	return &SysDesignGrader{
		Chain:    chain,
		Attempts: atts,
		Tasks:    fakeTaskRepoAlgo{},
		Stages: &fakeStageRepoAlgo{row: domain.PipelineStage{
			ID:        stageID,
			StageKind: stageKind,
			Status:    domain.StageStatusInProgress,
		}},
	}, attID
}

func cannedSysDesignRubric(av, cn, sc, co, sm int, critique string, missing []string) llmchain.Response {
	missJSON := "[]"
	if len(missing) > 0 {
		missJSON = `["` + missing[0] + `"]`
		for i := 1; i < len(missing); i++ {
			missJSON = missJSON[:len(missJSON)-1] + `,"` + missing[i] + `"]`
		}
	}
	return llmchain.Response{
		Content: `{"availability":` + itoa(av) +
			`,"consistency":` + itoa(cn) +
			`,"scalability":` + itoa(sc) +
			`,"cost":` + itoa(co) +
			`,"simplicity":` + itoa(sm) +
			`,"narrative_critique":"` + critique +
			`","missing_concepts":` + missJSON + `}`,
	}
}

func TestSysDesignGrader_BothEmpty_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newSysDesignTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageSysDesign)
	_, err := g.Run(context.Background(), SysDesignRubricInput{AttemptID: attID, CanvasJSON: "", NarrationText: " "})
	if err == nil || !errors.Is(err, domain.ErrValidation) {
		t.Errorf("want ErrValidation, got %v", err)
	}
}

func TestSysDesignGrader_WrongStage_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newSysDesignTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageAlgo)
	_, err := g.Run(context.Background(), SysDesignRubricInput{AttemptID: attID, NarrationText: "x"})
	if err == nil || !errors.Is(err, domain.ErrConflict) {
		t.Errorf("want ErrConflict, got %v", err)
	}
}

func TestSysDesignGrader_WrongAttemptKind_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newSysDesignTestRig(t, chain, domain.AttemptQuestionAnswer, nil, domain.StageSysDesign)
	_, err := g.Run(context.Background(), SysDesignRubricInput{AttemptID: attID, NarrationText: "x"})
	if err == nil || !errors.Is(err, domain.ErrConflict) {
		t.Errorf("want ErrConflict on attempt kind, got %v", err)
	}
}

func TestSysDesignGrader_HappyPath(t *testing.T) {
	chain := &fakeChain{responses: []llmchain.Response{cannedSysDesignRubric(
		4, 3, 5, 2, 3,
		"Strong horizontal scaling story; cost story weak.",
		[]string{"read replicas", "consistent hashing"},
	)}}
	g, attID := newSysDesignTestRig(t, chain, domain.AttemptSysDesignCanvas, nil, domain.StageSysDesign)
	out, err := g.Run(context.Background(), SysDesignRubricInput{
		AttemptID:     attID,
		CanvasJSON:    `{"elements":[]}`,
		NarrationText: "Use Cassandra + Redis for hot keys; sharding by user_id",
	})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Axes.Availability != 4 || out.Axes.Scalability != 5 || out.Axes.Cost != 2 {
		t.Errorf("axes=%+v", out.Axes)
	}
	if len(out.MissingConcepts) != 2 {
		t.Errorf("missing=%v", out.MissingConcepts)
	}
	if out.Unavailable {
		t.Errorf("unavailable=true on happy path")
	}
}

func TestSysDesignGrader_AxesClamped(t *testing.T) {
	chain := &fakeChain{responses: []llmchain.Response{cannedSysDesignRubric(
		0, -3, 7, 9, 3,
		"test", nil,
	)}}
	g, attID := newSysDesignTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageSysDesign)
	out, err := g.Run(context.Background(), SysDesignRubricInput{AttemptID: attID, NarrationText: "x"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Axes.Availability != 1 || out.Axes.Consistency != 1 {
		t.Errorf("availability/consistency not clamped to 1: %+v", out.Axes)
	}
	if out.Axes.Scalability != 5 || out.Axes.Cost != 5 {
		t.Errorf("scalability/cost not clamped to 5: %+v", out.Axes)
	}
	if out.Axes.Simplicity != 3 {
		t.Errorf("simplicity should pass through: %d", out.Axes.Simplicity)
	}
}

func TestSysDesignGrader_LLMError_ReturnsUnavailable(t *testing.T) {
	chain := &fakeChain{err: errors.New("boom")}
	g, attID := newSysDesignTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageSysDesign)
	out, err := g.Run(context.Background(), SysDesignRubricInput{AttemptID: attID, NarrationText: "x"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if !out.Unavailable {
		t.Errorf("want unavailable=true, got %+v", out)
	}
}

func TestSysDesignGrader_NilChain_ReturnsUnavailable(t *testing.T) {
	g, attID := newSysDesignTestRig(t, nil, domain.AttemptTaskSolve, nil, domain.StageSysDesign)
	g.Chain = nil
	out, err := g.Run(context.Background(), SysDesignRubricInput{AttemptID: attID, NarrationText: "x"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if !out.Unavailable {
		t.Errorf("want unavailable=true on nil chain")
	}
}

func TestSysDesignGrader_ParseFailure_ReturnsUnavailable(t *testing.T) {
	chain := &fakeChain{responses: []llmchain.Response{{Content: "not json"}}}
	g, attID := newSysDesignTestRig(t, chain, domain.AttemptTaskSolve, nil, domain.StageSysDesign)
	out, err := g.Run(context.Background(), SysDesignRubricInput{AttemptID: attID, NarrationText: "x"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if !out.Unavailable {
		t.Errorf("want unavailable=true on parse fail")
	}
}
