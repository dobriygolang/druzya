// orchestrator_test.go — Orchestrator coverage backed by mockgen.
//
// State that crosses repo boundaries (pipelines ↔ stages ↔ attempts ↔
// taskQs) lives in one shared `orchStore`; mocks delegate via thin
// DoAndReturn closures. Scripted Judge / Strictness responses use
// callIdx-based scripts.
package app

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"druz9/mock_interview/domain"
	dmocks "druz9/mock_interview/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── shared orchestrator store ──────────────────────────────────────────
//
// orchStore consolidates state that the orchestrator mutates through
// multiple repos. Each repo mock's DoAndReturn closure reads/writes here
// under a single mutex so cross-repo invariants hold (e.g. UpdateVerdict
// writes a pipeline row that a subsequent Get reads).
type orchStore struct {
	mu sync.Mutex

	// pipelines
	pipelines map[uuid.UUID]domain.MockPipeline

	// pipeline_stages
	stages          map[uuid.UUID]domain.PipelineStage
	stagesByPipe    map[uuid.UUID][]uuid.UUID
	stagesInsertOrd []uuid.UUID

	// pipeline_attempts
	attempts        map[uuid.UUID]domain.PipelineAttempt
	attemptsByStage map[uuid.UUID][]uuid.UUID
	attemptQuestion map[uuid.UUID]domain.AttemptWithQuestion

	// task_questions (taskID → []TaskQuestion)
	taskQs map[uuid.UUID][]domain.TaskQuestion
	// default_questions (StageKind → []DefaultQuestion)
	defaultQs map[domain.StageKind][]domain.DefaultQuestion
	// company_questions (StageKind → []CompanyQuestion)
	companyQs map[domain.StageKind][]domain.CompanyQuestion
}

func newOrchStore() *orchStore {
	return &orchStore{
		pipelines:       map[uuid.UUID]domain.MockPipeline{},
		stages:          map[uuid.UUID]domain.PipelineStage{},
		stagesByPipe:    map[uuid.UUID][]uuid.UUID{},
		attempts:        map[uuid.UUID]domain.PipelineAttempt{},
		attemptsByStage: map[uuid.UUID][]uuid.UUID{},
		attemptQuestion: map[uuid.UUID]domain.AttemptWithQuestion{},
		taskQs:          map[uuid.UUID][]domain.TaskQuestion{},
		defaultQs:       map[domain.StageKind][]domain.DefaultQuestion{},
		companyQs:       map[domain.StageKind][]domain.CompanyQuestion{},
	}
}

// ── seeders (test-side; lock-aware) ────────────────────────────────────

func (s *orchStore) seedPipeline(p domain.MockPipeline) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pipelines[p.ID] = p
}

func (s *orchStore) seedStage(st domain.PipelineStage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stages[st.ID] = st
	s.stagesByPipe[st.PipelineID] = append(s.stagesByPipe[st.PipelineID], st.ID)
}

func (s *orchStore) seedAttempt(a domain.PipelineAttempt) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attempts[a.ID] = a
	s.attemptsByStage[a.PipelineStageID] = append(s.attemptsByStage[a.PipelineStageID], a.ID)
}

func (s *orchStore) seedAttemptQuestion(id uuid.UUID, q domain.AttemptWithQuestion) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attemptQuestion[id] = q
}

func (s *orchStore) seedTaskQuestions(taskID uuid.UUID, qs []domain.TaskQuestion) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.taskQs[taskID] = qs
}

func (s *orchStore) seedDefaultQuestions(stage domain.StageKind, qs []domain.DefaultQuestion) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.defaultQs[stage] = qs
}

func (s *orchStore) getPipeline(id uuid.UUID) (domain.MockPipeline, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.pipelines[id]
	return p, ok
}

// ── mock wirings ───────────────────────────────────────────────────────

