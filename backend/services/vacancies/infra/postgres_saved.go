package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/vacancies/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PgSavedRepo implements domain.SavedVacancyRepo against Postgres.
type PgSavedRepo struct {
	pool *pgxpool.Pool
}

// NewPgSavedRepo wraps a pool.
func NewPgSavedRepo(pool *pgxpool.Pool) *PgSavedRepo {
	return &PgSavedRepo{pool: pool}
}

// Save inserts a new tracked vacancy. The (user_id, vacancy_id) UNIQUE means
// a re-Save returns ErrInvalidStatus … no, it'd be a UNIQUE-violation. Wrap
// it cleanly so the handler can map to 409.
func (r *PgSavedRepo) Save(ctx context.Context, s *domain.SavedVacancy) error {
	if !domain.IsValidStatus(s.Status) {
		s.Status = domain.StatusSaved
	}
	const q = `
INSERT INTO saved_vacancies(user_id, vacancy_id, status, notes)
VALUES ($1,$2,$3,$4)
RETURNING id, saved_at, updated_at`
	row := r.pool.QueryRow(ctx, q, s.UserID, s.VacancyID, string(s.Status), nullString(s.Notes))
	var savedAt, updatedAt time.Time
	if err := row.Scan(&s.ID, &savedAt, &updatedAt); err != nil {
		return fmt.Errorf("vacancies.PgSaved.Save: %w", err)
	}
	s.SavedAt = savedAt
	s.UpdatedAt = updatedAt
	return nil
}

// Update mutates status + notes on an existing row. Scoped by user_id so a
// caller can never update someone else's tracked vacancy.
func (r *PgSavedRepo) Update(ctx context.Context, s *domain.SavedVacancy) error {
	if !domain.IsValidStatus(s.Status) {
		return fmt.Errorf("vacancies.PgSaved.Update: %w", domain.ErrInvalidStatus)
	}
	const q = `
UPDATE saved_vacancies
   SET status = $3, notes = $4, updated_at = now()
 WHERE id = $1 AND user_id = $2
RETURNING saved_at, updated_at`
	row := r.pool.QueryRow(ctx, q, s.ID, s.UserID, string(s.Status), nullString(s.Notes))
	var savedAt, updatedAt time.Time
	if err := row.Scan(&savedAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("vacancies.PgSaved.Update: %w", domain.ErrNotFound)
		}
		return fmt.Errorf("vacancies.PgSaved.Update: %w", err)
	}
	s.SavedAt = savedAt
	s.UpdatedAt = updatedAt
	return nil
}

// GetByID is the read used by Update + Delete to authorise.
func (r *PgSavedRepo) GetByID(ctx context.Context, userID uuid.UUID, id int64) (domain.SavedVacancy, error) {
	const q = `
SELECT id, user_id, vacancy_id, status, notes, saved_at, updated_at
  FROM saved_vacancies WHERE id = $1 AND user_id = $2`
	row := r.pool.QueryRow(ctx, q, id, userID)
	var (
		s         domain.SavedVacancy
		notes     pgtype.Text
		status    string
		savedAt   time.Time
		updatedAt time.Time
	)
	if err := row.Scan(&s.ID, &s.UserID, &s.VacancyID, &status, &notes, &savedAt, &updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.GetByID: %w", domain.ErrNotFound)
		}
		return domain.SavedVacancy{}, fmt.Errorf("vacancies.PgSaved.GetByID: %w", err)
	}
	s.Status = domain.SavedStatus(status)
	s.Notes = notes.String
	s.SavedAt = savedAt
	s.UpdatedAt = updatedAt
	return s, nil
}

// Delete removes the user's tracked entry.
func (r *PgSavedRepo) Delete(ctx context.Context, userID uuid.UUID, id int64) error {
	const q = `DELETE FROM saved_vacancies WHERE id = $1 AND user_id = $2`
	tag, err := r.pool.Exec(ctx, q, id, userID)
	if err != nil {
		return fmt.Errorf("vacancies.PgSaved.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("vacancies.PgSaved.Delete: %w", domain.ErrNotFound)
	}
	return nil
}

// ListByUser eager-loads the joined vacancy in one query so the kanban page
// renders without N+1 fetches.
func (r *PgSavedRepo) ListByUser(ctx context.Context, userID uuid.UUID) ([]domain.SavedWithVacancy, error) {
	const q = `
SELECT s.id, s.user_id, s.vacancy_id, s.status, s.notes, s.saved_at, s.updated_at,
       v.id, v.source, v.external_id, v.url, v.title, v.company, v.location, v.employment_type,
       v.experience_level, v.salary_min, v.salary_max, v.currency, v.description,
       v.raw_skills, v.normalized_skills, v.posted_at, v.fetched_at, v.raw_json
  FROM saved_vacancies s
  JOIN vacancies v ON v.id = s.vacancy_id
 WHERE s.user_id = $1
 ORDER BY s.updated_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("vacancies.PgSaved.ListByUser: %w", err)
	}
	defer rows.Close()

	out := []domain.SavedWithVacancy{}
	for rows.Next() {
		var (
			s         domain.SavedVacancy
			v         domain.Vacancy
			notes     pgtype.Text
			status    string
			savedAt   time.Time
			updatedAt time.Time
			src       string
			company   pgtype.Text
			location  pgtype.Text
			empType   pgtype.Text
			exp       pgtype.Text
			smin      pgtype.Int4
			smax      pgtype.Int4
			curr      pgtype.Text
			postedAt  pgtype.Timestamptz
			fetchedAt pgtype.Timestamptz
			rawJSON   []byte
		)
		if err := rows.Scan(
			&s.ID, &s.UserID, &s.VacancyID, &status, &notes, &savedAt, &updatedAt,
			&v.ID, &src, &v.ExternalID, &v.URL, &v.Title, &company, &location, &empType,
			&exp, &smin, &smax, &curr, &v.Description,
			&v.RawSkills, &v.NormalizedSkills, &postedAt, &fetchedAt, &rawJSON,
		); err != nil {
			return nil, fmt.Errorf("vacancies.PgSaved.ListByUser.scan: %w", err)
		}
		s.Status = domain.SavedStatus(status)
		s.Notes = notes.String
		s.SavedAt = savedAt
		s.UpdatedAt = updatedAt
		v.Source = domain.Source(src)
		v.Company = company.String
		v.Location = location.String
		v.EmploymentType = empType.String
		v.ExperienceLevel = exp.String
		v.Currency = curr.String
		if smin.Valid {
			v.SalaryMin = int(smin.Int32)
		}
		if smax.Valid {
			v.SalaryMax = int(smax.Int32)
		}
		if postedAt.Valid {
			t := postedAt.Time
			v.PostedAt = &t
		}
		if fetchedAt.Valid {
			v.FetchedAt = fetchedAt.Time
		}
		v.RawJSON = rawJSON
		if v.RawSkills == nil {
			v.RawSkills = []string{}
		}
		if v.NormalizedSkills == nil {
			v.NormalizedSkills = []string{}
		}
		out = append(out, domain.SavedWithVacancy{Saved: s, Vacancy: v})
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("vacancies.PgSaved.ListByUser.rows: %w", rerr)
	}
	return out, nil
}

// Compile-time check.
var _ domain.SavedVacancyRepo = (*PgSavedRepo)(nil)
