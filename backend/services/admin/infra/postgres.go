// Package infra contains the Postgres adapters for the admin domain plus the
// Redis Pub/Sub broadcaster used for hot-reloading dynamic_config.
//
// The admin domain is the ONLY legitimate place where tasks.solution_hint
// crosses the HTTP boundary (bible §3.14). The role check at ports is the
// load-bearing guard — infra returns the hint verbatim.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/admin/domain"
	admindb "druz9/admin/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// uniqueViolation is the PG SQLSTATE for a unique constraint violation.
const uniqueViolation = "23505"

// ─────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────

// Tasks is the persistence adapter for the tasks aggregate (tasks +
// test_cases + task_templates + follow_up_questions). Writes are transactional.
type Tasks struct {
	pool *pgxpool.Pool
	q    *admindb.Queries
}

// NewTasks wraps a pool.
func NewTasks(pool *pgxpool.Pool) *Tasks {
	return &Tasks{pool: pool, q: admindb.New(pool)}
}

// defaultListLimit / defaultPage — shared by task and anticheat listings.
const (
	defaultListLimit = 50
	defaultListPage  = 1
	maxListLimit     = 200
)

// List returns a filtered page of tasks plus the matching-total count.
//
// NOTE: the WHERE clause depends on which filters the caller provided, and
// sqlc cannot easily model optional predicates. We compose SQL by hand. Every
// user-supplied value is routed through positional binds.
func (t *Tasks) List(ctx context.Context, f domain.TaskFilter) (domain.TaskPage, error) {
	var (
		clauses []string
		args    []any
	)
	argPos := func() string { return fmt.Sprintf("$%d", len(args)+1) }

	if f.Section != nil && *f.Section != "" {
		clauses = append(clauses, "section = "+argPos())
		args = append(args, string(*f.Section))
	}
	if f.Difficulty != nil && *f.Difficulty != "" {
		clauses = append(clauses, "difficulty = "+argPos())
		args = append(args, string(*f.Difficulty))
	}
	if f.IsActive != nil {
		clauses = append(clauses, "is_active = "+argPos())
		args = append(args, *f.IsActive)
	}

	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}

	limit := f.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	page := f.Page
	if page <= 0 {
		page = defaultListPage
	}
	offset := (page - 1) * limit

	// Count
	countSQL := "SELECT COUNT(*)::bigint FROM tasks" + where
	var total int64
	if err := t.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return domain.TaskPage{}, fmt.Errorf("admin.Tasks.List: count: %w", err)
	}

	// Data
	listSQL := `SELECT id, slug, title_ru, title_en, description_ru, description_en,
                       difficulty, section, time_limit_sec, memory_limit_mb,
                       solution_hint, version, is_active, created_at, updated_at
                  FROM tasks` + where +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT %d OFFSET %d", limit, offset)

	rows, err := t.pool.Query(ctx, listSQL, args...)
	if err != nil {
		return domain.TaskPage{}, fmt.Errorf("admin.Tasks.List: query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.AdminTask, 0)
	for rows.Next() {
		var r taskRow
		if err := rows.Scan(
			&r.ID, &r.Slug, &r.TitleRu, &r.TitleEn,
			&r.DescriptionRu, &r.DescriptionEn,
			&r.Difficulty, &r.Section, &r.TimeLimitSec, &r.MemoryLimitMb,
			&r.SolutionHint, &r.Version, &r.IsActive, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return domain.TaskPage{}, fmt.Errorf("admin.Tasks.List: scan: %w", err)
		}
		out = append(out, taskFromRow(r))
	}
	if err := rows.Err(); err != nil {
		return domain.TaskPage{}, fmt.Errorf("admin.Tasks.List: rows: %w", err)
	}
	return domain.TaskPage{Items: out, Total: int(total), Page: page}, nil
}

// GetByID fetches a task plus its nested collections (test cases, templates,
// follow-up questions). Returns ErrNotFound when the row is missing.
func (t *Tasks) GetByID(ctx context.Context, id uuid.UUID) (domain.AdminTask, error) {
	row, err := t.q.GetTaskByID(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AdminTask{}, fmt.Errorf("admin.Tasks.GetByID: %w", domain.ErrNotFound)
		}
		return domain.AdminTask{}, fmt.Errorf("admin.Tasks.GetByID: %w", err)
	}
	return t.hydrate(ctx, t.q, taskRow{
		ID: row.ID, Slug: row.Slug, TitleRu: row.TitleRu, TitleEn: row.TitleEn,
		DescriptionRu: row.DescriptionRu, DescriptionEn: row.DescriptionEn,
		Difficulty: row.Difficulty, Section: row.Section,
		TimeLimitSec: row.TimeLimitSec, MemoryLimitMb: row.MemoryLimitMb,
		SolutionHint: row.SolutionHint, Version: row.Version, IsActive: row.IsActive,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	})
}

