// orchestrator_legacy_fakes_test.go — back-compat shims for tests
// that still rely on hand-rolled fakes.
//
// orchestrator_test.go uses mockgen-driven stateful mocks (orchStore +
// wireOrch*). The remaining consumers — atlas_struggle_test.go and the
// four *_grade_test.go files — use a simple `atts.rows[id] = ...`
// seeding pattern that doesn't justify the wire-code overhead. Keeping
// the minimal in-memory fakes here lets those tests stay terse.

package app

import (
	"context"
	"time"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// ── fakeAttempts — used by *_grade_test.go ─────────────────────────────

type fakeAttempts struct {
	rows     map[uuid.UUID]domain.PipelineAttempt
	byStage  map[uuid.UUID][]uuid.UUID
	question map[uuid.UUID]domain.AttemptWithQuestion
}

func newFakeAttempts() *fakeAttempts {
	return &fakeAttempts{
		rows:     map[uuid.UUID]domain.PipelineAttempt{},
		byStage:  map[uuid.UUID][]uuid.UUID{},
		question: map[uuid.UUID]domain.AttemptWithQuestion{},
	}
}

func (f *fakeAttempts) Create(_ context.Context, a domain.PipelineAttempt) (domain.PipelineAttempt, error) {
	f.rows[a.ID] = a
	f.byStage[a.PipelineStageID] = append(f.byStage[a.PipelineStageID], a.ID)
	return a, nil
}
func (f *fakeAttempts) Get(_ context.Context, id uuid.UUID) (domain.PipelineAttempt, error) {
	a, ok := f.rows[id]
	if !ok {
		return domain.PipelineAttempt{}, domain.ErrNotFound
	}
	return a, nil
}
func (f *fakeAttempts) ListByStage(_ context.Context, stageID uuid.UUID) ([]domain.PipelineAttempt, error) {
	ids := f.byStage[stageID]
	out := make([]domain.PipelineAttempt, 0, len(ids))
	for _, id := range ids {
		out = append(out, f.rows[id])
	}
	return out, nil
}
func (f *fakeAttempts) UpdateJudgeResult(_ context.Context, id uuid.UUID, userAnswerMD string,
	score float32, water float32, verdict domain.AttemptVerdict,
	feedback string, missing []string) error {
	a, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	a.UserAnswerMD = userAnswerMD
	a.AIScore = &score
	a.AIWaterScore = &water
	a.AIVerdict = verdict
	a.AIFeedbackMD = feedback
	a.AIMissingPoints = missing
	t := time.Now().UTC()
	a.AIJudgedAt = &t
	f.rows[id] = a
	return nil
}
func (f *fakeAttempts) UpdateCanvasResult(_ context.Context, id uuid.UUID, in domain.CanvasResultUpdate) error {
	a, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	a.UserExcalidrawSceneJSON = in.SceneJSON
	a.UserContextMD = in.ContextMD
	a.UserAnswerMD = in.UserAnswerMD
	score := in.Score
	a.AIScore = &score
	water := float32(0)
	a.AIWaterScore = &water
	a.AIVerdict = in.Verdict
	a.AIFeedbackMD = in.Feedback
	a.AIMissingPoints = in.MissingPoints
	t := time.Now().UTC()
	a.AIJudgedAt = &t
	f.rows[id] = a
	return nil
}
func (f *fakeAttempts) GetWithQuestion(_ context.Context, id uuid.UUID) (domain.AttemptWithQuestion, error) {
	a, ok := f.rows[id]
	if !ok {
		return domain.AttemptWithQuestion{}, domain.ErrNotFound
	}
	q, ok := f.question[id]
	if !ok {
		return domain.AttemptWithQuestion{Attempt: a}, nil
	}
	q.Attempt = a
	return q, nil
}

// ── fakePipelines / fakePipelineStages / newTestOrchestrator ───────────
//
// Used only by atlas_struggle_test.go. Tightly-scoped: those tests seed
// pipelines/stages directly via map writes, then call FinishPipeline.

type fakePipelines struct {
	rows map[uuid.UUID]domain.MockPipeline
}

func newFakePipelines() *fakePipelines {
	return &fakePipelines{rows: map[uuid.UUID]domain.MockPipeline{}}
}
func (f *fakePipelines) Create(_ context.Context, p domain.MockPipeline) (domain.MockPipeline, error) {
	f.rows[p.ID] = p
	return p, nil
}
func (f *fakePipelines) Get(_ context.Context, id uuid.UUID) (domain.MockPipeline, error) {
	p, ok := f.rows[id]
	if !ok {
		return domain.MockPipeline{}, domain.ErrNotFound
	}
	return p, nil
}
func (f *fakePipelines) ListByUser(context.Context, uuid.UUID, int) ([]domain.MockPipeline, error) {
	return nil, nil
}
func (f *fakePipelines) UpdateVerdict(_ context.Context, id uuid.UUID, v domain.PipelineVerdict, ts *float32) error {
	p, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	p.Verdict = v
	p.TotalScore = ts
	now := time.Now().UTC()
	p.FinishedAt = &now
	f.rows[id] = p
	return nil
}
func (f *fakePipelines) IncrementStageIdx(_ context.Context, id uuid.UUID) (int, error) {
	p, ok := f.rows[id]
	if !ok {
		return 0, domain.ErrNotFound
	}
	p.CurrentStageIdx++
	f.rows[id] = p
	return p.CurrentStageIdx, nil
}

type fakePipelineStages struct {
	rows       map[uuid.UUID]domain.PipelineStage
	byPipeline map[uuid.UUID][]uuid.UUID
}

func newFakePipelineStages() *fakePipelineStages {
	return &fakePipelineStages{
		rows:       map[uuid.UUID]domain.PipelineStage{},
		byPipeline: map[uuid.UUID][]uuid.UUID{},
	}
}
func (f *fakePipelineStages) Create(_ context.Context, s domain.PipelineStage) (domain.PipelineStage, error) {
	f.rows[s.ID] = s
	f.byPipeline[s.PipelineID] = append(f.byPipeline[s.PipelineID], s.ID)
	return s, nil
}
func (f *fakePipelineStages) Get(_ context.Context, id uuid.UUID) (domain.PipelineStage, error) {
	s, ok := f.rows[id]
	if !ok {
		return domain.PipelineStage{}, domain.ErrNotFound
	}
	return s, nil
}
func (f *fakePipelineStages) ListByPipeline(_ context.Context, id uuid.UUID) ([]domain.PipelineStage, error) {
	ids := f.byPipeline[id]
	out := make([]domain.PipelineStage, 0, len(ids))
	for _, id := range ids {
		out = append(out, f.rows[id])
	}
	return out, nil
}
func (f *fakePipelineStages) UpdateStatus(_ context.Context, id uuid.UUID, st domain.StageStatus) error {
	s, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	s.Status = st
	f.rows[id] = s
	return nil
}
func (f *fakePipelineStages) UpdateStartStage(_ context.Context, id, profileID uuid.UUID) error {
	s, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	if s.Status == domain.StageStatusPending {
		s.Status = domain.StageStatusInProgress
	}
	if s.StartedAt == nil {
		t := time.Now().UTC()
		s.StartedAt = &t
	}
	if s.AIStrictnessProfileID == nil {
		pid := profileID
		s.AIStrictnessProfileID = &pid
	}
	f.rows[id] = s
	return nil
}
func (f *fakePipelineStages) FinishStage(_ context.Context, id uuid.UUID, score float32, verdict domain.StageVerdict, feedback string) error {
	s, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	s.Status = domain.StageStatusFinished
	sc := score
	v := verdict
	s.Score = &sc
	s.Verdict = &v
	s.AIFeedbackMD = feedback
	now := time.Now().UTC()
	s.FinishedAt = &now
	f.rows[id] = s
	return nil
}

// fakeStrictnessResolverLegacy — only used to fulfil StrictnessResolver
// in newTestOrchestrator. Returns a single canned profile.
type fakeStrictnessResolverLegacy struct {
	profile domain.AIStrictnessProfile
}

func (f *fakeStrictnessResolverLegacy) ResolveStrictness(context.Context, uuid.UUID, *uuid.UUID, domain.StageKind) (domain.AIStrictnessProfile, error) {
	return f.profile, nil
}

// fakeJudgeLegacy — minimal JudgeClient for atlas_struggle tests (never
// actually invoked there but must satisfy the interface).
type fakeJudgeLegacy struct{}

func (fakeJudgeLegacy) JudgeAnswer(_ context.Context, _ JudgeInput) (JudgeOutput, error) {
	return JudgeOutput{}, nil
}

// newTestOrchestrator — back-compat factory used by atlas_struggle_test.go.
// Returns wired Orchestrator + the two stores it seeds into. The other
// return values are kept (untyped nil) so the existing call-sites with
// `_, _, _, _, _` continue to compile unmodified.
func newTestOrchestrator() (*Orchestrator, *fakePipelines, *fakePipelineStages, *fakeAttempts, any, any, any) {
	pipes := newFakePipelines()
	stages := newFakePipelineStages()
	atts := newFakeAttempts()
	res := &fakeStrictnessResolverLegacy{profile: domain.AIStrictnessProfile{ID: uuid.New(), Slug: "default", OffTopicPenalty: 0.30}}
	o := &Orchestrator{
		Pipelines:      pipes,
		PipelineStages: stages,
		Attempts:       atts,
		Strictness:     res,
		Judge:          fakeJudgeLegacy{},
		Now:            func() time.Time { return time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC) },
	}
	return o, pipes, stages, atts, nil, nil, nil
}