func wireOrchPipelineRepo(ctrl *gomock.Controller, s *orchStore) *dmocks.MockPipelineRepo {
	m := dmocks.NewMockPipelineRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p domain.MockPipeline) (domain.MockPipeline, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.pipelines[p.ID] = p
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.MockPipeline, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			p, ok := s.pipelines[id]
			if !ok {
				return domain.MockPipeline{}, domain.ErrNotFound
			}
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().ListByUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().UpdateVerdict(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, v domain.PipelineVerdict, ts *float32) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			p, ok := s.pipelines[id]
			if !ok {
				return domain.ErrNotFound
			}
			p.Verdict = v
			p.TotalScore = ts
			now := time.Now().UTC()
			p.FinishedAt = &now
			s.pipelines[id] = p
			return nil
		},
	).AnyTimes()
	m.EXPECT().IncrementStageIdx(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (int, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			p, ok := s.pipelines[id]
			if !ok {
				return 0, domain.ErrNotFound
			}
			p.CurrentStageIdx++
			s.pipelines[id] = p
			return p.CurrentStageIdx, nil
		},
	).AnyTimes()
	return m
}

func wireOrchPipelineStageRepo(ctrl *gomock.Controller, s *orchStore) *dmocks.MockPipelineStageRepo {
	m := dmocks.NewMockPipelineStageRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, st domain.PipelineStage) (domain.PipelineStage, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.stages[st.ID] = st
			s.stagesByPipe[st.PipelineID] = append(s.stagesByPipe[st.PipelineID], st.ID)
			return st, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.PipelineStage, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			st, ok := s.stages[id]
			if !ok {
				return domain.PipelineStage{}, domain.ErrNotFound
			}
			return st, nil
		},
	).AnyTimes()
	m.EXPECT().ListByPipeline(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) ([]domain.PipelineStage, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			ids := s.stagesByPipe[id]
			out := make([]domain.PipelineStage, 0, len(ids))
			for _, sid := range ids {
				out = append(out, s.stages[sid])
			}
			return out, nil
		},
	).AnyTimes()
	m.EXPECT().UpdateStatus(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, st domain.StageStatus) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			row, ok := s.stages[id]
			if !ok {
				return domain.ErrNotFound
			}
			row.Status = st
			s.stages[id] = row
			return nil
		},
	).AnyTimes()
	m.EXPECT().UpdateStartStage(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, profileID uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			row, ok := s.stages[id]
			if !ok {
				return domain.ErrNotFound
			}
			if row.Status == domain.StageStatusPending {
				row.Status = domain.StageStatusInProgress
			}
			if row.StartedAt == nil {
				t := time.Now().UTC()
				row.StartedAt = &t
			}
			if row.AIStrictnessProfileID == nil {
				pid := profileID
				row.AIStrictnessProfileID = &pid
			}
			s.stages[id] = row
			return nil
		},
	).AnyTimes()
	m.EXPECT().FinishStage(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, score float32, verdict domain.StageVerdict, feedback string) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			row, ok := s.stages[id]
			if !ok {
				return domain.ErrNotFound
			}
			row.Status = domain.StageStatusFinished
			sc := score
			v := verdict
			row.Score = &sc
			row.Verdict = &v
			row.AIFeedbackMD = feedback
			now := time.Now().UTC()
			row.FinishedAt = &now
			s.stages[id] = row
			return nil
		},
	).AnyTimes()
	return m
}