// Create inserts a new task + its nested rows in a single transaction.
func (t *Tasks) Create(ctx context.Context, in domain.TaskUpsert) (domain.AdminTask, error) {
	var out domain.AdminTask
	err := pgx.BeginFunc(ctx, t.pool, func(tx pgx.Tx) error {
		q := t.q.WithTx(tx)
		row, err := q.CreateTask(ctx, admindb.CreateTaskParams{
			Slug:          in.Slug,
			TitleRu:       in.TitleRU,
			TitleEn:       in.TitleEN,
			DescriptionRu: in.DescriptionRU,
			DescriptionEn: in.DescriptionEN,
			Difficulty:    string(in.Difficulty),
			Section:       string(in.Section),
			TimeLimitSec:  int32(in.TimeLimitSec),
			MemoryLimitMb: int32(in.MemoryLimitMB),
			SolutionHint:  pgText(in.SolutionHint),
			IsActive:      in.IsActive,
		})
		if err != nil {
			return mapUniqueErr(err)
		}
		taskID := fromPgUUID(row.ID)
		if err := insertChildren(ctx, q, row.ID, in); err != nil {
			return err
		}
		out = domain.AdminTask{
			ID: taskID, Slug: row.Slug, TitleRU: row.TitleRu, TitleEN: row.TitleEn,
			DescriptionRU: row.DescriptionRu, DescriptionEN: row.DescriptionEn,
			Difficulty: enums.Difficulty(row.Difficulty), Section: enums.Section(row.Section),
			TimeLimitSec: int(row.TimeLimitSec), MemoryLimitMB: int(row.MemoryLimitMb),
			SolutionHint: row.SolutionHint.String, Version: int(row.Version), IsActive: row.IsActive,
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
		}
		return t.fillChildren(ctx, q, taskID, &out)
	})
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.Tasks.Create: %w", err)
	}
	return out, nil
}

