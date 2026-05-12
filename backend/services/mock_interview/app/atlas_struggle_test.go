// atlas_struggle_test.go — Phase J Wave 3 / O (X5 cross-product handoff).
//
// Covers emitStruggleMarks on top of the existing newTestOrchestrator
// fixture. Each test pipes a finished pipeline through FinishPipeline
// and asserts which stages produced struggle marks.
package app

import (
	"context"
	"testing"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// ─── Fake StruggleHook ────────────────────────────────────────────────────

type fakeStruggleHook struct {
	calls []struggleCall
}

type struggleCall struct {
	userID      uuid.UUID
	atlasNodeID string
	stageKind   domain.StageKind
	axisScore   float64
}

func (h *fakeStruggleHook) OnStageStruggle(
	_ context.Context,
	userID uuid.UUID,
	atlasNodeID string,
	stageKind domain.StageKind,
	axisScore float64,
	_ string,
) {
	h.calls = append(h.calls, struggleCall{
		userID:      userID,
		atlasNodeID: atlasNodeID,
		stageKind:   stageKind,
		axisScore:   axisScore,
	})
}

// ─── Tests ────────────────────────────────────────────────────────────────

func TestFinishPipeline_LowStage_EmitsStruggle(t *testing.T) {
	o, pipes, stages, _, _, _, _ := newTestOrchestrator()
	hook := &fakeStruggleHook{}
	o.Struggle = hook

	pipeID := uuid.New()
	userID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: userID, Verdict: domain.PipelineInProgress}

	// 2 stages: one strong (score=80) — no mark; one weak (score=20) — mark.
	type seed struct {
		kind  domain.StageKind
		score float32
	}
	seeds := []seed{
		{domain.StageAlgo, 80},
		{domain.StageSysDesign, 20},
	}
	for i, s := range seeds {
		sid := uuid.New()
		sc := s.score
		v := domain.StageVerdictPass
		if sc < 50 {
			v = domain.StageVerdictFail
		}
		stages.rows[sid] = domain.PipelineStage{
			ID: sid, PipelineID: pipeID, Ordinal: i,
			StageKind: s.kind,
			Status:    domain.StageStatusFinished,
			Score:     &sc,
			Verdict:   &v,
		}
		stages.byPipeline[pipeID] = append(stages.byPipeline[pipeID], sid)
	}

	if _, err := o.FinishPipeline(context.Background(), pipeID); err != nil {
		t.Fatalf("FinishPipeline: %v", err)
	}

	if len(hook.calls) != 1 {
		t.Fatalf("expected exactly 1 struggle mark, got %d: %+v", len(hook.calls), hook.calls)
	}
	call := hook.calls[0]
	if call.stageKind != domain.StageSysDesign {
		t.Errorf("wrong stage kind: %s", call.stageKind)
	}
	if call.atlasNodeID != "stage:sysdesign" {
		t.Errorf("wrong atlas anchor: %s", call.atlasNodeID)
	}
	if call.axisScore < 0.19 || call.axisScore > 0.21 {
		t.Errorf("axis score %.4f not ~0.20", call.axisScore)
	}
	if call.userID != userID {
		t.Errorf("user_id mismatch: %v vs %v", call.userID, userID)
	}
}

func TestFinishPipeline_AllStagesStrong_NoStruggle(t *testing.T) {
	o, pipes, stages, _, _, _, _ := newTestOrchestrator()
	hook := &fakeStruggleHook{}
	o.Struggle = hook

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress}
	for i, kind := range []domain.StageKind{domain.StageAlgo, domain.StageCoding, domain.StageSysDesign, domain.StageBehavioral} {
		sid := uuid.New()
		sc := float32(75)
		v := domain.StageVerdictPass
		stages.rows[sid] = domain.PipelineStage{
			ID: sid, PipelineID: pipeID, Ordinal: i,
			StageKind: kind,
			Status:    domain.StageStatusFinished,
			Score:     &sc,
			Verdict:   &v,
		}
		stages.byPipeline[pipeID] = append(stages.byPipeline[pipeID], sid)
	}

	if _, err := o.FinishPipeline(context.Background(), pipeID); err != nil {
		t.Fatalf("FinishPipeline: %v", err)
	}
	if len(hook.calls) != 0 {
		t.Fatalf("expected zero struggle marks, got %d: %+v", len(hook.calls), hook.calls)
	}
}

