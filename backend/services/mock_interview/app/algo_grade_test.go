// algo_grade_test.go — table-driven coverage for the «Run tests» UC. Uses
// an in-process fake sandbox so we exercise the verdict-builder + ownership
// guards without spinning Judge0.
package app

import (
	"context"
	"errors"
	"testing"

	"druz9/mock_interview/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// fakeDetailedSandbox satisfies domain.DetailedSandboxExecutor. avail toggles
// the Available() return; err short-circuits SubmitDetailed; cases is the
// canned per-test slice (Ordinal/IsHidden are taken from each row).
type fakeDetailedSandbox struct {
	avail bool
	err   error
	cases []domain.SandboxCaseResult
	// captured arguments for assertion
	lastCode string
	lastLang enums.Language
	lastTask uuid.UUID
}

func (f *fakeDetailedSandbox) Available() bool { return f.avail }
func (f *fakeDetailedSandbox) Submit(_ context.Context, _ string, _ enums.Language, _ uuid.UUID) (domain.SandboxResult, error) {
	return domain.SandboxResult{}, errors.New("not used in algo_grade tests")
}
func (f *fakeDetailedSandbox) SubmitDetailed(_ context.Context, code string, lang enums.Language, taskID uuid.UUID) ([]domain.SandboxCaseResult, error) {
	f.lastCode = code
	f.lastLang = lang
	f.lastTask = taskID
	if f.err != nil {
		return nil, f.err
	}
	return f.cases, nil
}

// minimal fake stage repo — algo_grade uses Stages only for the stage_kind
// guard (defence-in-depth).
type fakeStageRepoAlgo struct {
	row domain.PipelineStage
}

func (f *fakeStageRepoAlgo) Create(context.Context, domain.PipelineStage) (domain.PipelineStage, error) {
	return f.row, nil
}
func (f *fakeStageRepoAlgo) Get(_ context.Context, _ uuid.UUID) (domain.PipelineStage, error) {
	return f.row, nil
}
func (f *fakeStageRepoAlgo) ListByPipeline(context.Context, uuid.UUID) ([]domain.PipelineStage, error) {
	return nil, nil
}
func (f *fakeStageRepoAlgo) UpdateStatus(context.Context, uuid.UUID, domain.StageStatus) error {
	return nil
}
func (f *fakeStageRepoAlgo) UpdateStartStage(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}
func (f *fakeStageRepoAlgo) FinishStage(context.Context, uuid.UUID, float32, domain.StageVerdict, string) error {
	return nil
}

// minimal fake task repo. algo_grade only ever calls .Get via the orchestrator
// not directly; we satisfy the interface so the package compiles.
type fakeTaskRepoAlgo struct{}

func (fakeTaskRepoAlgo) List(context.Context, domain.TaskFilter) ([]domain.MockTask, error) {
	return nil, nil
}
func (fakeTaskRepoAlgo) Get(_ context.Context, id uuid.UUID) (domain.MockTask, error) {
	return domain.MockTask{ID: id}, nil
}
func (fakeTaskRepoAlgo) Create(_ context.Context, t domain.MockTask) (domain.MockTask, error) {
	return t, nil
}
func (fakeTaskRepoAlgo) Update(_ context.Context, t domain.MockTask) (domain.MockTask, error) {
	return t, nil
}
func (fakeTaskRepoAlgo) SetActive(context.Context, uuid.UUID, bool) error { return nil }
func (fakeTaskRepoAlgo) PickRandom(context.Context, domain.StageKind, []domain.TaskLanguage, []uuid.UUID) (domain.MockTask, error) {
	return domain.MockTask{}, domain.ErrNoTaskAvailable
}

// helper — build an orchestrator-grade attempt + sandbox + grader.
func newAlgoTestRig(t *testing.T, sandbox *fakeDetailedSandbox, attKind domain.AttemptKind, taskID *uuid.UUID, stageKind domain.StageKind) (*AlgoGrader, uuid.UUID) {
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
	g := &AlgoGrader{
		Sandbox:  sandbox,
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

// ── verdict builder ─────────────────────────────────────────────────────

func TestBuildVerdict_AllPassed(t *testing.T) {
	cases := []domain.SandboxCaseResult{
		{Ordinal: 1, Passed: true, Input: "1 2", Expected: "3", Actual: "3", RuntimeMs: 12, MemoryKB: 2048},
		{Ordinal: 2, Passed: true, Input: "5 5", Expected: "10", Actual: "10", RuntimeMs: 18, MemoryKB: 2100},
	}
	v := buildVerdict(cases)
	if v.Passed != 2 || v.Total != 2 {
		t.Errorf("passed/total = %d/%d, want 2/2", v.Passed, v.Total)
	}
	if v.Status != AlgoStatusOK {
		t.Errorf("status=%s, want ok", v.Status)
	}
	if v.RuntimeMs != 18 {
		t.Errorf("runtimeMs=%d, want max=18", v.RuntimeMs)
	}
}

func TestBuildVerdict_PartialPass(t *testing.T) {
	cases := []domain.SandboxCaseResult{
		{Ordinal: 1, Passed: true},
		{Ordinal: 2, Passed: false, Actual: "wrong"},
	}
	v := buildVerdict(cases)
	if v.Passed != 1 || v.Total != 2 {
		t.Errorf("passed/total = %d/%d, want 1/2", v.Passed, v.Total)
	}
	if v.Status != AlgoStatusOK {
		t.Errorf("partial mix still status=ok, got %s", v.Status)
	}
}

func TestBuildVerdict_CompileError(t *testing.T) {
	// Every case stderr-failed identically → compile error.
	cases := []domain.SandboxCaseResult{
		{Ordinal: 1, Stderr: "syntax error"},
		{Ordinal: 2, Stderr: "syntax error"},
	}
	v := buildVerdict(cases)
	if v.Status != AlgoStatusCompileError {
		t.Errorf("status=%s, want compile_error", v.Status)
	}
}

func TestBuildVerdict_RuntimeError(t *testing.T) {
	// At least one stderr but not all → runtime error.
	cases := []domain.SandboxCaseResult{
		{Ordinal: 1, Stderr: "panic: index out of range"},
		{Ordinal: 2, Passed: false, Actual: "wrong"},
	}
	v := buildVerdict(cases)
	if v.Status != AlgoStatusRuntimeError {
		t.Errorf("status=%s, want runtime_error", v.Status)
	}
}

func TestBuildVerdict_HiddenRedaction(t *testing.T) {
	cases := []domain.SandboxCaseResult{
		{Ordinal: 1, Passed: true, Input: "visible", Expected: "v", Actual: "v"},
		{Ordinal: 2, Passed: false, Input: "secret", Expected: "s", Actual: "x", IsHidden: true},
	}
	v := buildVerdict(cases)
	if len(v.Tests) != 2 {
		t.Fatalf("tests len=%d, want 2", len(v.Tests))
	}
	if v.Tests[1].Input != "" || v.Tests[1].Expected != "" || v.Tests[1].Actual != "" {
		t.Errorf("hidden case not redacted: %+v", v.Tests[1])
	}
	// Counts still include hidden cases.
	if v.Total != 2 {
		t.Errorf("total=%d, want 2 (hidden counts in aggregate)", v.Total)
	}
}

func TestBuildVerdict_TruncatesLongOutput(t *testing.T) {
	long := make([]byte, algoOutputCap*2)
	for i := range long {
		long[i] = 'x'
	}
	cases := []domain.SandboxCaseResult{
		{Ordinal: 1, Passed: false, Actual: string(long)},
	}
	v := buildVerdict(cases)
	if len(v.Tests[0].Actual) > algoOutputCap+64 {
		t.Errorf("actual not truncated: len=%d", len(v.Tests[0].Actual))
	}
}

// ── Run() validation guards ─────────────────────────────────────────────

func TestRun_EmptyCode_Rejected(t *testing.T) {
	sb := &fakeDetailedSandbox{avail: true}
	tid := uuid.New()
	g, attID := newAlgoTestRig(t, sb, domain.AttemptTaskSolve, &tid, domain.StageAlgo)
	_, err := g.Run(context.Background(), RunAlgoInput{AttemptID: attID, Code: "   ", Language: "go"})
	if err == nil || !errors.Is(err, domain.ErrValidation) {
		t.Errorf("want ErrValidation, got %v", err)
	}
}

func TestRun_UnknownLanguage_Rejected(t *testing.T) {
	sb := &fakeDetailedSandbox{avail: true}
	tid := uuid.New()
	g, attID := newAlgoTestRig(t, sb, domain.AttemptTaskSolve, &tid, domain.StageAlgo)
	_, err := g.Run(context.Background(), RunAlgoInput{AttemptID: attID, Code: "x", Language: "brainfuck"})
	if err == nil || !errors.Is(err, domain.ErrValidation) {
		t.Errorf("want ErrValidation, got %v", err)
	}
}

func TestRun_NonTaskSolve_Rejected(t *testing.T) {
	sb := &fakeDetailedSandbox{avail: true}
	tid := uuid.New()
	g, attID := newAlgoTestRig(t, sb, domain.AttemptQuestionAnswer, &tid, domain.StageAlgo)
	_, err := g.Run(context.Background(), RunAlgoInput{AttemptID: attID, Code: "x", Language: "go"})
	if err == nil || !errors.Is(err, domain.ErrConflict) {
		t.Errorf("want ErrConflict, got %v", err)
	}
}

func TestRun_SandboxUnavailable_ReturnsStructuredVerdict(t *testing.T) {
	sb := &fakeDetailedSandbox{avail: true, err: domain.ErrSandboxUnavailable}
	tid := uuid.New()
	g, attID := newAlgoTestRig(t, sb, domain.AttemptTaskSolve, &tid, domain.StageAlgo)
	out, err := g.Run(context.Background(), RunAlgoInput{AttemptID: attID, Code: "package main", Language: "go"})
	if err != nil {
		t.Fatalf("err=%v, want nil (structured verdict path)", err)
	}
	if !out.SandboxUnavailable {
		t.Errorf("want sandbox_unavailable=true, got %+v", out)
	}
	if out.Status != AlgoStatusUnavailable {
		t.Errorf("status=%s, want unavailable", out.Status)
	}
}

func TestRun_HappyPath_AllPassed(t *testing.T) {
	sb := &fakeDetailedSandbox{
		avail: true,
		cases: []domain.SandboxCaseResult{
			{Ordinal: 1, Passed: true, Input: "1", Expected: "1", Actual: "1", RuntimeMs: 5},
			{Ordinal: 2, Passed: true, Input: "2", Expected: "2", Actual: "2", RuntimeMs: 8},
		},
	}
	tid := uuid.New()
	g, attID := newAlgoTestRig(t, sb, domain.AttemptTaskSolve, &tid, domain.StageAlgo)
	out, err := g.Run(context.Background(), RunAlgoInput{AttemptID: attID, Code: "print(input())", Language: "python"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Passed != 2 || out.Total != 2 {
		t.Errorf("passed/total=%d/%d, want 2/2", out.Passed, out.Total)
	}
	if out.Status != AlgoStatusOK {
		t.Errorf("status=%s, want ok", out.Status)
	}
	if sb.lastLang != enums.LanguagePython || sb.lastCode == "" || sb.lastTask != tid {
		t.Errorf("sandbox not called with expected args: lang=%s code=%q task=%s", sb.lastLang, sb.lastCode, sb.lastTask)
	}
}

func TestRun_HappyPath_PartialFailure(t *testing.T) {
	sb := &fakeDetailedSandbox{
		avail: true,
		cases: []domain.SandboxCaseResult{
			{Ordinal: 1, Passed: true},
			{Ordinal: 2, Passed: false, Actual: "5", Expected: "10"},
		},
	}
	tid := uuid.New()
	g, attID := newAlgoTestRig(t, sb, domain.AttemptTaskSolve, &tid, domain.StageAlgo)
	out, err := g.Run(context.Background(), RunAlgoInput{AttemptID: attID, Code: "x", Language: "go"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Passed != 1 || out.Total != 2 {
		t.Errorf("passed/total=%d/%d", out.Passed, out.Total)
	}
}

func TestRun_RuntimeError(t *testing.T) {
	sb := &fakeDetailedSandbox{
		avail: true,
		cases: []domain.SandboxCaseResult{
			{Ordinal: 1, Passed: false, Stderr: "panic: nil pointer"},
			{Ordinal: 2, Passed: false, Actual: "wrong"},
		},
	}
	tid := uuid.New()
	g, attID := newAlgoTestRig(t, sb, domain.AttemptTaskSolve, &tid, domain.StageAlgo)
	out, err := g.Run(context.Background(), RunAlgoInput{AttemptID: attID, Code: "x", Language: "go"})
	if err != nil {
		t.Fatalf("err=%v", err)
	}
	if out.Status != AlgoStatusRuntimeError {
		t.Errorf("status=%s, want runtime_error", out.Status)
	}
	if out.Passed != 0 {
		t.Errorf("passed=%d, want 0", out.Passed)
	}
}