// Update refreshes a task + its nested rows (children are replaced en bloc).
func (t *Tasks) Update(ctx context.Context, id uuid.UUID, in domain.TaskUpsert) (domain.AdminTask, error) {
	var out domain.AdminTask
	err := pgx.BeginFunc(ctx, t.pool, func(tx pgx.Tx) error {
		q := t.q.WithTx(tx)
		row, err := q.UpdateTask(ctx, admindb.UpdateTaskParams{
			ID:            pgUUID(id),
			Slug:          in.Slug,
			TitleRu:       in.TitleRU,
			TitleEn:       in.TitleEN,
			DescriptionRu: in.DescriptionRU,
			DescriptionEn: in.DescriptionEN,
			Difficulty:    string(in.Difficulty),
			Section:       string(in.Section),
			TimeLimitSec:  int32(in.TimeLimitSec),
			MemoryLimitMb: int32(in.MemoryLimitMB),
			SolutionHint:  pgText(in.SolutionHint),
			IsActive:      in.IsActive,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrNotFound
			}
			return mapUniqueErr(err)
		}
		if err := q.DeleteTestCases(ctx, row.ID); err != nil {
			return fmt.Errorf("delete test_cases: %w", err)
		}
		if err := q.DeleteTaskTemplates(ctx, row.ID); err != nil {
			return fmt.Errorf("delete task_templates: %w", err)
		}
		if err := q.DeleteFollowUpQuestions(ctx, row.ID); err != nil {
			return fmt.Errorf("delete follow_up_questions: %w", err)
		}
		if err := insertChildren(ctx, q, row.ID, in); err != nil {
			return err
		}
		taskID := fromPgUUID(row.ID)
		out = domain.AdminTask{
			ID: taskID, Slug: row.Slug, TitleRU: row.TitleRu, TitleEN: row.TitleEn,
			DescriptionRU: row.DescriptionRu, DescriptionEN: row.DescriptionEn,
			Difficulty: enums.Difficulty(row.Difficulty), Section: enums.Section(row.Section),
			TimeLimitSec: int(row.TimeLimitSec), MemoryLimitMB: int(row.MemoryLimitMb),
			SolutionHint: row.SolutionHint.String, Version: int(row.Version), IsActive: row.IsActive,
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time,
		}
		return t.fillChildren(ctx, q, taskID, &out)
	})
	if err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.Tasks.Update: %w", err)
	}
	return out, nil
}

// hydrate loads the child collections for a task row.
func (t *Tasks) hydrate(ctx context.Context, q *admindb.Queries, r taskRow) (domain.AdminTask, error) {
	id := fromPgUUID(r.ID)
	out := taskFromRow(r)
	if err := t.fillChildren(ctx, q, id, &out); err != nil {
		return domain.AdminTask{}, fmt.Errorf("admin.Tasks.hydrate: %w", err)
	}
	return out, nil
}

func (t *Tasks) fillChildren(ctx context.Context, q *admindb.Queries, id uuid.UUID, out *domain.AdminTask) error {
	tcRows, err := q.ListTestCases(ctx, pgUUID(id))
	if err != nil {
		return fmt.Errorf("list test_cases: %w", err)
	}
	out.TestCases = make([]domain.TestCase, 0, len(tcRows))
	for _, r := range tcRows {
		out.TestCases = append(out.TestCases, domain.TestCase{
			ID:             fromPgUUID(r.ID),
			Input:          r.Input,
			ExpectedOutput: r.ExpectedOutput,
			IsHidden:       r.IsHidden,
			OrderNum:       int(r.OrderNum),
		})
	}
	tplRows, err := q.ListTaskTemplates(ctx, pgUUID(id))
	if err != nil {
		return fmt.Errorf("list task_templates: %w", err)
	}
	out.Templates = make([]domain.TaskTemplate, 0, len(tplRows))
	for _, r := range tplRows {
		out.Templates = append(out.Templates, domain.TaskTemplate{
			Language:    enums.Language(r.Language),
			StarterCode: r.StarterCode,
		})
	}
	fqRows, err := q.ListFollowUpQuestions(ctx, pgUUID(id))
	if err != nil {
		return fmt.Errorf("list follow_up_questions: %w", err)
	}
	out.FollowUpQuestions = make([]domain.FollowUpQuestion, 0, len(fqRows))
	for _, r := range fqRows {
		out.FollowUpQuestions = append(out.FollowUpQuestions, domain.FollowUpQuestion{
			ID:         fromPgUUID(r.ID),
			QuestionRU: r.QuestionRu,
			QuestionEN: r.QuestionEn,
			AnswerHint: r.AnswerHint.String,
			OrderNum:   int(r.OrderNum),
		})
	}
	return nil
}

