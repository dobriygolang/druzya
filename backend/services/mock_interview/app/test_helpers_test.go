package app

import (
	"context"
	"sync"

	"druz9/mock_interview/domain"
	mocks "druz9/mock_interview/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// Shared mockgen-backed helpers for mock_interview tests. Each store
// type holds in-memory state and plugs into a gomock via DoAndReturn
// closures.

// ─── CompanyRepo ─────────────────────────────────────────────────────────

type companyStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.Company
}

func newCompanyStore() *companyStore { return &companyStore{rows: map[uuid.UUID]domain.Company{}} }

func wireMockCompanyRepo(ctrl *gomock.Controller, s *companyStore) *mocks.MockCompanyRepo {
	m := mocks.NewMockCompanyRepo(ctrl)
	m.EXPECT().List(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ bool) ([]domain.Company, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			out := make([]domain.Company, 0, len(s.rows))
			for _, c := range s.rows {
				out = append(out, c)
			}
			return out, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.Company, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			c, ok := s.rows[id]
			if !ok {
				return domain.Company{}, domain.ErrNotFound
			}
			return c, nil
		},
	).AnyTimes()
	m.EXPECT().GetBySlug(gomock.Any(), gomock.Any()).Return(domain.Company{}, domain.ErrNotFound).AnyTimes()
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, c domain.Company) (domain.Company, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[c.ID] = c
			return c, nil
		},
	).AnyTimes()
	m.EXPECT().Update(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, c domain.Company) (domain.Company, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if _, ok := s.rows[c.ID]; !ok {
				return domain.Company{}, domain.ErrNotFound
			}
			s.rows[c.ID] = c
			return c, nil
		},
	).AnyTimes()
	m.EXPECT().SetActive(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, active bool) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			c, ok := s.rows[id]
			if !ok {
				return domain.ErrNotFound
			}
			c.Active = active
			s.rows[id] = c
			return nil
		},
	).AnyTimes()
	return m
}

// ─── StrictnessRepo ─────────────────────────────────────────────────────

type strictnessStore struct {
	mu     sync.Mutex
	rows   map[uuid.UUID]domain.AIStrictnessProfile
	bySlug map[string]domain.AIStrictnessProfile
}

func newStrictnessStore() *strictnessStore {
	return &strictnessStore{
		rows:   map[uuid.UUID]domain.AIStrictnessProfile{},
		bySlug: map[string]domain.AIStrictnessProfile{},
	}
}

func wireMockStrictnessRepo(ctrl *gomock.Controller, s *strictnessStore) *mocks.MockStrictnessRepo {
	m := mocks.NewMockStrictnessRepo(ctrl)
	m.EXPECT().List(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ bool) ([]domain.AIStrictnessProfile, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			out := make([]domain.AIStrictnessProfile, 0, len(s.rows))
			for _, p := range s.rows {
				out = append(out, p)
			}
			return out, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.AIStrictnessProfile, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			p, ok := s.rows[id]
			if !ok {
				return domain.AIStrictnessProfile{}, domain.ErrNotFound
			}
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().GetBySlug(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, slug string) (domain.AIStrictnessProfile, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			p, ok := s.bySlug[slug]
			if !ok {
				return domain.AIStrictnessProfile{}, domain.ErrNotFound
			}
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p domain.AIStrictnessProfile) (domain.AIStrictnessProfile, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[p.ID] = p
			s.bySlug[p.Slug] = p
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().Update(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p domain.AIStrictnessProfile) (domain.AIStrictnessProfile, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if _, ok := s.rows[p.ID]; !ok {
				return domain.AIStrictnessProfile{}, domain.ErrNotFound
			}
			s.rows[p.ID] = p
			s.bySlug[p.Slug] = p
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().SetActive(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, active bool) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			p, ok := s.rows[id]
			if !ok {
				return domain.ErrNotFound
			}
			p.Active = active
			s.rows[id] = p
			return nil
		},
	).AnyTimes()
	return m
}

// ─── TaskRepo ────────────────────────────────────────────────────────────

type taskStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.MockTask
}

