// In-memory fakes covering the most critical use cases:
//   - CreatePipeline picks the right stage skeleton (random / company config)
//   - CreateTask validates the reference_criteria shape
//   - ResolveStrictness walks the task → company_stage → default cascade
//
// We avoid pgxmock (not in repo go.sum) and use plain map-backed fakes.
package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// ── fakes ───────────────────────────────────────────────────────────────

type fakeCompanyRepo struct{ rows map[uuid.UUID]domain.Company }

func (f *fakeCompanyRepo) List(_ context.Context, _ bool) ([]domain.Company, error) {
	out := make([]domain.Company, 0, len(f.rows))
	for _, c := range f.rows {
		out = append(out, c)
	}
	return out, nil
}
func (f *fakeCompanyRepo) Get(_ context.Context, id uuid.UUID) (domain.Company, error) {
	c, ok := f.rows[id]
	if !ok {
		return domain.Company{}, domain.ErrNotFound
	}
	return c, nil
}
func (f *fakeCompanyRepo) GetBySlug(_ context.Context, _ string) (domain.Company, error) {
	return domain.Company{}, domain.ErrNotFound
}
func (f *fakeCompanyRepo) Create(_ context.Context, c domain.Company) (domain.Company, error) {
	if f.rows == nil {
		f.rows = map[uuid.UUID]domain.Company{}
	}
	f.rows[c.ID] = c
	return c, nil
}
func (f *fakeCompanyRepo) Update(_ context.Context, c domain.Company) (domain.Company, error) {
	if _, ok := f.rows[c.ID]; !ok {
		return domain.Company{}, domain.ErrNotFound
	}
	f.rows[c.ID] = c
	return c, nil
}
func (f *fakeCompanyRepo) SetActive(_ context.Context, id uuid.UUID, active bool) error {
	c, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	c.Active = active
	f.rows[id] = c
	return nil
}

type fakeStrictnessRepo struct {
	rows   map[uuid.UUID]domain.AIStrictnessProfile
	bySlug map[string]domain.AIStrictnessProfile
}

func (f *fakeStrictnessRepo) List(_ context.Context, _ bool) ([]domain.AIStrictnessProfile, error) {
	out := make([]domain.AIStrictnessProfile, 0, len(f.rows))
	for _, p := range f.rows {
		out = append(out, p)
	}
	return out, nil
}
func (f *fakeStrictnessRepo) Get(_ context.Context, id uuid.UUID) (domain.AIStrictnessProfile, error) {
	p, ok := f.rows[id]
	if !ok {
		return domain.AIStrictnessProfile{}, domain.ErrNotFound
	}
	return p, nil
}
func (f *fakeStrictnessRepo) GetBySlug(_ context.Context, slug string) (domain.AIStrictnessProfile, error) {
	if f.bySlug == nil {
		return domain.AIStrictnessProfile{}, domain.ErrNotFound
	}
	p, ok := f.bySlug[slug]
	if !ok {
		return domain.AIStrictnessProfile{}, domain.ErrNotFound
	}
	return p, nil
}
func (f *fakeStrictnessRepo) Create(_ context.Context, p domain.AIStrictnessProfile) (domain.AIStrictnessProfile, error) {
	if f.rows == nil {
		f.rows = map[uuid.UUID]domain.AIStrictnessProfile{}
	}
	if f.bySlug == nil {
		f.bySlug = map[string]domain.AIStrictnessProfile{}
	}
	f.rows[p.ID] = p
	f.bySlug[p.Slug] = p
	return p, nil
}
func (f *fakeStrictnessRepo) Update(_ context.Context, p domain.AIStrictnessProfile) (domain.AIStrictnessProfile, error) {
	if _, ok := f.rows[p.ID]; !ok {
		return domain.AIStrictnessProfile{}, domain.ErrNotFound
	}
	f.rows[p.ID] = p
	f.bySlug[p.Slug] = p
	return p, nil
}
func (f *fakeStrictnessRepo) SetActive(_ context.Context, id uuid.UUID, active bool) error {
	p, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	p.Active = active
	f.rows[id] = p
	return nil
}

