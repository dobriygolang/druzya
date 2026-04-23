package app

import (
	"context"
	"fmt"

	"druz9/vacancies/domain"
)

// ListVacancies is the use case behind GET /vacancies.
type ListVacancies struct {
	Repo domain.VacancyRepo
}

// Do clamps the filter and forwards to the repo. The cache (if wired) lives
// in the repo wrapper.
func (l *ListVacancies) Do(ctx context.Context, f domain.ListFilter) (domain.Page, error) {
	if f.Limit < 0 {
		f.Limit = 0
	}
	page, err := l.Repo.ListByFilter(ctx, f)
	if err != nil {
		return domain.Page{}, fmt.Errorf("vacancies.ListVacancies: %w", err)
	}
	return page, nil
}

// GetVacancy is the use case behind GET /vacancies/{id}.
type GetVacancy struct {
	Repo domain.VacancyRepo
}

// Do reads one vacancy by id.
func (g *GetVacancy) Do(ctx context.Context, id int64) (domain.Vacancy, error) {
	v, err := g.Repo.GetByID(ctx, id)
	if err != nil {
		return domain.Vacancy{}, fmt.Errorf("vacancies.GetVacancy: %w", err)
	}
	return v, nil
}