// insertChildren inserts every nested row for the given task. Must run inside
// a transaction (q bound to a pgx.Tx).
func insertChildren(ctx context.Context, q *admindb.Queries, taskID pgtype.UUID, in domain.TaskUpsert) error {
	for i, tc := range in.TestCases {
		if _, err := q.InsertTestCase(ctx, admindb.InsertTestCaseParams{
			TaskID:         taskID,
			Input:          tc.Input,
			ExpectedOutput: tc.ExpectedOutput,
			IsHidden:       tc.IsHidden,
			OrderNum:       int32(tc.OrderNum),
		}); err != nil {
			return fmt.Errorf("insert test_cases[%d]: %w", i, err)
		}
	}
	for i, tpl := range in.Templates {
		if err := q.UpsertTaskTemplate(ctx, admindb.UpsertTaskTemplateParams{
			TaskID:      taskID,
			Language:    string(tpl.Language),
			StarterCode: tpl.StarterCode,
		}); err != nil {
			return fmt.Errorf("upsert task_templates[%d]: %w", i, err)
		}
	}
	for i, fq := range in.FollowUpQuestions {
		if _, err := q.InsertFollowUpQuestion(ctx, admindb.InsertFollowUpQuestionParams{
			TaskID:     taskID,
			QuestionRu: fq.QuestionRU,
			QuestionEn: fq.QuestionEN,
			AnswerHint: pgText(fq.AnswerHint),
			OrderNum:   int32(fq.OrderNum),
		}); err != nil {
			return fmt.Errorf("insert follow_up_questions[%d]: %w", i, err)
		}
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Companies
// ─────────────────────────────────────────────────────────────────────────

// Companies is the persistence adapter for the companies table.
type Companies struct {
	q *admindb.Queries
}

// NewCompanies wraps a pool.
func NewCompanies(pool *pgxpool.Pool) *Companies {
	return &Companies{q: admindb.New(pool)}
}

// List returns every company, ordered by name.
func (c *Companies) List(ctx context.Context) ([]domain.AdminCompany, error) {
	rows, err := c.q.ListCompanies(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.Companies.List: %w", err)
	}
	out := make([]domain.AdminCompany, 0, len(rows))
	for _, r := range rows {
		out = append(out, companyFromRow(r))
	}
	return out, nil
}

// Upsert creates or refreshes a company row keyed by slug.
func (c *Companies) Upsert(ctx context.Context, in domain.CompanyUpsert) (domain.AdminCompany, error) {
	row, err := c.q.UpsertCompany(ctx, admindb.UpsertCompanyParams{
		Slug:             in.Slug,
		Name:             in.Name,
		Difficulty:       string(in.Difficulty),
		MinLevelRequired: int32(in.MinLevelRequired),
	})
	if err != nil {
		return domain.AdminCompany{}, fmt.Errorf("admin.Companies.Upsert: %w", mapUniqueErr(err))
	}
	return companyFromRow(row), nil
}

// ─────────────────────────────────────────────────────────────────────────
// Dynamic config
// ─────────────────────────────────────────────────────────────────────────

// Config is the persistence adapter for the dynamic_config table.
type Config struct {
	q *admindb.Queries
}

// NewConfig wraps a pool.
func NewConfig(pool *pgxpool.Pool) *Config {
	return &Config{q: admindb.New(pool)}
}

// List returns every config entry, ordered by key.
func (c *Config) List(ctx context.Context) ([]domain.ConfigEntry, error) {
	rows, err := c.q.ListDynamicConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("admin.Config.List: %w", err)
	}
	out := make([]domain.ConfigEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, configFromRow(r))
	}
	return out, nil
}

// Get returns the entry at `key` or ErrNotFound.
func (c *Config) Get(ctx context.Context, key string) (domain.ConfigEntry, error) {
	row, err := c.q.GetDynamicConfig(ctx, key)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.ConfigEntry{}, domain.ErrNotFound
		}
		return domain.ConfigEntry{}, fmt.Errorf("admin.Config.Get: %w", err)
	}
	return configFromRow(row), nil
}

