// Package infra provides the PostgreSQL adapters, the Redis cache, the
// OpenRouter-backed SkillExtractor and the per-source HTTP parsers for the
// vacancies bounded context.
//
// SQL is hand-rolled (pgx) — the dynamic ListByFilter (variable WHERE clauses
// for sources, skills, salary, location) doesn't fit cleanly into sqlc's
// codegen, and the rest of the surface is a half-dozen straightforward
// statements that don't need a separate file.
package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/vacancies/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PgVacancyRepo implements domain.VacancyRepo against Postgres.
type PgVacancyRepo struct {
	pool *pgxpool.Pool
}

// NewPgVacancyRepo wraps a pool.
func NewPgVacancyRepo(pool *pgxpool.Pool) *PgVacancyRepo {
	return &PgVacancyRepo{pool: pool}
}

// Insert writes a brand-new row. Most callers should prefer UpsertByExternal
// to keep the parser idempotent; Insert is exposed for tests + admin tools.
func (r *PgVacancyRepo) Insert(ctx context.Context, v *domain.Vacancy) error {
	const q = `
INSERT INTO vacancies(
  source, external_id, url, title, company, location, employment_type,
  experience_level, salary_min, salary_max, currency, description,
  raw_skills, normalized_skills, posted_at, fetched_at, raw_json
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
RETURNING id, fetched_at`
	row := r.pool.QueryRow(ctx, q,
		string(v.Source), v.ExternalID, v.URL, v.Title, nullString(v.Company),
		nullString(v.Location), nullString(v.EmploymentType), nullString(v.ExperienceLevel),
		nullInt(v.SalaryMin), nullInt(v.SalaryMax), nullString(v.Currency), v.Description,
		v.RawSkills, v.NormalizedSkills, nullTime(v.PostedAt), pickFetchedAt(v.FetchedAt),
		v.RawJSON,
	)
	var fetched time.Time
	if err := row.Scan(&v.ID, &fetched); err != nil {
		return fmt.Errorf("vacancies.Pg.Insert: %w", err)
	}
	v.FetchedAt = fetched
	return nil
}

// UpsertByExternal performs INSERT … ON CONFLICT DO UPDATE on (source,
// external_id) and returns the resulting id. The CONFLICT branch refreshes
// every column except normalized_skills (the LLM is the source of truth there
// — and re-running the LLM eats budget).
func (r *PgVacancyRepo) UpsertByExternal(ctx context.Context, v *domain.Vacancy) (int64, error) {
	const q = `
INSERT INTO vacancies(
  source, external_id, url, title, company, location, employment_type,
  experience_level, salary_min, salary_max, currency, description,
  raw_skills, normalized_skills, posted_at, fetched_at, raw_json
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
ON CONFLICT (source, external_id) DO UPDATE SET
  url = EXCLUDED.url,
  title = EXCLUDED.title,
  company = EXCLUDED.company,
  location = EXCLUDED.location,
  employment_type = EXCLUDED.employment_type,
  experience_level = EXCLUDED.experience_level,
  salary_min = EXCLUDED.salary_min,
  salary_max = EXCLUDED.salary_max,
  currency = EXCLUDED.currency,
  description = EXCLUDED.description,
  raw_skills = EXCLUDED.raw_skills,
  posted_at = EXCLUDED.posted_at,
  fetched_at = EXCLUDED.fetched_at,
  raw_json = EXCLUDED.raw_json
RETURNING id`
	var id int64
	err := r.pool.QueryRow(ctx, q,
		string(v.Source), v.ExternalID, v.URL, v.Title, nullString(v.Company),
		nullString(v.Location), nullString(v.EmploymentType), nullString(v.ExperienceLevel),
		nullInt(v.SalaryMin), nullInt(v.SalaryMax), nullString(v.Currency), v.Description,
		v.RawSkills, v.NormalizedSkills, nullTime(v.PostedAt), pickFetchedAt(v.FetchedAt),
		v.RawJSON,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("vacancies.Pg.UpsertByExternal: %w", err)
	}
	v.ID = id
	return id, nil
}

// UpdateNormalizedSkills replaces the LLM-extracted skill list. Called from
// the post-sync extractor; never blocks the sync itself.
func (r *PgVacancyRepo) UpdateNormalizedSkills(ctx context.Context, id int64, skills []string) error {
	const q = `UPDATE vacancies SET normalized_skills = $2 WHERE id = $1`
	if _, err := r.pool.Exec(ctx, q, id, skills); err != nil {
		return fmt.Errorf("vacancies.Pg.UpdateNormalizedSkills: %w", err)
	}
	return nil
}

// GetByID fetches one row.
func (r *PgVacancyRepo) GetByID(ctx context.Context, id int64) (domain.Vacancy, error) {
	const q = `
SELECT id, source, external_id, url, title, company, location, employment_type,
       experience_level, salary_min, salary_max, currency, description,
       raw_skills, normalized_skills, posted_at, fetched_at, raw_json
  FROM vacancies WHERE id = $1`
	row := r.pool.QueryRow(ctx, q, id)
	v, err := scanVacancy(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Vacancy{}, fmt.Errorf("vacancies.Pg.GetByID: %w", domain.ErrNotFound)
		}
		return domain.Vacancy{}, fmt.Errorf("vacancies.Pg.GetByID: %w", err)
	}
	return v, nil
}