func wireOrchAttemptRepo(ctrl *gomock.Controller, s *orchStore) *dmocks.MockPipelineAttemptRepo {
	m := dmocks.NewMockPipelineAttemptRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, a domain.PipelineAttempt) (domain.PipelineAttempt, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.attempts[a.ID] = a
			s.attemptsByStage[a.PipelineStageID] = append(s.attemptsByStage[a.PipelineStageID], a.ID)
			return a, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.PipelineAttempt, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			a, ok := s.attempts[id]
			if !ok {
				return domain.PipelineAttempt{}, domain.ErrNotFound
			}
			return a, nil
		},
	).AnyTimes()
	m.EXPECT().ListByStage(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, stageID uuid.UUID) ([]domain.PipelineAttempt, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			ids := s.attemptsByStage[stageID]
			out := make([]domain.PipelineAttempt, 0, len(ids))
			for _, id := range ids {
				out = append(out, s.attempts[id])
			}
			return out, nil
		},
	).AnyTimes()
	m.EXPECT().UpdateJudgeResult(
		gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(),
		gomock.Any(), gomock.Any(), gomock.Any(),
	).DoAndReturn(
		func(_ context.Context, id uuid.UUID, userAnswerMD string,
			score float32, water float32, verdict domain.AttemptVerdict,
			feedback string, missing []string) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			a, ok := s.attempts[id]
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
			s.attempts[id] = a
			return nil
		},
	).AnyTimes()
	m.EXPECT().UpdateCanvasResult(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, in domain.CanvasResultUpdate) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			a, ok := s.attempts[id]
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
			s.attempts[id] = a
			return nil
		},
	).AnyTimes()
	m.EXPECT().GetWithQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.AttemptWithQuestion, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			a, ok := s.attempts[id]
			if !ok {
				return domain.AttemptWithQuestion{}, domain.ErrNotFound
			}
			q, ok := s.attemptQuestion[id]
			if !ok {
				return domain.AttemptWithQuestion{Attempt: a}, nil
			}
			q.Attempt = a
			return q, nil
		},
	).AnyTimes()
	return m
}

func wireOrchQuestionRepo(ctrl *gomock.Controller, s *orchStore) *dmocks.MockQuestionRepo {
	m := dmocks.NewMockQuestionRepo(ctrl)
	m.EXPECT().ListTaskQuestions(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, taskID uuid.UUID) ([]domain.TaskQuestion, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.taskQs[taskID], nil
		},
	).AnyTimes()
	m.EXPECT().CreateTaskQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().UpdateTaskQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().DeleteTaskQuestion(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().ListDefaultQuestions(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, stage domain.StageKind, _ bool) ([]domain.DefaultQuestion, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if stage == "" {
				out := []domain.DefaultQuestion{}
				for _, qs := range s.defaultQs {
					out = append(out, qs...)
				}
				return out, nil
			}
			return s.defaultQs[stage], nil
		},
	).AnyTimes()
	m.EXPECT().CreateDefaultQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().UpdateDefaultQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().DeleteDefaultQuestion(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().SampleDefaultQuestions(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, stage domain.StageKind, limit int) ([]domain.DefaultQuestion, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			all := s.defaultQs[stage]
			if limit <= 0 || limit >= len(all) {
				return all, nil
			}
			return all[:limit], nil
		},
	).AnyTimes()
	m.EXPECT().ListCompanyQuestions(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, stage domain.StageKind) ([]domain.CompanyQuestion, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.companyQs[stage], nil
		},
	).AnyTimes()
	m.EXPECT().SampleCompanyQuestions(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, stage domain.StageKind, limit int) ([]domain.CompanyQuestion, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			all := s.companyQs[stage]
			if limit <= 0 || limit >= len(all) {
				return all, nil
			}
			return all[:limit], nil
		},
	).AnyTimes()
	m.EXPECT().CreateCompanyQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().UpdateCompanyQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().DeleteCompanyQuestion(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	return m
}

// ── orchestrator-side mocks (Judge + Strictness — generated into package app) ──

// wireOrchStrictness returns a resolver that yields the canned profile.
// Profile is captured by reference so callers can mutate fields after
// construction; tests use this to seed a profile ID before StartNextStage.
type strictnessHandle struct {
	mu      sync.Mutex
	profile domain.AIStrictnessProfile
	err     error
}

func newStrictnessHandle() *strictnessHandle {
	return &strictnessHandle{
		profile: domain.AIStrictnessProfile{
			ID:              uuid.New(),
			Slug:            "default",
			OffTopicPenalty: 0.30,
		},
	}
}

func wireOrchStrictness(ctrl *gomock.Controller, h *strictnessHandle) *MockStrictnessResolver {
	m := NewMockStrictnessResolver(ctrl)
	m.EXPECT().ResolveStrictness(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ *uuid.UUID, _ domain.StageKind) (domain.AIStrictnessProfile, error) {
			h.mu.Lock()
			defer h.mu.Unlock()
			return h.profile, h.err
		},
	).AnyTimes()
	return m
}