// Upsert creates or refreshes a config entry, stamping updated_at=now() and
// updated_by from the caller.
func (c *Config) Upsert(ctx context.Context, entry domain.ConfigEntry, updatedBy *uuid.UUID) (domain.ConfigEntry, error) {
	var by pgtype.UUID
	if updatedBy != nil {
		by = pgUUID(*updatedBy)
	}
	row, err := c.q.UpsertDynamicConfig(ctx, admindb.UpsertDynamicConfigParams{
		Key:         entry.Key,
		Value:       entry.Value,
		Type:        string(entry.Type),
		Description: pgText(entry.Description),
		UpdatedBy:   by,
	})
	if err != nil {
		return domain.ConfigEntry{}, fmt.Errorf("admin.Config.Upsert: %w", err)
	}
	return configFromRow(row), nil
}

// ─────────────────────────────────────────────────────────────────────────
// Anticheat
// ─────────────────────────────────────────────────────────────────────────

// Anticheat is the read-only persistence adapter for anticheat_signals.
type Anticheat struct {
	pool *pgxpool.Pool
	q    *admindb.Queries
}

// NewAnticheat wraps a pool.
func NewAnticheat(pool *pgxpool.Pool) *Anticheat {
	return &Anticheat{pool: pool, q: admindb.New(pool)}
}