type fakeTaskRepo struct{ rows map[uuid.UUID]domain.MockTask }

func (f *fakeTaskRepo) List(_ context.Context, _ domain.TaskFilter) ([]domain.MockTask, error) {
	out := make([]domain.MockTask, 0, len(f.rows))
	for _, t := range f.rows {
		out = append(out, t)
	}
	return out, nil
}
func (f *fakeTaskRepo) Get(_ context.Context, id uuid.UUID) (domain.MockTask, error) {
	t, ok := f.rows[id]
	if !ok {
		return domain.MockTask{}, domain.ErrNotFound
	}
	return t, nil
}
func (f *fakeTaskRepo) Create(_ context.Context, t domain.MockTask) (domain.MockTask, error) {
	if f.rows == nil {
		f.rows = map[uuid.UUID]domain.MockTask{}
	}
	f.rows[t.ID] = t
	return t, nil
}
func (f *fakeTaskRepo) Update(_ context.Context, t domain.MockTask) (domain.MockTask, error) {
	if _, ok := f.rows[t.ID]; !ok {
		return domain.MockTask{}, domain.ErrNotFound
	}
	f.rows[t.ID] = t
	return t, nil
}
func (f *fakeTaskRepo) SetActive(_ context.Context, id uuid.UUID, active bool) error {
	t, ok := f.rows[id]
	if !ok {
		return domain.ErrNotFound
	}
	t.Active = active
	f.rows[id] = t
	return nil
}
func (f *fakeTaskRepo) PickRandom(_ context.Context, stage domain.StageKind,
	langPool []domain.TaskLanguage, taskPoolIDs []uuid.UUID,
) (domain.MockTask, error) {
	allowed := map[uuid.UUID]struct{}{}
	for _, id := range taskPoolIDs {
		allowed[id] = struct{}{}
	}
	langSet := map[domain.TaskLanguage]struct{}{}
	for _, l := range langPool {
		langSet[l] = struct{}{}
	}
	for _, t := range f.rows {
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
}

type fakeQuestionRepo struct{}

func (f *fakeQuestionRepo) ListTaskQuestions(context.Context, uuid.UUID) ([]domain.TaskQuestion, error) {
	return nil, nil
}
func (f *fakeQuestionRepo) CreateTaskQuestion(_ context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) {
	return q, nil
}
func (f *fakeQuestionRepo) UpdateTaskQuestion(_ context.Context, q domain.TaskQuestion) (domain.TaskQuestion, error) {
	return q, nil
}
func (f *fakeQuestionRepo) DeleteTaskQuestion(context.Context, uuid.UUID) error { return nil }
func (f *fakeQuestionRepo) ListDefaultQuestions(context.Context, domain.StageKind, bool) ([]domain.DefaultQuestion, error) {
	return nil, nil
}
func (f *fakeQuestionRepo) CreateDefaultQuestion(_ context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) {
	return q, nil
}
func (f *fakeQuestionRepo) UpdateDefaultQuestion(_ context.Context, q domain.DefaultQuestion) (domain.DefaultQuestion, error) {
	return q, nil
}
func (f *fakeQuestionRepo) DeleteDefaultQuestion(context.Context, uuid.UUID) error { return nil }
func (f *fakeQuestionRepo) SampleDefaultQuestions(context.Context, domain.StageKind, int) ([]domain.DefaultQuestion, error) {
	return nil, nil
}
func (f *fakeQuestionRepo) ListCompanyQuestions(context.Context, uuid.UUID, domain.StageKind) ([]domain.CompanyQuestion, error) {
	return nil, nil
}
func (f *fakeQuestionRepo) SampleCompanyQuestions(context.Context, uuid.UUID, domain.StageKind, int) ([]domain.CompanyQuestion, error) {
	return nil, nil
}
func (f *fakeQuestionRepo) CreateCompanyQuestion(_ context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) {
	return q, nil
}
func (f *fakeQuestionRepo) UpdateCompanyQuestion(_ context.Context, q domain.CompanyQuestion) (domain.CompanyQuestion, error) {
	return q, nil
}
func (f *fakeQuestionRepo) DeleteCompanyQuestion(context.Context, uuid.UUID) error { return nil }

type fakeCompanyStageRepo struct {
	rows map[uuid.UUID][]domain.CompanyStage
}

func (f *fakeCompanyStageRepo) GetForCompany(_ context.Context, companyID uuid.UUID) ([]domain.CompanyStage, error) {
	return f.rows[companyID], nil
}
func (f *fakeCompanyStageRepo) Upsert(_ context.Context, s domain.CompanyStage) error {
	if f.rows == nil {
		f.rows = map[uuid.UUID][]domain.CompanyStage{}
	}
	f.rows[s.CompanyID] = append(f.rows[s.CompanyID], s)
	return nil
}
func (f *fakeCompanyStageRepo) Delete(context.Context, uuid.UUID, domain.StageKind) error { return nil }
func (f *fakeCompanyStageRepo) ReplaceAll(_ context.Context, companyID uuid.UUID, ss []domain.CompanyStage) error {
	if f.rows == nil {
		f.rows = map[uuid.UUID][]domain.CompanyStage{}
	}
	f.rows[companyID] = append([]domain.CompanyStage(nil), ss...)
	return nil
}

type fakePipelineRepo struct {
	rows map[uuid.UUID]domain.MockPipeline
}

func (f *fakePipelineRepo) Create(_ context.Context, p domain.MockPipeline) (domain.MockPipeline, error) {
	if f.rows == nil {
		f.rows = map[uuid.UUID]domain.MockPipeline{}
	}
	f.rows[p.ID] = p
	return p, nil
}
func (f *fakePipelineRepo) Get(_ context.Context, id uuid.UUID) (domain.MockPipeline, error) {
	p, ok := f.rows[id]
	if !ok {
		return domain.MockPipeline{}, domain.ErrNotFound
	}
	return p, nil
}
func (f *fakePipelineRepo) ListByUser(_ context.Context, _ uuid.UUID, _ int) ([]domain.MockPipeline, error) {
	return nil, nil
}
func (f *fakePipelineRepo) UpdateVerdict(context.Context, uuid.UUID, domain.PipelineVerdict, *float32) error {
	return nil
}
func (f *fakePipelineRepo) IncrementStageIdx(context.Context, uuid.UUID) (int, error) {
	return 0, nil
}

type fakePipelineStageRepo struct {
	rows map[uuid.UUID][]domain.PipelineStage
}

func (f *fakePipelineStageRepo) Create(_ context.Context, s domain.PipelineStage) (domain.PipelineStage, error) {
	if f.rows == nil {
		f.rows = map[uuid.UUID][]domain.PipelineStage{}
	}
	f.rows[s.PipelineID] = append(f.rows[s.PipelineID], s)
	return s, nil
}
func (f *fakePipelineStageRepo) Get(context.Context, uuid.UUID) (domain.PipelineStage, error) {
	return domain.PipelineStage{}, domain.ErrNotFound
}
func (f *fakePipelineStageRepo) ListByPipeline(_ context.Context, id uuid.UUID) ([]domain.PipelineStage, error) {
	return f.rows[id], nil
}
func (f *fakePipelineStageRepo) UpdateStatus(context.Context, uuid.UUID, domain.StageStatus) error {
	return nil
}
func (f *fakePipelineStageRepo) UpdateStartStage(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}
func (f *fakePipelineStageRepo) FinishStage(context.Context, uuid.UUID, float32, domain.StageVerdict, string) error {
	return nil
}

type fakeAttemptRepo struct{}

func (f *fakeAttemptRepo) Create(_ context.Context, a domain.PipelineAttempt) (domain.PipelineAttempt, error) {
	return a, nil
}
func (f *fakeAttemptRepo) Get(context.Context, uuid.UUID) (domain.PipelineAttempt, error) {
	return domain.PipelineAttempt{}, domain.ErrNotFound
}
func (f *fakeAttemptRepo) ListByStage(context.Context, uuid.UUID) ([]domain.PipelineAttempt, error) {
	return nil, nil
}
func (f *fakeAttemptRepo) UpdateJudgeResult(context.Context, uuid.UUID, string, float32, float32, domain.AttemptVerdict, string, []string) error {
	return nil
}
func (f *fakeAttemptRepo) UpdateCanvasResult(context.Context, uuid.UUID, domain.CanvasResultUpdate) error {
	return nil
}
func (f *fakeAttemptRepo) GetWithQuestion(context.Context, uuid.UUID) (domain.AttemptWithQuestion, error) {
	return domain.AttemptWithQuestion{}, domain.ErrNotFound
}

type fakeLeaderboardRepo struct{}

func (fakeLeaderboardRepo) Top(context.Context, *uuid.UUID, int) ([]domain.LeaderboardEntry, error) {
	return nil, nil
}

type fakeTestCaseRepo struct{}

func (fakeTestCaseRepo) ListForTask(context.Context, uuid.UUID) ([]domain.MockTaskTestCase, error) {
	return nil, nil
}
func (fakeTestCaseRepo) Create(_ context.Context, tc domain.MockTaskTestCase) (domain.MockTaskTestCase, error) {
	return tc, nil
}
func (fakeTestCaseRepo) Update(_ context.Context, tc domain.MockTaskTestCase) (domain.MockTaskTestCase, error) {
	return tc, nil
}
func (fakeTestCaseRepo) Delete(context.Context, uuid.UUID) error { return nil }

func newTestHandlers() (*Handlers, *fakeCompanyStageRepo, *fakePipelineStageRepo, *fakeStrictnessRepo, *fakeTaskRepo) {
	cs := &fakeCompanyStageRepo{}
	ps := &fakePipelineStageRepo{}
	st := &fakeStrictnessRepo{}
	tk := &fakeTaskRepo{}
	h := NewHandlers(
		&fakeCompanyRepo{}, st, tk, &fakeQuestionRepo{},
		cs, &fakePipelineRepo{}, ps, &fakeAttemptRepo{},
		&fakeLeaderboardRepo{}, &fakeTestCaseRepo{},
	)
	h.Now = func() time.Time { return time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC) }
	return h, cs, ps, st, tk
}