// judgeHandle — capture the last JudgeInput and serve a canned response.
type judgeHandle struct {
	mu   sync.Mutex
	out  JudgeOutput
	err  error
	last *JudgeInput
}

func newJudgeHandle() *judgeHandle { return &judgeHandle{} }

func wireOrchJudge(ctrl *gomock.Controller, h *judgeHandle) *MockJudgeClient {
	m := NewMockJudgeClient(ctrl)
	m.EXPECT().JudgeAnswer(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in JudgeInput) (JudgeOutput, error) {
			h.mu.Lock()
			defer h.mu.Unlock()
			cp := in
			h.last = &cp
			return h.out, h.err
		},
	).AnyTimes()
	return m
}

// canvasJudge — implements BOTH JudgeClient and CanvasJudgeClient. Built
// from two distinct mock types composed under a wrapper so the
// orchestrator's type-assertion in SubmitCanvas succeeds.
type canvasJudge struct {
	*MockJudgeClient
	canvasMock *MockCanvasJudgeClient
}

func (c *canvasJudge) JudgeCanvas(ctx context.Context, in JudgeCanvasInput) (JudgeOutput, error) {
	return c.canvasMock.JudgeCanvas(ctx, in)
}

type canvasJudgeHandle struct {
	mu        sync.Mutex
	canvasOut JudgeOutput
	canvasErr error
	lastCv    *JudgeCanvasInput
}

func newCanvasJudgeHandle() *canvasJudgeHandle { return &canvasJudgeHandle{} }

func wireOrchCanvasJudge(ctrl *gomock.Controller, jh *judgeHandle, ch *canvasJudgeHandle) *canvasJudge {
	plain := wireOrchJudge(ctrl, jh)
	cm := NewMockCanvasJudgeClient(ctrl)
	cm.EXPECT().JudgeCanvas(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in JudgeCanvasInput) (JudgeOutput, error) {
			ch.mu.Lock()
			defer ch.mu.Unlock()
			cp := in
			ch.lastCv = &cp
			return ch.canvasOut, ch.canvasErr
		},
	).AnyTimes()
	return &canvasJudge{MockJudgeClient: plain, canvasMock: cm}
}

// ── orchestrator builder ───────────────────────────────────────────────

// orchFixture bundles store, knobs, and the orchestrator under test. Tests
// seed via store, tune Judge/Strictness via handles, then call Orchestrator
// methods.
type orchFixture struct {
	store      *orchStore
	tasks      *taskStore // declared in test_helpers_test.go
	compStages *compStageStore
	judgeH     *judgeHandle
	strictH    *strictnessHandle
	orch       *Orchestrator
}

func newOrchFixture(t *testing.T) *orchFixture {
	t.Helper()
	ctrl := gomock.NewController(t)
	t.Cleanup(ctrl.Finish)

	store := newOrchStore()
	ts := newTaskStore()
	cs := newCompStageStore()
	strictH := newStrictnessHandle()
	judgeH := newJudgeHandle()

	o := &Orchestrator{
		Pipelines:      wireOrchPipelineRepo(ctrl, store),
		PipelineStages: wireOrchPipelineStageRepo(ctrl, store),
		Attempts:       wireOrchAttemptRepo(ctrl, store),
		Questions:      wireOrchQuestionRepo(ctrl, store),
		Tasks:          wireMockTaskRepo(ctrl, ts),
		CompanyStages:  wireMockCompanyStageRepo(ctrl, cs),
		Strictness:     wireOrchStrictness(ctrl, strictH),
		Judge:          wireOrchJudge(ctrl, judgeH),
		Now:            func() time.Time { return time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC) },
	}
	return &orchFixture{
		store:      store,
		tasks:      ts,
		compStages: cs,
		judgeH:     judgeH,
		strictH:    strictH,
		orch:       o,
	}
}

// ── tests ───────────────────────────────────────────────────────────────