func TestFinishPipeline_HRStage_NoStruggle(t *testing.T) {
	// HR is not a learnable axis so even a low score must not emit a mark.
	o, pipes, stages, _, _, _, _ := newTestOrchestrator()
	hook := &fakeStruggleHook{}
	o.Struggle = hook

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress}
	sid := uuid.New()
	sc := float32(10)
	v := domain.StageVerdictFail
	stages.rows[sid] = domain.PipelineStage{
		ID: sid, PipelineID: pipeID, Ordinal: 0,
		StageKind: domain.StageHR,
		Status:    domain.StageStatusFinished,
		Score:     &sc,
		Verdict:   &v,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{sid}

	if _, err := o.FinishPipeline(context.Background(), pipeID); err != nil {
		t.Fatalf("FinishPipeline: %v", err)
	}
	if len(hook.calls) != 0 {
		t.Fatalf("expected zero struggle marks for HR stage, got %d", len(hook.calls))
	}
}

func TestFinishPipeline_AllAxesLow_EmitsAll(t *testing.T) {
	// All 4 learnable axes < 0.4 → 4 struggle marks.
	o, pipes, stages, _, _, _, _ := newTestOrchestrator()
	hook := &fakeStruggleHook{}
	o.Struggle = hook

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress}
	for i, kind := range []domain.StageKind{domain.StageAlgo, domain.StageCoding, domain.StageSysDesign, domain.StageBehavioral} {
		sid := uuid.New()
		sc := float32(25)
		v := domain.StageVerdictFail
		stages.rows[sid] = domain.PipelineStage{
			ID: sid, PipelineID: pipeID, Ordinal: i,
			StageKind: kind,
			Status:    domain.StageStatusFinished,
			Score:     &sc,
			Verdict:   &v,
		}
		stages.byPipeline[pipeID] = append(stages.byPipeline[pipeID], sid)
	}

	if _, err := o.FinishPipeline(context.Background(), pipeID); err != nil {
		t.Fatalf("FinishPipeline: %v", err)
	}
	if len(hook.calls) != 4 {
		t.Fatalf("expected 4 struggle marks, got %d", len(hook.calls))
	}
	// Anchors are unique per stage kind.
	seen := map[string]struct{}{}
	for _, c := range hook.calls {
		if _, dup := seen[c.atlasNodeID]; dup {
			t.Fatalf("duplicate anchor %s", c.atlasNodeID)
		}
		seen[c.atlasNodeID] = struct{}{}
	}
	for _, want := range []string{"stage:algo", "stage:coding", "stage:sysdesign", "stage:behavioral"} {
		if _, ok := seen[want]; !ok {
			t.Fatalf("anchor %s missing from %v", want, seen)
		}
	}
}

func TestFinishPipeline_BorderlineStage_NoStruggle(t *testing.T) {
	// Score == 40 (axis = 0.4) is exactly at threshold; threshold is strict
	// "< 0.4" so this must NOT emit a mark.
	o, pipes, stages, _, _, _, _ := newTestOrchestrator()
	hook := &fakeStruggleHook{}
	o.Struggle = hook

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress}
	sid := uuid.New()
	sc := float32(40)
	v := domain.StageVerdictBorderline
	stages.rows[sid] = domain.PipelineStage{
		ID: sid, PipelineID: pipeID, Ordinal: 0,
		StageKind: domain.StageAlgo,
		Status:    domain.StageStatusFinished,
		Score:     &sc,
		Verdict:   &v,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{sid}

	if _, err := o.FinishPipeline(context.Background(), pipeID); err != nil {
		t.Fatalf("FinishPipeline: %v", err)
	}
	if len(hook.calls) != 0 {
		t.Fatalf("expected no struggle marks at threshold, got %d", len(hook.calls))
	}
}

func TestFinishPipeline_NilStruggleHook_StillWorks(t *testing.T) {
	// Without a Struggle hook FinishPipeline must run cleanly (the field
	// is documented as nil-safe).
	o, pipes, stages, _, _, _, _ := newTestOrchestrator()
	o.Struggle = nil // explicit for the docs

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress}
	sid := uuid.New()
	sc := float32(20)
	v := domain.StageVerdictFail
	stages.rows[sid] = domain.PipelineStage{
		ID: sid, PipelineID: pipeID, Ordinal: 0,
		StageKind: domain.StageAlgo,
		Status:    domain.StageStatusFinished,
		Score:     &sc,
		Verdict:   &v,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{sid}

	if _, err := o.FinishPipeline(context.Background(), pipeID); err != nil {
		t.Fatalf("FinishPipeline (nil hook): %v", err)
	}
}