// ── tests ───────────────────────────────────────────────────────────────

func TestCreatePipeline_RandomModeUsesDefaultSkeleton(t *testing.T) {
	h, _, ps, _, _ := newTestHandlers()
	got, err := h.CreatePipeline(context.Background(), uuid.New(), nil, false)
	if err != nil {
		t.Fatalf("CreatePipeline: %v", err)
	}
	if got.Pipeline.CompanyID != nil {
		t.Errorf("expected nil company_id in random mode")
	}
	if len(got.Stages) != 5 {
		t.Errorf("expected 5 default stages, got %d", len(got.Stages))
	}
	want := []domain.StageKind{domain.StageHR, domain.StageAlgo, domain.StageCoding, domain.StageSysDesign, domain.StageBehavioral}
	for i, w := range want {
		if got.Stages[i].StageKind != w {
			t.Errorf("stage[%d]: want %s got %s", i, w, got.Stages[i].StageKind)
		}
		if got.Stages[i].Status != domain.StageStatusPending {
			t.Errorf("stage[%d]: want pending, got %s", i, got.Stages[i].Status)
		}
	}
	// Round-trip: ListByPipeline should now return 5 rows.
	rows, _ := ps.ListByPipeline(context.Background(), got.Pipeline.ID)
	if len(rows) != 5 {
		t.Errorf("repo round-trip: want 5 rows, got %d", len(rows))
	}
}