func TestStartNextStage_HR_MaterializesQuestions(t *testing.T) {
	f := newOrchFixture(t)

	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress,
	})
	stageID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageHR,
		Ordinal: 0, Status: domain.StageStatusPending,
	})
	f.store.seedDefaultQuestions(domain.StageHR, []domain.DefaultQuestion{
		{ID: uuid.New(), StageKind: domain.StageHR, Body: "Расскажи о себе"},
		{ID: uuid.New(), StageKind: domain.StageHR, Body: "Почему мы?"},
	})

	out, err := f.orch.StartNextStage(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("StartNextStage: %v", err)
	}
	if out.Stage.Status != domain.StageStatusInProgress {
		t.Errorf("stage.Status=%s, want in_progress", out.Stage.Status)
	}
	if out.Stage.AIStrictnessProfileID == nil || *out.Stage.AIStrictnessProfileID != f.strictH.profile.ID {
		t.Errorf("strictness profile not snapshotted")
	}
	if len(out.Attempts) != 2 {
		t.Fatalf("want 2 attempts, got %d", len(out.Attempts))
	}

	f.store.mu.Lock()
	got := len(f.store.attemptsByStage[stageID])
	f.store.mu.Unlock()
	if got != 2 {
		t.Errorf("repo expected 2 attempts, got %d", got)
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
	f := newOrchFixture(t)

	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress})
	stageID := uuid.New()
	profID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageHR,
		Status: domain.StageStatusInProgress, AIStrictnessProfileID: &profID,
	})
	attID := uuid.New()
	f.store.seedAttempt(domain.PipelineAttempt{
		ID: attID, PipelineStageID: stageID, Kind: domain.AttemptQuestionAnswer,
		AIVerdict: domain.AttemptVerdictPending,
	})
	f.store.seedAttemptQuestion(attID, domain.AttemptWithQuestion{
		QuestionBody: "Расскажи о себе",
	})

	f.judgeH.out = JudgeOutput{
		Score:         85,
		Verdict:       domain.AttemptVerdictPass,
		Feedback:      "Хороший ответ",
		WaterScore:    10,
		MissingPoints: []string{"больше деталей"},
	}

	out, err := f.orch.SubmitAnswer(context.Background(), attID, "Я Senior Go разработчик")
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
	f.judgeH.mu.Lock()
	last := f.judgeH.last
	f.judgeH.mu.Unlock()
	if last == nil || last.UserAnswer == "" {
		t.Errorf("judge wasn't called with the user answer")
	}
}

func TestFinishStage_AggregatesScore_SetsVerdict(t *testing.T) {
	f := newOrchFixture(t)
	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{ID: pipeID, Verdict: domain.PipelineInProgress})
	stageID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, Status: domain.StageStatusInProgress,
		StageKind: domain.StageHR,
	})

	scores := []float32{80, 60, 90}
	for _, s := range scores {
		sc := s
		f.store.seedAttempt(domain.PipelineAttempt{
			ID: uuid.New(), PipelineStageID: stageID,
			AIVerdict: domain.AttemptVerdictPass, AIScore: &sc,
		})
	}

	out, err := f.orch.FinishStage(context.Background(), stageID)
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
	f := newOrchFixture(t)
	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{ID: pipeID, Verdict: domain.PipelineInProgress})
	for i := 0; i < 5; i++ {
		sc := float32(80)
		v := domain.StageVerdictPass
		f.store.seedStage(domain.PipelineStage{
			ID: uuid.New(), PipelineID: pipeID, Ordinal: i,
			Status: domain.StageStatusFinished, Score: &sc, Verdict: &v,
		})
	}
	out, err := f.orch.FinishPipeline(context.Background(), pipeID)
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
	f := newOrchFixture(t)
	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{ID: pipeID, Verdict: domain.PipelineInProgress})
	verdicts := []domain.StageVerdict{
		domain.StageVerdictPass, domain.StageVerdictPass,
		domain.StageVerdictPass, domain.StageVerdictPass, domain.StageVerdictFail,
	}
	for i, v := range verdicts {
		sc := float32(70)
		vc := v
		f.store.seedStage(domain.PipelineStage{
			ID: uuid.New(), PipelineID: pipeID, Ordinal: i,
			Status: domain.StageStatusFinished, Score: &sc, Verdict: &vc,
		})
	}
	out, err := f.orch.FinishPipeline(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("FinishPipeline: %v", err)
	}
	if out.Verdict != domain.PipelineFail {
		t.Errorf("verdict=%s, want fail", out.Verdict)
	}
}

