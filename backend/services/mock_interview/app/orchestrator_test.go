// Orchestrator tests — in-memory fakes (we extend the existing fake repos
// from handlers_test.go) plus narrowly-scoped fakes for the strictness
// resolver and judge.
package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// ── orchestrator-only fakes ─────────────────────────────────────────────

type orchFakeQuestionRepo struct {
	defaults []domain.DefaultQuestion
	company  []domain.CompanyQuestion
	taskQs   map[uuid.UUID][]domain.TaskQuestion
}

func (f *orchFakeQuestionRepo) ListTaskQuestions(_ context.Context, taskID uuid.UUID) ([]domain.TaskQuestion, error) {
	return f.taskQs[taskID], nil
}
func (f *orchFakeQuestionRepo) CreateTaskQuestion(_ context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) {
	return q, nil
}
func (f *orchFakeQuestionRepo) UpdateTaskQuestion(_ context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) {
	return q, nil
}
func (f *orchFakeQuestionRepo) DeleteTaskQuestion(context.Context, uuid.UUID) error { return nil }
func (f *orchFakeQuestionRepo) ListDefaultQuestions(_ context.Context, stage domain.StageKind, _ bool) ([]domain.DefaultQuestion, error) {
	out := []domain.DefaultQuestion{}
	for _, d := range f.defaults {
		if stage == "" || d.StageKind == stage {
			out = append(out, d)
		}
	}
	return out, nil
}
func (f *orchFakeQuestionRepo) CreateDefaultQuestion(_ context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) {
	return q, nil
}
func (f *orchFakeQuestionRepo) UpdateDefaultQuestion(_ context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) {
	return q, nil
}
func (f *orchFakeQuestionRepo) DeleteDefaultQuestion(context.Context, uuid.UUID) error { return nil }
func (f *orchFakeQuestionRepo) ListCompanyQuestions(_ context.Context, _ uuid.UUID, stage domain.StageKind) ([]domain.CompanyQuestion, error) {
	out := []domain.CompanyQuestion{}
	for _, c := range f.company {
		if stage == "" || c.StageKind == stage {
			out = append(out, c)
		}
	}
	return out, nil
}
func (f *orchFakeQuestionRepo) CreateCompanyQuestion(_ context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) {
	return q, nil
}
func (f *orchFakeQuestionRepo) UpdateCompanyQuestion(_ context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) {
	return q, nil
}
func (f *orchFakeQuestionRepo) DeleteCompanyQuestion(context.Context, uuid.UUID) error { return nil }

