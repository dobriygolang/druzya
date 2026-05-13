// Wave 13: in-memory fakes заменены на mockgen-generated mocks через
// DoAndReturn-closures (см. test_helpers_test.go). Покрытие тестов
// сохранено 1:1.
package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── helpers ─────────────────────────────────────────────────────────────

type handlersHarness struct {
	h          *Handlers
	companies  *companyStore
	strictness *strictnessStore
	tasks      *taskStore
	compStages *compStageStore
	pipelines  *pipelineStore
	stages     *pipelineStageStore
}

func newTestHandlers(t *testing.T) *handlersHarness {
	t.Helper()
	ctrl := gomock.NewController(t)
	companies := newCompanyStore()
	strictness := newStrictnessStore()
	tasks := newTaskStore()
	compStages := newCompStageStore()
	pipelines := newPipelineStore()
	stages := newPipelineStageStore()
	h := NewHandlers(
		wireMockCompanyRepo(ctrl, companies),
		wireMockStrictnessRepo(ctrl, strictness),
		wireMockTaskRepo(ctrl, tasks),
		wireMockQuestionRepo(ctrl),
		wireMockCompanyStageRepo(ctrl, compStages),
		wireMockPipelineRepo(ctrl, pipelines),
		wireMockPipelineStageRepo(ctrl, stages),
		wireMockAttemptRepo(ctrl),
		wireMockLeaderboardRepo(ctrl),
		wireMockTestCaseRepo(ctrl),
	)
	h.Now = func() time.Time { return time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC) }
	return &handlersHarness{
		h:          h,
		companies:  companies,
		strictness: strictness,
		tasks:      tasks,
		compStages: compStages,
		pipelines:  pipelines,
		stages:     stages,
	}
}

// ── tests ───────────────────────────────────────────────────────────────

func TestCreatePipeline_RandomModeUsesDefaultSkeleton(t *testing.T) {
	hh := newTestHandlers(t)
	got, err := hh.h.CreatePipeline(context.Background(), uuid.New(), nil, false, nil)
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
	hh.stages.mu.Lock()
	rows := hh.stages.rows[got.Pipeline.ID]
	hh.stages.mu.Unlock()
	if len(rows) != 5 {
		t.Errorf("repo round-trip: want 5 rows, got %d", len(rows))
	}
}

func TestCreatePipeline_CompanyModeUsesCompanyStages(t *testing.T) {
	hh := newTestHandlers(t)
	companyID := uuid.New()
	hh.compStages.mu.Lock()
	hh.compStages.rows[companyID] = []domain.CompanyStage{
		{CompanyID: companyID, StageKind: domain.StageHR, Ordinal: 0},
		{CompanyID: companyID, StageKind: domain.StageAlgo, Ordinal: 1},
	}
	hh.compStages.mu.Unlock()
	got, err := hh.h.CreatePipeline(context.Background(), uuid.New(), &companyID, true, nil)
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
	hh := newTestHandlers(t)
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
	out, err := hh.h.CreateTask(context.Background(), in)
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
	hh.tasks.mu.Lock()
	got, ok := hh.tasks.rows[out.ID]
	hh.tasks.mu.Unlock()
	if !ok || got.Title != "Top-K" {
		t.Errorf("round-trip: want Top-K, got %+v", got)
	}
}

func TestCreateTask_RejectsMissingTitle(t *testing.T) {
	hh := newTestHandlers(t)
	_, err := hh.h.CreateTask(context.Background(), domain.MockTask{
		StageKind: domain.StageAlgo, BodyMD: "x",
	})
	if !errors.Is(err, domain.ErrValidation) {
		t.Errorf("want ErrValidation, got %v", err)
	}
}

func TestResolveStrictness_Cascade(t *testing.T) {
	hh := newTestHandlers(t)

	defaultID := uuid.New()
	companyID := uuid.New()
	taskID := uuid.New()

	def := domain.AIStrictnessProfile{ID: defaultID, Slug: "default", Name: "default"}
	companyProf := domain.AIStrictnessProfile{ID: uuid.New(), Slug: "co", Name: "Co"}
	taskProf := domain.AIStrictnessProfile{ID: uuid.New(), Slug: "tk", Name: "Tk"}
	hh.strictness.mu.Lock()
	hh.strictness.bySlug["default"] = def
	hh.strictness.rows[def.ID] = def
	hh.strictness.rows[companyProf.ID] = companyProf
	hh.strictness.rows[taskProf.ID] = taskProf
	hh.strictness.mu.Unlock()

	// Case 1: only default → returns default.
	got, err := hh.h.ResolveStrictness(context.Background(), uuid.Nil, nil, domain.StageHR)
	if err != nil || got.Slug != "default" {
		t.Fatalf("case1: want default, got %v / %v", got, err)
	}

	// Case 2: company_stage override.
	hh.compStages.mu.Lock()
	hh.compStages.rows[companyID] = []domain.CompanyStage{{
		CompanyID: companyID, StageKind: domain.StageHR, Ordinal: 0,
		AIStrictnessProfileID: &companyProf.ID,
	}}
	hh.compStages.mu.Unlock()
	got, err = hh.h.ResolveStrictness(context.Background(), uuid.Nil, &companyID, domain.StageHR)
	if err != nil || got.Slug != "co" {
		t.Fatalf("case2: want co, got %v / %v", got, err)
	}

	// Case 3: task override wins over company.
	hh.tasks.mu.Lock()
	hh.tasks.rows[taskID] = domain.MockTask{ID: taskID, StageKind: domain.StageAlgo, AIStrictnessProfileID: &taskProf.ID}
	hh.tasks.mu.Unlock()
	got, err = hh.h.ResolveStrictness(context.Background(), taskID, &companyID, domain.StageHR)
	if err != nil || got.Slug != "tk" {
		t.Fatalf("case3: want tk, got %v / %v", got, err)
	}
}