func TestCancelPipeline_OwnerOnly(t *testing.T) {
	f := newOrchFixture(t)
	pipeID := uuid.New()
	owner := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{ID: pipeID, UserID: owner, Verdict: domain.PipelineInProgress})

	// Non-owner is rejected.
	if err := f.orch.CancelPipeline(context.Background(), pipeID, uuid.New()); err == nil {
		t.Errorf("expected error for non-owner")
	} else if !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}

	// Owner succeeds.
	if err := f.orch.CancelPipeline(context.Background(), pipeID, owner); err != nil {
		t.Fatalf("owner cancel: %v", err)
	}
	p, _ := f.store.getPipeline(pipeID)
	if p.Verdict != domain.PipelineCancelled {
		t.Errorf("verdict=%s, want cancelled", p.Verdict)
	}
}

// ── algo / coding orchestrator ─────────────────────────────────────────

func TestStartNextStage_Algo_PicksTaskAndCreatesAttempts(t *testing.T) {
	f := newOrchFixture(t)

	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress,
	})
	stageID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageAlgo,
		Ordinal: 0, Status: domain.StageStatusPending,
	})

	taskID := uuid.New()
	f.tasks.mu.Lock()
	f.tasks.rows[taskID] = domain.MockTask{
		ID: taskID, StageKind: domain.StageAlgo, Language: domain.LangGo,
		Title: "Two Sum", BodyMD: "Найди пару чисел…", Active: true,
	}
	f.tasks.mu.Unlock()
	q1, q2 := uuid.New(), uuid.New()
	f.store.seedTaskQuestions(taskID, []domain.TaskQuestion{
		{ID: q1, TaskID: taskID, Body: "Какова сложность?"},
		{ID: q2, TaskID: taskID, Body: "Edge cases?"},
	})

	out, err := f.orch.StartNextStage(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("StartNextStage: %v", err)
	}
	if len(out.Attempts) != 3 {
		t.Fatalf("want 3 attempts (1 task_solve + 2 question_answer), got %d", len(out.Attempts))
	}
	if out.Attempts[0].Attempt.Kind != domain.AttemptTaskSolve {
		t.Errorf("first attempt kind=%s, want task_solve", out.Attempts[0].Attempt.Kind)
	}
	if out.Attempts[0].Attempt.TaskID == nil || *out.Attempts[0].Attempt.TaskID != taskID {
		t.Errorf("task_solve missing task_id")
	}
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
	f.store.mu.Lock()
	got := len(f.store.attemptsByStage[stageID])
	f.store.mu.Unlock()
	if got != 3 {
		t.Errorf("repo expected 3 attempts, got %d", got)
	}
}

func TestStartNextStage_Algo_NoTasksAvailable_ErrNoTaskAvailable(t *testing.T) {
	f := newOrchFixture(t)

	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress})
	stageID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageAlgo,
		Status: domain.StageStatusPending,
	})

	_, err := f.orch.StartNextStage(context.Background(), pipeID)
	if err == nil || !errors.Is(err, domain.ErrNoTaskAvailable) {
		t.Fatalf("want ErrNoTaskAvailable, got %v", err)
	}
}

func TestStartNextStage_Coding_RespectsLanguagePool(t *testing.T) {
	f := newOrchFixture(t)

	companyID := uuid.New()
	f.compStages.mu.Lock()
	f.compStages.rows[companyID] = []domain.CompanyStage{{
		CompanyID: companyID, StageKind: domain.StageCoding, Ordinal: 0,
		LanguagePool: []domain.TaskLanguage{domain.LangGo},
	}}
	f.compStages.mu.Unlock()

	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), CompanyID: &companyID,
		Verdict: domain.PipelineInProgress,
	})
	stageID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageCoding,
		Status: domain.StageStatusPending,
	})

	pyID, goID := uuid.New(), uuid.New()
	f.tasks.mu.Lock()
	f.tasks.rows[pyID] = domain.MockTask{ID: pyID, StageKind: domain.StageCoding, Language: domain.LangPython, Active: true, Title: "Py"}
	f.tasks.rows[goID] = domain.MockTask{ID: goID, StageKind: domain.StageCoding, Language: domain.LangGo, Active: true, Title: "Go"}
	f.tasks.mu.Unlock()

	out, err := f.orch.StartNextStage(context.Background(), pipeID)
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