func newTaskStore() *taskStore { return &taskStore{rows: map[uuid.UUID]domain.MockTask{}} }

func wireMockTaskRepo(ctrl *gomock.Controller, s *taskStore) *mocks.MockTaskRepo {
	m := mocks.NewMockTaskRepo(ctrl)
	m.EXPECT().List(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ domain.TaskFilter) ([]domain.MockTask, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			out := make([]domain.MockTask, 0, len(s.rows))
			for _, t := range s.rows {
				out = append(out, t)
			}
			return out, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.MockTask, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			t, ok := s.rows[id]
			if !ok {
				return domain.MockTask{}, domain.ErrNotFound
			}
			return t, nil
		},
	).AnyTimes()
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, t domain.MockTask) (domain.MockTask, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[t.ID] = t
			return t, nil
		},
	).AnyTimes()
	m.EXPECT().Update(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, t domain.MockTask) (domain.MockTask, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if _, ok := s.rows[t.ID]; !ok {
				return domain.MockTask{}, domain.ErrNotFound
			}
			s.rows[t.ID] = t
			return t, nil
		},
	).AnyTimes()
	m.EXPECT().SetActive(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID, active bool) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			t, ok := s.rows[id]
			if !ok {
				return domain.ErrNotFound
			}
			t.Active = active
			s.rows[id] = t
			return nil
		},
	).AnyTimes()
	m.EXPECT().PickRandom(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, stage domain.StageKind, langPool []domain.TaskLanguage, taskPoolIDs []uuid.UUID) (domain.MockTask, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			allowed := map[uuid.UUID]struct{}{}
			for _, id := range taskPoolIDs {
				allowed[id] = struct{}{}
			}
			langSet := map[domain.TaskLanguage]struct{}{}
			for _, l := range langPool {
				langSet[l] = struct{}{}
			}
			for _, t := range s.rows {
				if !t.Active || t.StageKind != stage {
					continue
				}
				if len(taskPoolIDs) > 0 {
					if _, ok := allowed[t.ID]; !ok {
						continue
					}
				}
				if len(langPool) > 0 {
					if _, ok := langSet[t.Language]; !ok {
						continue
					}
				}
				return t, nil
			}
			return domain.MockTask{}, domain.ErrNoTaskAvailable
		},
	).AnyTimes()
	return m
}

// ─── QuestionRepo (zero-state, методы вернут nil/empty) ─────────────────

func wireMockQuestionRepo(ctrl *gomock.Controller) *mocks.MockQuestionRepo {
	m := mocks.NewMockQuestionRepo(ctrl)
	m.EXPECT().ListTaskQuestions(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().CreateTaskQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().UpdateTaskQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().DeleteTaskQuestion(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().ListDefaultQuestions(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().CreateDefaultQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().UpdateDefaultQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().DeleteDefaultQuestion(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().SampleDefaultQuestions(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().ListCompanyQuestions(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().SampleCompanyQuestions(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().CreateCompanyQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().UpdateCompanyQuestion(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) { return q, nil },
	).AnyTimes()
	m.EXPECT().DeleteCompanyQuestion(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	return m
}

// ─── CompanyStageRepo ───────────────────────────────────────────────────

type compStageStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID][]domain.CompanyStage
}

func newCompStageStore() *compStageStore {
	return &compStageStore{rows: map[uuid.UUID][]domain.CompanyStage{}}
}

func wireMockCompanyStageRepo(ctrl *gomock.Controller, s *compStageStore) *mocks.MockCompanyStageRepo {
	m := mocks.NewMockCompanyStageRepo(ctrl)
	m.EXPECT().GetForCompany(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, companyID uuid.UUID) ([]domain.CompanyStage, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.rows[companyID], nil
		},
	).AnyTimes()
	m.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, st domain.CompanyStage) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[st.CompanyID] = append(s.rows[st.CompanyID], st)
			return nil
		},
	).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().ReplaceAll(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, companyID uuid.UUID, ss []domain.CompanyStage) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[companyID] = append([]domain.CompanyStage(nil), ss...)
			return nil
		},
	).AnyTimes()
	return m
}