// fakeAttempts — in-memory attempt store with per-attempt question
// metadata so GetWithQuestion works.
type fakeAttempts struct {
	rows     map[uuid.UUID]domain.PipelineAttempt
	byStage  map[uuid.UUID][]uuid.UUID
	question map[uuid.UUID]domain.AttemptWithQuestion // attemptID → question fields
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
	a.UserExcalidrawImageURL = in.ImageDataURL
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

// fakePipelines — in-memory store for orchestrator tests.
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

// fakePipelineStages — in-memory store with all the orchestrator helpers.
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
func (f *fakePipelineStages) UpdateStartStage(_ context.Context, id uuid.UUID, profileID uuid.UUID) error {
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

// fakeStrictnessResolver — returns a single canned profile.
type fakeStrictnessResolver struct {
	profile domain.AIStrictnessProfile
	err     error
}

func (f *fakeStrictnessResolver) ResolveStrictness(context.Context, uuid.UUID, *uuid.UUID, domain.StageKind) (domain.AIStrictnessProfile, error) {
	return f.profile, f.err
}

// fakeJudge — canned JudgeOutput, optional callback to capture inputs.
type fakeJudge struct {
	out  JudgeOutput
	err  error
	last *JudgeInput
}

func (f *fakeJudge) JudgeAnswer(_ context.Context, in JudgeInput) (JudgeOutput, error) {
	cp := in
	f.last = &cp
	return f.out, f.err
}

// helper: build a basic orchestrator with empty stores.
func newTestOrchestrator() (*Orchestrator, *fakePipelines, *fakePipelineStages, *fakeAttempts, *orchFakeQuestionRepo, *fakeStrictnessResolver, *fakeJudge) {
	o, pipes, stages, atts, qs, res, jdg, _, _ := newTestOrchestratorFull()
	return o, pipes, stages, atts, qs, res, jdg
}

// newTestOrchestratorFull also exposes the Tasks fake + CompanyStages fake
// for Phase C tests that need to seed task pools / language pools.
func newTestOrchestratorFull() (*Orchestrator, *fakePipelines, *fakePipelineStages, *fakeAttempts, *orchFakeQuestionRepo, *fakeStrictnessResolver, *fakeJudge, *fakeTaskRepo, *fakeCompanyStageRepo) {
	pipes := newFakePipelines()
	stages := newFakePipelineStages()
	atts := newFakeAttempts()
	qs := &orchFakeQuestionRepo{}
	tasks := &fakeTaskRepo{rows: map[uuid.UUID]domain.MockTask{}}
	cs := &fakeCompanyStageRepo{}
	res := &fakeStrictnessResolver{profile: domain.AIStrictnessProfile{ID: uuid.New(), Slug: "default", OffTopicPenalty: 0.30}}
	jdg := &fakeJudge{}
	o := &Orchestrator{
		Pipelines:      pipes,
		PipelineStages: stages,
		Attempts:       atts,
		Questions:      qs,
		Tasks:          tasks,
		CompanyStages:  cs,
		Strictness:     res,
		Judge:          jdg,
		Now:            func() time.Time { return time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC) },
	}
	return o, pipes, stages, atts, qs, res, jdg, tasks, cs
}

// ── tests ───────────────────────────────────────────────────────────────

func TestStartNextStage_HR_MaterializesQuestions(t *testing.T) {
	o, pipes, stages, atts, qs, res, _ := newTestOrchestrator()

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress,
	}
	stageID := uuid.New()
	st := domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageHR,
		Ordinal: 0, Status: domain.StageStatusPending,
	}
	stages.rows[stageID] = st
	stages.byPipeline[pipeID] = []uuid.UUID{stageID}

	qs.defaults = []domain.DefaultQuestion{
		{ID: uuid.New(), StageKind: domain.StageHR, Body: "Расскажи о себе"},
		{ID: uuid.New(), StageKind: domain.StageHR, Body: "Почему мы?"},
	}

	out, err := o.StartNextStage(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("StartNextStage: %v", err)
	}
	if out.Stage.Status != domain.StageStatusInProgress {
		t.Errorf("stage.Status=%s, want in_progress", out.Stage.Status)
	}
	if out.Stage.AIStrictnessProfileID == nil || *out.Stage.AIStrictnessProfileID != res.profile.ID {
		t.Errorf("strictness profile not snapshotted")
	}
	if len(out.Attempts) != 2 {
		t.Fatalf("want 2 attempts, got %d", len(out.Attempts))
	}
	if len(atts.byStage[stageID]) != 2 {
		t.Errorf("repo expected 2 attempts, got %d", len(atts.byStage[stageID]))
	}
	for _, a := range out.Attempts {
		if a.Attempt.Kind != domain.AttemptQuestionAnswer {
			t.Errorf("kind=%s, want question_answer", a.Attempt.Kind)
		}
		if a.Attempt.AIVerdict != domain.AttemptVerdictPending {
			t.Errorf("verdict=%s, want pending", a.Attempt.AIVerdict)
		}
		if a.QuestionBody == "" {
			t.Errorf("expected question body in view")
		}
	}
}

func TestSubmitAnswer_RoutesToJudge_StoresResult(t *testing.T) {
	o, pipes, stages, atts, _, _, jdg := newTestOrchestrator()

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress}
	stageID := uuid.New()
	profID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageHR,
		Status: domain.StageStatusInProgress, AIStrictnessProfileID: &profID,
	}
	attID := uuid.New()
	atts.rows[attID] = domain.PipelineAttempt{
		ID: attID, PipelineStageID: stageID, Kind: domain.AttemptQuestionAnswer,
		AIVerdict: domain.AttemptVerdictPending,
	}
	atts.byStage[stageID] = []uuid.UUID{attID}
	atts.question[attID] = domain.AttemptWithQuestion{
		QuestionBody: "Расскажи о себе",
	}

	jdg.out = JudgeOutput{
		Score:         85,
		Verdict:       domain.AttemptVerdictPass,
		Feedback:      "Хороший ответ",
		WaterScore:    10,
		MissingPoints: []string{"больше деталей"},
	}

	out, err := o.SubmitAnswer(context.Background(), attID, "Я Senior Go разработчик")
	if err != nil {
		t.Fatalf("SubmitAnswer: %v", err)
	}
	if out.AIScore == nil || *out.AIScore != 85 {
		t.Errorf("score not stored: %+v", out.AIScore)
	}
	if out.AIVerdict != domain.AttemptVerdictPass {
		t.Errorf("verdict=%s, want pass", out.AIVerdict)
	}
	if out.UserAnswerMD == "" {
		t.Errorf("user answer not persisted")
	}
	if jdg.last == nil || jdg.last.UserAnswer == "" {
		t.Errorf("judge wasn't called with the user answer")
	}
}