func TestCreatePipeline_CompanyModeUsesCompanyStages(t *testing.T) {
	h, cs, _, _, _ := newTestHandlers()
	companyID := uuid.New()
	cs.rows = map[uuid.UUID][]domain.CompanyStage{
		companyID: {
			{CompanyID: companyID, StageKind: domain.StageHR, Ordinal: 0},
			{CompanyID: companyID, StageKind: domain.StageAlgo, Ordinal: 1},
		},
	}
	got, err := h.CreatePipeline(context.Background(), uuid.New(), &companyID, true)
	if err != nil {
		t.Fatalf("CreatePipeline: %v", err)
	}
	if !got.Pipeline.AIAssist {
		t.Errorf("expected ai_assist=true")
	}
	if len(got.Stages) != 2 {
		t.Errorf("want 2 stages from company config, got %d", len(got.Stages))
	}
}

func TestCreateTask_ValidatesAndRoundTrips(t *testing.T) {
	h, _, _, _, tk := newTestHandlers()
	in := domain.MockTask{
		StageKind:  domain.StageAlgo,
		Language:   domain.LangGo,
		Title:      "Top-K",
		BodyMD:     "Find top K elements",
		Difficulty: 3,
		ReferenceCriteria: domain.ReferenceCriteria{
			MustMention: []string{"O(n log k)"},
		},
	}
	out, err := h.CreateTask(context.Background(), in)
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if out.ID == uuid.Nil {
		t.Errorf("expected ID assigned")
	}
	// nil arrays normalised
	if out.ReferenceCriteria.NiceToHave == nil || out.ReferenceCriteria.CommonPitfalls == nil {
		t.Errorf("expected nil arrays normalised to []")
	}
	// round-trip
	got, _ := tk.Get(context.Background(), out.ID)
	if got.Title != "Top-K" {
		t.Errorf("round-trip: want Top-K, got %q", got.Title)
	}
}