// ListByFilter dispatches a single SELECT with a dynamically-built WHERE
// clause. Pagination is LIMIT/OFFSET — adequate for the catalogue size we
// expect (hundreds-of-thousands max). A separate COUNT(*) gives the Page
// total so the frontend can render "page X of Y".
func (r *PgVacancyRepo) ListByFilter(ctx context.Context, f domain.ListFilter) (domain.Page, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	conds := []string{"1=1"}
	args := []any{}
	argi := 1
	if len(f.Sources) > 0 {
		ss := make([]string, 0, len(f.Sources))
		for _, s := range f.Sources {
			ss = append(ss, string(s))
		}
		conds = append(conds, fmt.Sprintf("source = ANY($%d)", argi))
		args = append(args, ss)
		argi++
	}
	if len(f.Skills) > 0 {
		// Require ALL selected skills to be present (AND); GIN @> is fast.
		conds = append(conds, fmt.Sprintf("normalized_skills @> $%d", argi))
		args = append(args, f.Skills)
		argi++
	}
	if f.SalaryMin > 0 {
		conds = append(conds, fmt.Sprintf("(salary_max IS NULL OR salary_max >= $%d) AND (salary_min IS NULL OR salary_min >= $%d - 50000)", argi, argi))
		args = append(args, f.SalaryMin)
		argi++
	}
	if strings.TrimSpace(f.Location) != "" {
		conds = append(conds, fmt.Sprintf("location ILIKE $%d", argi))
		args = append(args, "%"+strings.TrimSpace(f.Location)+"%")
		argi++
	}
	where := strings.Join(conds, " AND ")

	// Total — same WHERE, no LIMIT.
	var total int
	if err := r.pool.QueryRow(ctx, "SELECT COUNT(*) FROM vacancies WHERE "+where, args...).Scan(&total); err != nil {
		return domain.Page{}, fmt.Errorf("vacancies.Pg.ListByFilter.count: %w", err)
	}

	// Page — fetched_at desc keeps the freshest first; secondary order by id
	// for deterministic pagination when fetched_at ties.
	q := "SELECT id, source, external_id, url, title, company, location, employment_type, " +
		"experience_level, salary_min, salary_max, currency, description, " +
		"raw_skills, normalized_skills, posted_at, fetched_at, raw_json " +
		"FROM vacancies WHERE " + where +
		fmt.Sprintf(" ORDER BY fetched_at DESC, id DESC LIMIT $%d OFFSET $%d", argi, argi+1)
	args = append(args, limit, offset)
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return domain.Page{}, fmt.Errorf("vacancies.Pg.ListByFilter.query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.Vacancy, 0, limit)
	for rows.Next() {
		v, serr := scanVacancy(rows)
		if serr != nil {
			return domain.Page{}, fmt.Errorf("vacancies.Pg.ListByFilter.scan: %w", serr)
		}
		out = append(out, v)
	}
	if rerr := rows.Err(); rerr != nil {
		return domain.Page{}, fmt.Errorf("vacancies.Pg.ListByFilter.rows: %w", rerr)
	}
	return domain.Page{Items: out, Total: total, Limit: limit, Offset: offset}, nil
}

// ── helpers ───────────────────────────────────────────────────────────────

// scanRow narrows pgx.Row + pgx.Rows to the only method we need.
type scanRow interface {
	Scan(dest ...any) error
}

func scanVacancy(row scanRow) (domain.Vacancy, error) {
	var (
		v          domain.Vacancy
		src        string
		company    pgtype.Text
		location   pgtype.Text
		empType    pgtype.Text
		exp        pgtype.Text
		smin, smax pgtype.Int4
		curr       pgtype.Text
		postedAt   pgtype.Timestamptz
		fetchedAt  pgtype.Timestamptz
		rawJSON    []byte
	)
	if err := row.Scan(
		&v.ID, &src, &v.ExternalID, &v.URL, &v.Title, &company, &location, &empType,
		&exp, &smin, &smax, &curr, &v.Description,
		&v.RawSkills, &v.NormalizedSkills, &postedAt, &fetchedAt, &rawJSON,
	); err != nil {
		return domain.Vacancy{}, fmt.Errorf("vacancies.postgres.scanRow: %w", err)
	}
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
	return v, nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(n int) any {
	if n == 0 {
		return nil
	}
	return n
}

func nullTime(t *time.Time) any {
	if t == nil || t.IsZero() {
		return nil
	}
	return *t
}

func pickFetchedAt(t time.Time) time.Time {
	if t.IsZero() {
		return time.Now().UTC()
	}
	return t
}

// Compile-time check.
var _ domain.VacancyRepo = (*PgVacancyRepo)(nil)