func TestFinishStage_AggregatesScore_SetsVerdict(t *testing.T) {
	o, pipes, stages, atts, _, _, _ := newTestOrchestrator()
	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, Verdict: domain.PipelineInProgress}
	stageID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, Status: domain.StageStatusInProgress,
		StageKind: domain.StageHR,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{stageID}

	scores := []float32{80, 60, 90}
	for _, s := range scores {
		sc := s
		id := uuid.New()
		atts.rows[id] = domain.PipelineAttempt{
			ID: id, PipelineStageID: stageID,
			AIVerdict: domain.AttemptVerdictPass, AIScore: &sc,
		}
		atts.byStage[stageID] = append(atts.byStage[stageID], id)
	}

	out, err := o.FinishStage(context.Background(), stageID)
	if err != nil {
		t.Fatalf("FinishStage: %v", err)
	}
	if out.Score == nil {
		t.Fatalf("score nil")
	}
	if *out.Score < 76 || *out.Score > 77 {
		t.Errorf("score %v not in [76,77]", *out.Score)
	}
	if out.Verdict == nil || *out.Verdict != domain.StageVerdictPass {
		t.Errorf("verdict want pass got %v", out.Verdict)
	}
}

func TestFinishPipeline_AllStagesPass_PassesOverall(t *testing.T) {
	o, pipes, stages, _, _, _, _ := newTestOrchestrator()
	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, Verdict: domain.PipelineInProgress}
	for i := 0; i < 5; i++ {
		sid := uuid.New()
		sc := float32(80)
		v := domain.StageVerdictPass
		stages.rows[sid] = domain.PipelineStage{
			ID: sid, PipelineID: pipeID, Ordinal: i,
			Status: domain.StageStatusFinished, Score: &sc, Verdict: &v,
		}
		stages.byPipeline[pipeID] = append(stages.byPipeline[pipeID], sid)
	}
	out, err := o.FinishPipeline(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("FinishPipeline: %v", err)
	}
	if out.Verdict != domain.PipelinePass {
		t.Errorf("verdict=%s, want pass", out.Verdict)
	}
	if out.TotalScore == nil || *out.TotalScore != 80 {
		t.Errorf("total_score=%v, want 80", out.TotalScore)
	}
}

func TestFinishPipeline_OneStageFails_FailsOverall(t *testing.T) {
	o, pipes, stages, _, _, _, _ := newTestOrchestrator()
	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, Verdict: domain.PipelineInProgress}
	verdicts := []domain.StageVerdict{
		domain.StageVerdictPass, domain.StageVerdictPass,
		domain.StageVerdictPass, domain.StageVerdictPass, domain.StageVerdictFail,
	}
	for i, v := range verdicts {
		sid := uuid.New()
		sc := float32(70)
		vc := v
		stages.rows[sid] = domain.PipelineStage{
			ID: sid, PipelineID: pipeID, Ordinal: i,
			Status: domain.StageStatusFinished, Score: &sc, Verdict: &vc,
		}
		stages.byPipeline[pipeID] = append(stages.byPipeline[pipeID], sid)
	}
	out, err := o.FinishPipeline(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("FinishPipeline: %v", err)
	}
	if out.Verdict != domain.PipelineFail {
		t.Errorf("verdict=%s, want fail", out.Verdict)
	}
}

func TestCancelPipeline_OwnerOnly(t *testing.T) {
	o, pipes, _, _, _, _, _ := newTestOrchestrator()
	pipeID := uuid.New()
	owner := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: owner, Verdict: domain.PipelineInProgress}

	// Non-owner is rejected.
	if err := o.CancelPipeline(context.Background(), pipeID, uuid.New()); err == nil {
		t.Errorf("expected error for non-owner")
	} else if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}

	// Owner succeeds.
	if err := o.CancelPipeline(context.Background(), pipeID, owner); err != nil {
		t.Fatalf("owner cancel: %v", err)
	}
	if pipes.rows[pipeID].Verdict != domain.PipelineCancelled {
		t.Errorf("verdict=%s, want cancelled", pipes.rows[pipeID].Verdict)
	}
}