func TestCreateTask_RejectsMissingTitle(t *testing.T) {
	h, _, _, _, _ := newTestHandlers()
	_, err := h.CreateTask(context.Background(), domain.MockTask{
		StageKind: domain.StageAlgo, BodyMD: "x",
	})
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("want ErrValidation, got %v", err)
	}
}

func TestResolveStrictness_Cascade(t *testing.T) {
	h, cs, _, st, tk := newTestHandlers()

	defaultID := uuid.New()
	companyID := uuid.New()
	stageID := uuid.New()
	taskID := uuid.New()

	def := domain.AIStrictnessProfile{ID: defaultID, Slug: "default", Name: "default"}
	companyProf := domain.AIStrictnessProfile{ID: uuid.New(), Slug: "co", Name: "Co"}
	taskProf := domain.AIStrictnessProfile{ID: uuid.New(), Slug: "tk", Name: "Tk"}
	st.bySlug = map[string]domain.AIStrictnessProfile{"default": def}
	st.rows = map[uuid.UUID]domain.AIStrictnessProfile{
		def.ID: def, companyProf.ID: companyProf, taskProf.ID: taskProf,
	}

	// Case 1: only default → returns default.
	got, err := h.ResolveStrictness(context.Background(), uuid.Nil, nil, domain.StageHR)
	if err != nil || got.Slug != "default" {
		t.Fatalf("case1: want default, got %v / %v", got, err)
	}

	// Case 2: company_stage override.
	cs.rows = map[uuid.UUID][]domain.CompanyStage{
		companyID: {{
			CompanyID: companyID, StageKind: domain.StageHR, Ordinal: 0,
			AIStrictnessProfileID: &companyProf.ID,
		}},
	}
	got, err = h.ResolveStrictness(context.Background(), uuid.Nil, &companyID, domain.StageHR)
	if err != nil || got.Slug != "co" {
		t.Fatalf("case2: want co, got %v / %v", got, err)
	}

	// Case 3: task override wins over company.
	tk.rows = map[uuid.UUID]domain.MockTask{
		taskID: {ID: taskID, StageKind: domain.StageAlgo, AIStrictnessProfileID: &taskProf.ID},
	}
	got, err = h.ResolveStrictness(context.Background(), taskID, &companyID, domain.StageHR)
	if err != nil || got.Slug != "tk" {
		t.Fatalf("case3: want tk, got %v / %v", got, err)
	}

	_ = stageID
}