// ─── PipelineRepo ───────────────────────────────────────────────────────

type pipelineStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID]domain.MockPipeline
}

func newPipelineStore() *pipelineStore {
	return &pipelineStore{rows: map[uuid.UUID]domain.MockPipeline{}}
}

func wireMockPipelineRepo(ctrl *gomock.Controller, s *pipelineStore) *mocks.MockPipelineRepo {
	m := mocks.NewMockPipelineRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, p domain.MockPipeline) (domain.MockPipeline, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[p.ID] = p
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) (domain.MockPipeline, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			p, ok := s.rows[id]
			if !ok {
				return domain.MockPipeline{}, domain.ErrNotFound
			}
			return p, nil
		},
	).AnyTimes()
	m.EXPECT().ListByUser(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().UpdateVerdict(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().IncrementStageIdx(gomock.Any(), gomock.Any()).Return(0, nil).AnyTimes()
	return m
}

// ─── PipelineStageRepo ──────────────────────────────────────────────────

type pipelineStageStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID][]domain.PipelineStage
}

func newPipelineStageStore() *pipelineStageStore {
	return &pipelineStageStore{rows: map[uuid.UUID][]domain.PipelineStage{}}
}

func wireMockPipelineStageRepo(ctrl *gomock.Controller, s *pipelineStageStore) *mocks.MockPipelineStageRepo {
	m := mocks.NewMockPipelineStageRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, st domain.PipelineStage) (domain.PipelineStage, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.rows[st.PipelineID] = append(s.rows[st.PipelineID], st)
			return st, nil
		},
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).Return(domain.PipelineStage{}, domain.ErrNotFound).AnyTimes()
	m.EXPECT().ListByPipeline(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, id uuid.UUID) ([]domain.PipelineStage, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.rows[id], nil
		},
	).AnyTimes()
	m.EXPECT().UpdateStatus(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().UpdateStartStage(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().FinishStage(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	return m
}

// ─── AttemptRepo (stub-only) ────────────────────────────────────────────

func wireMockAttemptRepo(ctrl *gomock.Controller) *mocks.MockPipelineAttemptRepo {
	m := mocks.NewMockPipelineAttemptRepo(ctrl)
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, a domain.PipelineAttempt) (domain.PipelineAttempt, error) { return a, nil },
	).AnyTimes()
	m.EXPECT().Get(gomock.Any(), gomock.Any()).Return(domain.PipelineAttempt{}, domain.ErrNotFound).AnyTimes()
	m.EXPECT().ListByStage(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().UpdateJudgeResult(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().UpdateCanvasResult(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	m.EXPECT().GetWithQuestion(gomock.Any(), gomock.Any()).Return(domain.AttemptWithQuestion{}, domain.ErrNotFound).AnyTimes()
	return m
}

// ─── LeaderboardRepo (stub) ─────────────────────────────────────────────

func wireMockLeaderboardRepo(ctrl *gomock.Controller) *mocks.MockLeaderboardRepo {
	m := mocks.NewMockLeaderboardRepo(ctrl)
	m.EXPECT().Top(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	return m
}

// ─── TestCaseRepo (stub) ────────────────────────────────────────────────

func wireMockTestCaseRepo(ctrl *gomock.Controller) *mocks.MockMockTaskTestCaseRepo {
	m := mocks.NewMockMockTaskTestCaseRepo(ctrl)
	m.EXPECT().ListForTask(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	m.EXPECT().Create(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, tc domain.MockTaskTestCase) (domain.MockTaskTestCase, error) { return tc, nil },
	).AnyTimes()
	m.EXPECT().Update(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, tc domain.MockTaskTestCase) (domain.MockTaskTestCase, error) { return tc, nil },
	).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	return m
}