// belt-and-braces: fakeCompanyStageRepo from handlers_test.go satisfies the
// interface but it lives there — guard via compile-time assertion here.
var _ = strings.TrimSpace

// ── Phase C.1 — algo / coding orchestrator ──────────────────────────────

func TestStartNextStage_Algo_PicksTaskAndCreatesAttempts(t *testing.T) {
	o, pipes, stages, atts, qs, _, _, tasks, _ := newTestOrchestratorFull()

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress,
	}
	stageID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageAlgo,
		Ordinal: 0, Status: domain.StageStatusPending,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{stageID}

	taskID := uuid.New()
	tasks.rows[taskID] = domain.MockTask{
		ID: taskID, StageKind: domain.StageAlgo, Language: domain.LangGo,
		Title: "Two Sum", BodyMD: "Найди пару чисел…", Active: true,
	}
	q1, q2 := uuid.New(), uuid.New()
	qs.taskQs = map[uuid.UUID][]domain.TaskQuestion{
		taskID: {
			{ID: q1, TaskID: taskID, Body: "Какова сложность?"},
			{ID: q2, TaskID: taskID, Body: "Edge cases?"},
		},
	}

	out, err := o.StartNextStage(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("StartNextStage: %v", err)
	}
	if len(out.Attempts) != 3 {
		t.Fatalf("want 3 attempts (1 task_solve + 2 question_answer), got %d", len(out.Attempts))
	}
	// First must be task_solve.
	if out.Attempts[0].Attempt.Kind != domain.AttemptTaskSolve {
		t.Errorf("first attempt kind=%s, want task_solve", out.Attempts[0].Attempt.Kind)
	}
	if out.Attempts[0].Attempt.TaskID == nil || *out.Attempts[0].Attempt.TaskID != taskID {
		t.Errorf("task_solve missing task_id")
	}
	// Followups are question_answer + carry both task_id and task_question_id.
	for _, a := range out.Attempts[1:] {
		if a.Attempt.Kind != domain.AttemptQuestionAnswer {
			t.Errorf("follow-up kind=%s, want question_answer", a.Attempt.Kind)
		}
		if a.Attempt.TaskID == nil || *a.Attempt.TaskID != taskID {
			t.Errorf("follow-up missing task_id")
		}
		if a.Attempt.TaskQuestionID == nil {
			t.Errorf("follow-up missing task_question_id")
		}
	}
	if len(atts.byStage[stageID]) != 3 {
		t.Errorf("repo expected 3 attempts, got %d", len(atts.byStage[stageID]))
	}
}

func TestStartNextStage_Algo_NoTasksAvailable_ErrNoTaskAvailable(t *testing.T) {
	o, pipes, stages, _, _, _, _, _, _ := newTestOrchestratorFull()

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress}
	stageID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageAlgo,
		Status: domain.StageStatusPending,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{stageID}

	_, err := o.StartNextStage(context.Background(), pipeID)
	if err == nil || !errors.Is(err, domain.ErrNoTaskAvailable) {
		t.Fatalf("want ErrNoTaskAvailable, got %v", err)
	}
}

func TestStartNextStage_Coding_RespectsLanguagePool(t *testing.T) {
	o, pipes, stages, _, _, _, _, tasks, cs := newTestOrchestratorFull()

	companyID := uuid.New()
	cs.rows = map[uuid.UUID][]domain.CompanyStage{
		companyID: {{
			CompanyID: companyID, StageKind: domain.StageCoding, Ordinal: 0,
			LanguagePool: []domain.TaskLanguage{domain.LangGo},
		}},
	}

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), CompanyID: &companyID,
		Verdict: domain.PipelineInProgress,
	}
	stageID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageCoding,
		Status: domain.StageStatusPending,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{stageID}

	pyID, goID := uuid.New(), uuid.New()
	tasks.rows[pyID] = domain.MockTask{ID: pyID, StageKind: domain.StageCoding, Language: domain.LangPython, Active: true, Title: "Py"}
	tasks.rows[goID] = domain.MockTask{ID: goID, StageKind: domain.StageCoding, Language: domain.LangGo, Active: true, Title: "Go"}

	out, err := o.StartNextStage(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("StartNextStage: %v", err)
	}
	if len(out.Attempts) == 0 || out.Attempts[0].Attempt.TaskID == nil {
		t.Fatalf("no task_solve attempt produced")
	}
	if *out.Attempts[0].Attempt.TaskID != goID {
		t.Errorf("picked taskID=%s, want goID=%s (language_pool=[go] should exclude python)", *out.Attempts[0].Attempt.TaskID, goID)
	}
}