// ── sysdesign orchestrator + canvas submit ──────────────────────────────

// 1×1 transparent PNG as a valid data URL — passes decodeDataURL without
// dragging an image library into the test deps.
const tinyPNGDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="

func TestStartNextStage_SysDesign_PicksTaskAndCreatesAttempts(t *testing.T) {
	f := newOrchFixture(t)

	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress,
	})
	stageID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageSysDesign,
		Ordinal: 0, Status: domain.StageStatusPending,
	})

	taskID := uuid.New()
	f.tasks.mu.Lock()
	f.tasks.rows[taskID] = domain.MockTask{
		ID: taskID, StageKind: domain.StageSysDesign, Language: domain.LangAny,
		Title: "URL shortener", BodyMD: "Спроектируй tiny-url",
		FunctionalRequirementsMD: "writes:1k/s, reads:100k/s",
		Active:                   true,
	}
	f.tasks.mu.Unlock()
	q1, q2 := uuid.New(), uuid.New()
	f.store.seedTaskQuestions(taskID, []domain.TaskQuestion{
		{ID: q1, TaskID: taskID, Body: "Почему такая БД?"},
		{ID: q2, TaskID: taskID, Body: "Как масштабируешь?"},
	})

	out, err := f.orch.StartNextStage(context.Background(), pipeID)
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
	f.store.mu.Lock()
	got := len(f.store.attemptsByStage[stageID])
	f.store.mu.Unlock()
	if got != 3 {
		t.Errorf("repo expected 3 attempts, got %d", got)
	}
}

