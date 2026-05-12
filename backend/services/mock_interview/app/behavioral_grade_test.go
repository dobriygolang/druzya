// behavioral_grade_test.go — coverage for the Behavioral STAR rubric.
package app

import (
	"context"
	"errors"
	"testing"

	"druz9/mock_interview/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

func newBehavioralTestRig(t *testing.T, chain *fakeChain, attKind domain.AttemptKind, stageKind domain.StageKind) (*BehavioralGrader, uuid.UUID) {
	t.Helper()
	stageID := uuid.New()
	atts := newFakeAttempts()
	attID := uuid.New()
	atts.rows[attID] = domain.PipelineAttempt{
		ID:              attID,
		PipelineStageID: stageID,
		Kind:            attKind,
	}
	return &BehavioralGrader{
		Chain:    chain,
		Attempts: atts,
		Stages: &fakeStageRepoAlgo{row: domain.PipelineStage{
			ID:        stageID,
			StageKind: stageKind,
			Status:    domain.StageStatusInProgress,
		}},
	}, attID
}

func cannedBehavioralRubric(s, ta, ac, r, comm int, body string) llmchain.Response {
	return llmchain.Response{
		Content: `{"situation":` + itoa(s) +
			`,"task":` + itoa(ta) +
			`,"action":` + itoa(ac) +
			`,"result":` + itoa(r) +
			`,"communication":` + itoa(comm) +
			`,"body_md":"` + body + `"}`,
	}
}

func TestBehavioralGrader_EmptyAnswer_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newBehavioralTestRig(t, chain, domain.AttemptQuestionAnswer, domain.StageBehavioral)
	_, err := g.Run(context.Background(), BehavioralRubricInput{AttemptID: attID, AnswerText: "   "})
	if err == nil || !errors.Is(err, domain.ErrValidation) {
		t.Errorf("want ErrValidation, got %v", err)
	}
}

func TestBehavioralGrader_WrongAttemptKind_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newBehavioralTestRig(t, chain, domain.AttemptTaskSolve, domain.StageBehavioral)
	_, err := g.Run(context.Background(), BehavioralRubricInput{AttemptID: attID, AnswerText: "x"})
	if err == nil || !errors.Is(err, domain.ErrConflict) {
		t.Errorf("want ErrConflict on task_solve attempt, got %v", err)
	}
}

func TestBehavioralGrader_WrongStage_Rejected(t *testing.T) {
	chain := &fakeChain{}
	g, attID := newBehavioralTestRig(t, chain, domain.AttemptQuestionAnswer, domain.StageHR)
	_, err := g.Run(context.Background(), BehavioralRubricInput{AttemptID: attID, AnswerText: "x"})
	if err == nil || !errors.Is(err, domain.ErrConflict) {
		t.Errorf("want ErrConflict on stage=hr, got %v", err)
	}
}

func TestBehavioralGrader_HappyPath(t *testing.T) {
	chain := &fakeChain{responses: []llmchain.Response{cannedBehavioralRubric(
		4, 5, 3, 2, 4,
		"Clear situation and task, but result lacks metrics.",
	)}}
	g, attID := newBehavioralTestRig(t, chain, domain.AttemptQuestionAnswer, domain.StageBehavioral)
	out, err := g.Run(context.Background(), BehavioralRubricInput{AttemptID: attID, AnswerText: "When I was at X, we had a deadline..."})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Axes.Situation != 4 || out.Axes.Task != 5 || out.Axes.Result != 2 {
		t.Errorf("axes=%+v", out.Axes)
	}
	if out.CommunicationScore != 4 {
		t.Errorf("comm=%d", out.CommunicationScore)
	}
	if out.Unavailable {
		t.Errorf("unavailable=true on happy path")
	}
}

func TestBehavioralGrader_AxesClamped(t *testing.T) {
	chain := &fakeChain{responses: []llmchain.Response{cannedBehavioralRubric(
		0, 8, -1, 7, 3,
		"test",
	)}}
	g, attID := newBehavioralTestRig(t, chain, domain.AttemptQuestionAnswer, domain.StageBehavioral)
	out, err := g.Run(context.Background(), BehavioralRubricInput{AttemptID: attID, AnswerText: "x"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Axes.Situation != 1 || out.Axes.Action != 1 {
		t.Errorf("clamp-to-1 failed: %+v", out.Axes)
	}
	if out.Axes.Task != 5 || out.Axes.Result != 5 {
		t.Errorf("clamp-to-5 failed: %+v", out.Axes)
	}
}

func TestBehavioralGrader_LLMError_Unavailable(t *testing.T) {
	chain := &fakeChain{err: errors.New("boom")}
	g, attID := newBehavioralTestRig(t, chain, domain.AttemptQuestionAnswer, domain.StageBehavioral)
	out, err := g.Run(context.Background(), BehavioralRubricInput{AttemptID: attID, AnswerText: "x"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if !out.Unavailable {
		t.Errorf("want unavailable on LLM err")
	}
}

func TestBehavioralGrader_NilChain_Unavailable(t *testing.T) {
	g, attID := newBehavioralTestRig(t, nil, domain.AttemptQuestionAnswer, domain.StageBehavioral)
	g.Chain = nil
	out, err := g.Run(context.Background(), BehavioralRubricInput{AttemptID: attID, AnswerText: "x"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if !out.Unavailable {
		t.Errorf("want unavailable on nil chain")
	}
}

func TestBehavioralGrader_VoiceAnswerAccepted(t *testing.T) {
	chain := &fakeChain{responses: []llmchain.Response{cannedBehavioralRubric(3, 3, 3, 3, 3, "ok")}}
	g, attID := newBehavioralTestRig(t, chain, domain.AttemptVoiceAnswer, domain.StageBehavioral)
	out, err := g.Run(context.Background(), BehavioralRubricInput{AttemptID: attID, AnswerText: "speech transcript"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Unavailable {
		t.Errorf("voice_answer kind should be accepted")
	}
}