// ── Phase D.1 — sysdesign orchestrator + canvas submit ─────────────────

// fakeCanvasJudge implements both JudgeClient and CanvasJudgeClient so
// the SubmitCanvas test can exercise the full orchestrator path.
type fakeCanvasJudge struct {
	*fakeJudge
	canvasOut JudgeOutput
	canvasErr error
	lastCv    *JudgeCanvasInput
}

func (f *fakeCanvasJudge) JudgeCanvas(_ context.Context, in JudgeCanvasInput) (JudgeOutput, error) {
	cp := in
	f.lastCv = &cp
	return f.canvasOut, f.canvasErr
}

// 1×1 transparent PNG as a valid data URL — passes decodeDataURL without
// dragging an image library into the test deps.
const tinyPNGDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="

func TestStartNextStage_SysDesign_PicksTaskAndCreatesAttempts(t *testing.T) {
	o, pipes, stages, atts, qs, _, _, tasks, _ := newTestOrchestratorFull()

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress,
	}
	stageID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageSysDesign,
		Ordinal: 0, Status: domain.StageStatusPending,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{stageID}

	taskID := uuid.New()
	tasks.rows[taskID] = domain.MockTask{
		ID: taskID, StageKind: domain.StageSysDesign, Language: domain.LangAny,
		Title: "URL shortener", BodyMD: "Спроектируй tiny-url",
		FunctionalRequirementsMD: "writes:1k/s, reads:100k/s",
		Active:                   true,
	}
	q1, q2 := uuid.New(), uuid.New()
	qs.taskQs = map[uuid.UUID][]domain.TaskQuestion{
		taskID: {
			{ID: q1, TaskID: taskID, Body: "Почему такая БД?"},
			{ID: q2, TaskID: taskID, Body: "Как масштабируешь?"},
		},
	}

	out, err := o.StartNextStage(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("StartNextStage: %v", err)
	}
	if len(out.Attempts) != 3 {
		t.Fatalf("want 3 attempts (1 sysdesign_canvas + 2 question_answer), got %d", len(out.Attempts))
	}
	if out.Attempts[0].Attempt.Kind != domain.AttemptSysDesignCanvas {
		t.Errorf("first attempt kind=%s, want sysdesign_canvas", out.Attempts[0].Attempt.Kind)
	}
	if out.Attempts[0].Attempt.TaskID == nil || *out.Attempts[0].Attempt.TaskID != taskID {
		t.Errorf("sysdesign_canvas missing task_id")
	}
	for _, a := range out.Attempts[1:] {
		if a.Attempt.Kind != domain.AttemptQuestionAnswer {
			t.Errorf("follow-up kind=%s, want question_answer", a.Attempt.Kind)
		}
		if a.Attempt.TaskQuestionID == nil {
			t.Errorf("follow-up missing task_question_id")
		}
	}
	if len(atts.byStage[stageID]) != 3 {
		t.Errorf("repo expected 3 attempts, got %d", len(atts.byStage[stageID]))
	}
}