func TestSubmitCanvas_RoutesToVisionJudge_StoresResult(t *testing.T) {
	f := newOrchFixture(t)

	// Replace plain judge with one that also implements CanvasJudgeClient.
	ctrl := gomock.NewController(t)
	t.Cleanup(ctrl.Finish)
	canvasH := newCanvasJudgeHandle()
	canvasH.canvasOut = JudgeOutput{
		Score: 78, Verdict: domain.AttemptVerdictPass,
		Feedback: "Хороший дизайн", MissingPoints: []string{"кэш не описан"},
	}
	f.orch.Judge = wireOrchCanvasJudge(ctrl, f.judgeH, canvasH)

	owner := uuid.New()
	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{ID: pipeID, UserID: owner, Verdict: domain.PipelineInProgress})
	stageID := uuid.New()
	profID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageSysDesign,
		Status: domain.StageStatusInProgress, AIStrictnessProfileID: &profID,
	})
	taskID := uuid.New()
	f.tasks.mu.Lock()
	f.tasks.rows[taskID] = domain.MockTask{
		ID: taskID, StageKind: domain.StageSysDesign,
		Title: "URL shortener", FunctionalRequirementsMD: "writes:1k/s",
		ReferenceSolutionMD: "use cassandra + cdn", Active: true,
	}
	f.tasks.mu.Unlock()
	attID := uuid.New()
	f.store.seedAttempt(domain.PipelineAttempt{
		ID: attID, PipelineStageID: stageID, Kind: domain.AttemptSysDesignCanvas,
		TaskID: &taskID, AIVerdict: domain.AttemptVerdictPending,
	})

	scene := []byte(`{"elements":[],"files":{}}`)
	out, err := f.orch.SubmitCanvas(context.Background(), SubmitCanvasInput{
		AttemptID: attID, UserID: owner,
		ImageDataURL:    tinyPNGDataURL,
		SceneJSON:       scene,
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
	if string(out.UserExcalidrawSceneJSON) != string(scene) {
		t.Errorf("scene JSON not persisted: got %q", string(out.UserExcalidrawSceneJSON))
	}
	if out.UserContextMD == "" {
		t.Errorf("context_md not persisted")
	}
	if !strings.Contains(out.UserAnswerMD, "Non-functional requirements") {
		t.Errorf("non_functional_md not collapsed into user_answer_md: %q", out.UserAnswerMD)
	}
	canvasH.mu.Lock()
	lastCv := canvasH.lastCv
	canvasH.mu.Unlock()
	if lastCv == nil {
		t.Fatalf("canvas judge not invoked")
	}
	if !strings.Contains(lastCv.TaskBody, "URL shortener") {
		t.Errorf("task body not forwarded to judge")
	}
	if lastCv.FunctionalRequirementsMD != "writes:1k/s" {
		t.Errorf("functional reqs not forwarded")
	}
}

func TestSubmitCanvas_OwnerMismatch_ErrNotFound(t *testing.T) {
	f := newOrchFixture(t)

	ctrl := gomock.NewController(t)
	t.Cleanup(ctrl.Finish)
	canvasH := newCanvasJudgeHandle()
	f.orch.Judge = wireOrchCanvasJudge(ctrl, f.judgeH, canvasH)

	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{ID: pipeID, UserID: uuid.New(), Verdict: domain.PipelineInProgress})
	stageID := uuid.New()
	f.store.seedStage(domain.PipelineStage{ID: stageID, PipelineID: pipeID, StageKind: domain.StageSysDesign, Status: domain.StageStatusInProgress})
	taskID := uuid.New()
	f.tasks.mu.Lock()
	f.tasks.rows[taskID] = domain.MockTask{ID: taskID, StageKind: domain.StageSysDesign, Active: true}
	f.tasks.mu.Unlock()
	attID := uuid.New()
	f.store.seedAttempt(domain.PipelineAttempt{
		ID: attID, PipelineStageID: stageID, Kind: domain.AttemptSysDesignCanvas, TaskID: &taskID,
	})

	_, err := f.orch.SubmitCanvas(context.Background(), SubmitCanvasInput{
		AttemptID: attID, UserID: uuid.New(), // not owner
		ImageDataURL: tinyPNGDataURL,
	})
	if err == nil || !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("want ErrNotFound on non-owner, got %v", err)
	}
}

func TestStartNextStage_Algo_RespectsTaskPoolIDs(t *testing.T) {
	f := newOrchFixture(t)

	companyID := uuid.New()
	allowedID, otherID := uuid.New(), uuid.New()
	f.compStages.mu.Lock()
	f.compStages.rows[companyID] = []domain.CompanyStage{{
		CompanyID: companyID, StageKind: domain.StageAlgo,
		TaskPoolIDs: []uuid.UUID{allowedID},
	}}
	f.compStages.mu.Unlock()

	pipeID := uuid.New()
	f.store.seedPipeline(domain.MockPipeline{
		ID: pipeID, UserID: uuid.New(), CompanyID: &companyID,
		Verdict: domain.PipelineInProgress,
	})
	stageID := uuid.New()
	f.store.seedStage(domain.PipelineStage{
		ID: stageID, PipelineID: pipeID, StageKind: domain.StageAlgo,
		Status: domain.StageStatusPending,
	})

	f.tasks.mu.Lock()
	f.tasks.rows[allowedID] = domain.MockTask{ID: allowedID, StageKind: domain.StageAlgo, Active: true, Title: "Allowed"}
	f.tasks.rows[otherID] = domain.MockTask{ID: otherID, StageKind: domain.StageAlgo, Active: true, Title: "Other"}
	f.tasks.mu.Unlock()

	out, err := f.orch.StartNextStage(context.Background(), pipeID)
	if err != nil {
		t.Fatalf("StartNextStage: %v", err)
	}
	if *out.Attempts[0].Attempt.TaskID != allowedID {
		t.Errorf("picked %s, want %s (only allowed in task_pool_ids)", *out.Attempts[0].Attempt.TaskID, allowedID)
	}
}