// List returns a filtered list of anticheat signals.
//
// NOTE: the filter set (severity, from, limit) is sparsely populated so we
// hand-roll the SQL. The base-case sqlc query covers the no-filter path only.
func (a *Anticheat) List(ctx context.Context, f domain.AnticheatFilter) ([]domain.AnticheatSignal, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}

	// Fast path — no filters → use sqlc query.
	if f.Severity == nil && f.From == nil {
		rows, err := a.q.ListAnticheatSignalsBase(ctx, int32(limit))
		if err != nil {
			return nil, fmt.Errorf("admin.Anticheat.List: base: %w", err)
		}
		out := make([]domain.AnticheatSignal, 0, len(rows))
		for _, r := range rows {
			out = append(out, anticheatFromBaseRow(r))
		}
		return out, nil
	}

	// Filtered path — compose SQL.
	var (
		clauses []string
		args    []any
	)
	argPos := func() string { return fmt.Sprintf("$%d", len(args)+1) }

	if f.Severity != nil && *f.Severity != "" {
		clauses = append(clauses, "s.severity = "+argPos())
		args = append(args, string(*f.Severity))
	}
	if f.From != nil {
		clauses = append(clauses, "s.created_at >= "+argPos())
		args = append(args, f.From.UTC())
	}
	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}
	sql := `SELECT s.id, s.user_id, u.username, s.match_id, s.type, s.severity,
                   s.metadata, s.created_at
              FROM anticheat_signals s
              LEFT JOIN users u ON u.id = s.user_id` + where +
		fmt.Sprintf(" ORDER BY s.created_at DESC LIMIT %d", limit)

	rows, err := a.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("admin.Anticheat.List: query: %w", err)
	}
	defer rows.Close()

	out := make([]domain.AnticheatSignal, 0)
	for rows.Next() {
		var r anticheatRow
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.Username, &r.MatchID,
			&r.Type, &r.Severity, &r.Metadata, &r.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("admin.Anticheat.List: scan: %w", err)
		}
		out = append(out, anticheatFromRow(r))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("admin.Anticheat.List: rows: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Row structs + converters
// ─────────────────────────────────────────────────────────────────────────

// taskRow is the hand-rolled scan target for the task listing. Mirrors the
// SELECT column order in List / GetByID.
type taskRow struct {
	ID            pgtype.UUID
	Slug          string
	TitleRu       string
	TitleEn       string
	DescriptionRu string
	DescriptionEn string
	Difficulty    string
	Section       string
	TimeLimitSec  int32
	MemoryLimitMb int32
	SolutionHint  pgtype.Text
	Version       int32
	IsActive      bool
	CreatedAt     pgtype.Timestamptz
	UpdatedAt     pgtype.Timestamptz
}

func taskFromRow(r taskRow) domain.AdminTask {
	return domain.AdminTask{
		ID:            fromPgUUID(r.ID),
		Slug:          r.Slug,
		TitleRU:       r.TitleRu,
		TitleEN:       r.TitleEn,
		DescriptionRU: r.DescriptionRu,
		DescriptionEN: r.DescriptionEn,
		Difficulty:    enums.Difficulty(r.Difficulty),
		Section:       enums.Section(r.Section),
		TimeLimitSec:  int(r.TimeLimitSec),
		MemoryLimitMB: int(r.MemoryLimitMb),
		SolutionHint:  r.SolutionHint.String,
		Version:       int(r.Version),
		IsActive:      r.IsActive,
		CreatedAt:     r.CreatedAt.Time,
		UpdatedAt:     r.UpdatedAt.Time,
	}
}

func companyFromRow(r admindb.Company) domain.AdminCompany {
	sections := make([]enums.Section, 0, len(r.Sections))
	for _, s := range r.Sections {
		sections = append(sections, enums.Section(s))
	}
	return domain.AdminCompany{
		ID:               fromPgUUID(r.ID),
		Slug:             r.Slug,
		Name:             r.Name,
		Difficulty:       enums.DungeonTier(r.Difficulty),
		MinLevelRequired: int(r.MinLevelRequired),
		Sections:         sections,
		CreatedAt:        r.CreatedAt.Time,
	}
}

func configFromRow(r admindb.DynamicConfig) domain.ConfigEntry {
	out := domain.ConfigEntry{
		Key:         r.Key,
		Value:       append([]byte(nil), r.Value...),
		Type:        domain.ConfigType(r.Type),
		Description: r.Description.String,
		UpdatedAt:   r.UpdatedAt.Time,
	}
	if r.UpdatedBy.Valid {
		u := fromPgUUID(r.UpdatedBy)
		out.UpdatedBy = &u
	}
	return out
}

// anticheatRow mirrors the columns selected in both the sqlc base query and
// the hand-rolled filtered query.
type anticheatRow struct {
	ID        pgtype.UUID
	UserID    pgtype.UUID
	Username  pgtype.Text
	MatchID   pgtype.UUID
	Type      string
	Severity  string
	Metadata  []byte
	CreatedAt pgtype.Timestamptz
}

func anticheatFromRow(r anticheatRow) domain.AnticheatSignal {
	out := domain.AnticheatSignal{
		ID:        fromPgUUID(r.ID),
		UserID:    fromPgUUID(r.UserID),
		Username:  r.Username.String,
		Type:      enums.AnticheatSignalType(r.Type),
		Severity:  enums.SeverityLevel(r.Severity),
		Metadata:  append([]byte(nil), r.Metadata...),
		CreatedAt: r.CreatedAt.Time,
	}
	if r.MatchID.Valid {
		m := fromPgUUID(r.MatchID)
		out.MatchID = &m
	}
	return out
}

func anticheatFromBaseRow(r admindb.ListAnticheatSignalsBaseRow) domain.AnticheatSignal {
	return anticheatFromRow(anticheatRow{
		ID: r.ID, UserID: r.UserID, Username: r.Username, MatchID: r.MatchID,
		Type: r.Type, Severity: r.Severity, Metadata: r.Metadata, CreatedAt: r.CreatedAt,
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// mapUniqueErr maps a PG 23505 unique-violation onto domain.ErrConflict.
// Everything else is returned unchanged so the caller can wrap it.
func mapUniqueErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return domain.ErrConflict
	}
	return err
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

// The admin adapters do not depend on unused json helpers — reference the
// stdlib json package via _ to keep imports stable even if future helpers
// need it (e.g. metadata scrubbing).
var _ = json.Marshal

// stable sentinels referenced for compile-time verification.
var (
	_ domain.TaskRepo      = (*Tasks)(nil)
	_ domain.CompanyRepo   = (*Companies)(nil)
	_ domain.ConfigRepo    = (*Config)(nil)
	_ domain.AnticheatRepo = (*Anticheat)(nil)
)

// compile-time assertion that the adapter respects time.Time semantics.
var _ = time.Now
