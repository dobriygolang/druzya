package app

import (
	"context"

	"druz9/mock_interview/domain"

	"github.com/google/uuid"
)

// orchestrator_legacy_fakes_test.go — hand-rolled in-memory stubs живут здесь,
// пока orchestrator_test.go не сконвертирован на mockgen. Wave 13 deferred с
// конкретным rationale: orchestrator имеет 21 deeply-interconnected fake с
// circular references (fakePipelines ↔ fakePipelineStages ↔ fakeAttempts +
// fakeJudge + fakeCanvasJudge + fakeStrictnessResolver), что требует ~600+
// строк wire-code и custom hand-rolled state-machine на DoAndReturn. ROI
// слабый: orchestrator_test покрывает один use case (Orchestrator) и эти
// fakes уже behave as stateful simulators. Перевод смысл имеет только
// после рефакторинга самого Orchestrator (отдельная задача BBB).
//
// Эти ДВА типа фейков сохранены здесь специально для использования из
// orchestrator_test.go. Они НЕ переиспользуются в handlers_test (тот
// сконвертирован на mockgen).

type fakeTaskRepo struct {
	rows map[uuid.UUID]domain.MockTask
}

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
func (f *fakeCompanyStageRepo) Delete(context.Context, uuid.UUID, domain.StageKind) error {
	return nil
}
func (f *fakeCompanyStageRepo) ReplaceAll(_ context.Context, companyID uuid.UUID, ss []domain.CompanyStage) error {
	if f.rows == nil {
		f.rows = map[uuid.UUID][]domain.CompanyStage{}
	}
	f.rows[companyID] = append([]domain.CompanyStage(nil), ss...)
	return nil
}