func TestSubmitCanvas_RoutesToVisionJudge_StoresResult(t *testing.T) {
	o, pipes, stages, atts, _, _, _, tasks, _ := newTestOrchestratorFull()

	owner := uuid.New()
	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: owner, Verdict: domain.PipelineInProgress}
	stageID := uuid.New()
	profID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageSysDesign,
		Status: domain.StageStatusInProgress, AIStrictnessProfileID: &profID,
	}
	taskID := uuid.New()
	tasks.rows[taskID] = domain.MockTask{
		ID: taskID, StageKind: domain.StageSysDesign,
		Title: "URL shortener", FunctionalRequirementsMD: "writes:1k/s",
		ReferenceSolutionMD: "use cassandra + cdn", Active: true,
	}
	attID := uuid.New()
	atts.rows[attID] = domain.PipelineAttempt{
		ID: attID, PipelineStageID: stageID, Kind: domain.AttemptSysDesignCanvas,
		TaskID: &taskID, AIVerdict: domain.AttemptVerdictPending,
	}
	atts.byStage[stageID] = []uuid.UUID{attID}

	cj := &fakeCanvasJudge{
		fakeJudge: &fakeJudge{},
		canvasOut: JudgeOutput{
			Score: 78, Verdict: domain.AttemptVerdictPass,
			Feedback: "Хороший дизайн", MissingPoints: []string{"кэш не описан"},
		},
	}
	o.Judge = cj

	out, err := o.SubmitCanvas(context.Background(), SubmitCanvasInput{
		AttemptID: attID, UserID: owner,
		ImageDataURL:    tinyPNGDataURL,
		ContextMD:       "Cassandra потому что write-heavy",
		NonFunctionalMD: "p99 < 100ms",
	})
	if err != nil {
		t.Fatalf("SubmitCanvas: %v", err)
	}
	if out.AIScore == nil || *out.AIScore != 78 {
		t.Errorf("score not stored: %+v", out.AIScore)
	}
	if out.AIVerdict != domain.AttemptVerdictPass {
		t.Errorf("verdict=%s, want pass", out.AIVerdict)
	}
	if out.UserExcalidrawImageURL != tinyPNGDataURL {
		t.Errorf("image url not persisted")
	}
	if out.UserContextMD == "" {
		t.Errorf("context_md not persisted")
	}
	if !strings.Contains(out.UserAnswerMD, "Non-functional requirements") {
		t.Errorf("non_functional_md not collapsed into user_answer_md: %q", out.UserAnswerMD)
	}
	if cj.lastCv == nil {
		t.Fatalf("canvas judge not invoked")
	}
	if !strings.Contains(cj.lastCv.TaskBody, "URL shortener") {
		t.Errorf("task body not forwarded to judge")
	}
	if cj.lastCv.FunctionalRequirementsMD != "writes:1k/s" {
		t.Errorf("functional reqs not forwarded")
	}
}

func TestSubmitCanvas_OwnerMismatch_ErrNotFound(t *testing.T) {
	o, pipes, stages, atts, _, _, _, tasks, _ := newTestOrchestratorFull()

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress}
	stageID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{ID: stageID, PipelineID: pipeID, StageKind: domain.StageSysDesign, Status: domain.StageStatusInProgress}
	taskID := uuid.New()
	tasks.rows[taskID] = domain.MockTask{ID: taskID, StageKind: domain.StageSysDesign, Active: true}
	attID := uuid.New()
	atts.rows[attID] = domain.PipelineAttempt{
		ID: attID, PipelineStageID: stageID, Kind: domain.AttemptSysDesignCanvas, TaskID: &taskID,
	}

	o.Judge = &fakeCanvasJudge{fakeJudge: &fakeJudge{}}
	_, err := o.SubmitCanvas(context.Background(), SubmitCanvasInput{
		AttemptID: attID, UserID: uuid.New(), // not owner
		ImageDataURL: tinyPNGDataURL,
	})
	if err == nil || !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound on non-owner, got %v", err)
	}
}

func TestStartNextStage_Algo_RespectsTaskPoolIDs(t *testing.T) {
	o, pipes, stages, _, _, _, _, tasks, cs := newTestOrchestratorFull()

	companyID := uuid.New()
	allowedID, otherID := uuid.New(), uuid.New()
	cs.rows = map[uuid.UUID][]domain.CompanyStage{
		companyID: {{
			CompanyID: companyID, StageKind: domain.StageAlgo,
			TaskPoolIDs: []uuid.UUID{allowedID},
		}},
	}

	pipeID := uuid.New()
	pipes.rows[pipeID] = domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), CompanyID: &companyID,
		Verdict: domain.PipelineInProgress,
	}
	stageID := uuid.New()
	stages.rows[stageID] = domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageAlgo,
		Status: domain.StageStatusPending,
	}
	stages.byPipeline[pipeID] = []uuid.UUID{stageID}

	tasks.rows[allowedID] = domain.MockTask{ID: allowedID, StageKind: domain.StageAlgo, Active: true, Title: "Allowed"}
	tasks.rows[otherID] = domain.MockTask{ID: otherID, StageKind: domain.StageAlgo, Active: true, Title: "Other"}

	out, err := o.StartNextStage(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("StartNextStage: %v", err)
	}
	if *out.Attempts[0].Attempt.TaskID != allowedID {
		t.Errorf("picked %s, want %s (only allowed in task_pool_ids)", *out.Attempts[0].Attempt.TaskID, allowedID)
	}
}
