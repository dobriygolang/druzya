// Package infra contains the Postgres repos + the Judge0 stub for the
// daily domain. Queries are served by the sqlc-generated dailydb package; a
// small number of dynamic or cross-cutting queries stay hand-rolled and are
// tagged with an explanatory NOTE.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/daily/domain"
	dailydb "druz9/daily/infra/db"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─────────────────────────────────────────────────────────────────────────
// TasksKatas implements TaskRepo, SkillRepo and KataRepo.
// ─────────────────────────────────────────────────────────────────────────

// TasksKatas is the shared Postgres adapter for tasks / skills / katas.
type TasksKatas struct {
	pool *pgxpool.Pool
	q    *dailydb.Queries
}

// NewTasksKatas wraps a pool.
func NewTasksKatas(pool *pgxpool.Pool) *TasksKatas {
	return &TasksKatas{pool: pool, q: dailydb.New(pool)}
}

// ListActiveBySectionDifficulty returns candidates. solution_hint is NOT selected.
func (p *TasksKatas) ListActiveBySectionDifficulty(ctx context.Context, section enums.Section, diff enums.Difficulty) ([]domain.TaskPublic, error) {
	if !section.IsValid() {
		return nil, fmt.Errorf("daily.TasksKatas.ListActiveBySectionDifficulty: invalid section %q", section)
	}
	if !diff.IsValid() {
		return nil, fmt.Errorf("daily.TasksKatas.ListActiveBySectionDifficulty: invalid diff %q", diff)
	}
	rows, err := p.q.ListActiveTasks(ctx, dailydb.ListActiveTasksParams{
		Section:    string(section),
		Difficulty: string(diff),
	})
	if err != nil {
		return nil, fmt.Errorf("daily.TasksKatas.ListActiveBySectionDifficulty: %w", err)
	}
	out := make([]domain.TaskPublic, 0, len(rows))
	for _, r := range rows {
		t, err := taskPublicFromActiveRow(r)
		if err != nil {
			return nil, fmt.Errorf("daily.TasksKatas.ListActiveBySectionDifficulty: %w", err)
		}
		out = append(out, t)
	}
	return out, nil
}

// GetByID fetches a single task, without solution_hint.
func (p *TasksKatas) GetByID(ctx context.Context, id uuid.UUID) (domain.TaskPublic, error) {
	r, err := p.q.GetTaskPublic(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.TaskPublic{}, fmt.Errorf("daily.TasksKatas.GetByID: %w", domain.ErrNotFound)
		}
		return domain.TaskPublic{}, fmt.Errorf("daily.TasksKatas.GetByID: %w", err)
	}
	return taskPublicFromTaskRow(r)
}

// WeakestNode picks the lowest-progress skill node for the user.
func (p *TasksKatas) WeakestNode(ctx context.Context, userID uuid.UUID) (domain.NodeWeakness, error) {
	r, err := p.q.WeakestSkillNode(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.NodeWeakness{
				Section:    enums.SectionAlgorithms,
				Difficulty: enums.DifficultyEasy,
				Progress:   0,
			}, nil
		}
		return domain.NodeWeakness{}, fmt.Errorf("daily.TasksKatas.WeakestNode: %w", err)
	}
	return domain.NodeWeakness{
		Section:    sectionFromNodeKey(r.NodeKey),
		Difficulty: domain.DifficultyForProgress(int(r.Progress)),
		Progress:   int(r.Progress),
	}, nil
}

// GetOrAssign atomically upserts today's assignment.
//
// NOTE: sqlc only generates AssignDailyKata (INSERT…ON CONFLICT DO NOTHING
// RETURNING) — it can't model the "if inserted return with created=true, else
// SELECT the existing row" CTE fusion. Compose here: try insert, on zero rows
// returned fall back to GetDailyKata.
func (p *TasksKatas) GetOrAssign(ctx context.Context, userID uuid.UUID, date time.Time, taskID uuid.UUID, isCursed, isWeeklyBoss bool) (domain.Assignment, bool, error) {
	d := date.UTC().Truncate(24 * time.Hour)
	pgDate := pgtype.Date{Time: d, Valid: true}

	insRow, err := p.q.AssignDailyKata(ctx, dailydb.AssignDailyKataParams{
		UserID:       pgUUID(userID),
		KataDate:     pgDate,
		TaskID:       pgUUID(taskID),
		IsCursed:     isCursed,
		IsWeeklyBoss: isWeeklyBoss,
	})
	switch {
	case err == nil:
		return assignmentFromAssignRow(userID, d, insRow), true, nil
	case errors.Is(err, pgx.ErrNoRows):
		// Row existed — fetch it.
		existing, getErr := p.q.GetDailyKata(ctx, dailydb.GetDailyKataParams{
			UserID:   pgUUID(userID),
			KataDate: pgDate,
		})
		if getErr != nil {
			return domain.Assignment{}, false, fmt.Errorf("daily.TasksKatas.GetOrAssign: read existing: %w", getErr)
		}
		return assignmentFromGetRow(userID, d, existing), false, nil
	default:
		return domain.Assignment{}, false, fmt.Errorf("daily.TasksKatas.GetOrAssign: %w", err)
	}
}

// MarkSubmitted records pass/fail on today's assignment.
func (p *TasksKatas) MarkSubmitted(ctx context.Context, userID uuid.UUID, date time.Time, passed bool) error {
	d := date.UTC().Truncate(24 * time.Hour)
	affected, err := p.q.MarkDailyKataSubmitted(ctx, dailydb.MarkDailyKataSubmittedParams{
		UserID:   pgUUID(userID),
		KataDate: pgtype.Date{Time: d, Valid: true},
		Passed:   pgtype.Bool{Bool: passed, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("daily.TasksKatas.MarkSubmitted: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("daily.TasksKatas.MarkSubmitted: %w", domain.ErrNotFound)
	}
	return nil
}

// HistoryLast30 returns the last 30 days.
func (p *TasksKatas) HistoryLast30(ctx context.Context, userID uuid.UUID, today time.Time) ([]domain.HistoryEntry, error) {
	from := today.AddDate(0, 0, -29)
	rows, err := p.q.ListKataHistory(ctx, dailydb.ListKataHistoryParams{
		UserID:     pgUUID(userID),
		KataDate:   pgtype.Date{Time: from, Valid: true},
		KataDate_2: pgtype.Date{Time: today, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("daily.TasksKatas.HistoryLast30: %w", err)
	}
	out := make([]domain.HistoryEntry, 0, len(rows))
	for _, r := range rows {
		e := domain.HistoryEntry{
			Date:       r.KataDate.Time,
			TaskID:     fromPgUUID(r.TaskID),
			FreezeUsed: r.FreezeUsed,
		}
		if r.Passed.Valid {
			b := r.Passed.Bool
			e.Passed = &b
		}
		out = append(out, e)
	}
	return out, nil
}

// HistoryByYear returns every daily_kata_history row for the given UTC
// calendar year. Bounds are pre-computed so the predicate stays sargable
// against idx_kata_history_user_date.
func (p *TasksKatas) HistoryByYear(ctx context.Context, userID uuid.UUID, year int) ([]domain.HistoryEntry, error) {
	if year < 2000 || year > 9999 {
		return nil, fmt.Errorf("daily.TasksKatas.HistoryByYear: year out of range %d", year)
	}
	from := time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(year, time.December, 31, 0, 0, 0, 0, time.UTC)
	rows, err := p.q.ListKataHistoryByYear(ctx, dailydb.ListKataHistoryByYearParams{
		UserID:     pgUUID(userID),
		KataDate:   pgtype.Date{Time: from, Valid: true},
		KataDate_2: pgtype.Date{Time: to, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("daily.TasksKatas.HistoryByYear: %w", err)
	}
	out := make([]domain.HistoryEntry, 0, len(rows))
	for _, r := range rows {
		e := domain.HistoryEntry{
			Date:       r.KataDate.Time,
			TaskID:     fromPgUUID(r.TaskID),
			FreezeUsed: r.FreezeUsed,
		}
		if r.Passed.Valid {
			b := r.Passed.Bool
			e.Passed = &b
		}
		out = append(out, e)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// StreakRepo
// ─────────────────────────────────────────────────────────────────────────

// Streaks implements domain.StreakRepo.
type Streaks struct {
	pool *pgxpool.Pool
	q    *dailydb.Queries
}

// NewStreaks wraps a pool.
func NewStreaks(pool *pgxpool.Pool) *Streaks {
	return &Streaks{pool: pool, q: dailydb.New(pool)}
}

// Get returns the streak row.
func (p *Streaks) Get(ctx context.Context, userID uuid.UUID) (domain.StreakState, error) {
	r, err := p.q.GetStreak(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.StreakState{}, domain.ErrNotFound
		}
		return domain.StreakState{}, fmt.Errorf("daily.Streaks.Get: %w", err)
	}
	s := domain.StreakState{
		CurrentStreak: int(r.CurrentStreak),
		LongestStreak: int(r.LongestStreak),
		FreezeTokens:  int(r.FreezeTokens),
	}
	if r.LastKataDate.Valid {
		t := r.LastKataDate.Time
		s.LastKataDate = &t
	}
	return s, nil
}

// Update upserts the streak row.
func (p *Streaks) Update(ctx context.Context, userID uuid.UUID, s domain.StreakState) error {
	var last pgtype.Date
	if s.LastKataDate != nil {
		last = pgtype.Date{Time: *s.LastKataDate, Valid: true}
	}
	if err := p.q.UpsertStreak(ctx, dailydb.UpsertStreakParams{
		UserID:        pgUUID(userID),
		CurrentStreak: int32(s.CurrentStreak),
		LongestStreak: int32(s.LongestStreak),
		FreezeTokens:  int32(s.FreezeTokens),
		LastKataDate:  last,
	}); err != nil {
		return fmt.Errorf("daily.Streaks.Update: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// CalendarRepo
// ─────────────────────────────────────────────────────────────────────────

// Calendars implements domain.CalendarRepo.
type Calendars struct {
	pool *pgxpool.Pool
	q    *dailydb.Queries
}

// NewCalendars wraps a pool.
func NewCalendars(pool *pgxpool.Pool) *Calendars {
	return &Calendars{pool: pool, q: dailydb.New(pool)}
}

// GetActive returns the upcoming calendar, ErrNotFound otherwise.
func (p *Calendars) GetActive(ctx context.Context, userID uuid.UUID, today time.Time) (domain.InterviewCalendar, error) {
	r, err := p.q.GetActiveCalendar(ctx, dailydb.GetActiveCalendarParams{
		UserID:        pgUUID(userID),
		InterviewDate: pgtype.Date{Time: today, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.InterviewCalendar{}, domain.ErrNotFound
		}
		return domain.InterviewCalendar{}, fmt.Errorf("daily.Calendars.GetActive: %w", err)
	}
	return domain.InterviewCalendar{
		ID:            fromPgUUID(r.ID),
		UserID:        fromPgUUID(r.UserID),
		CompanyID:     fromPgUUID(r.CompanyID),
		Role:          r.Role,
		InterviewDate: r.InterviewDate.Time,
		CurrentLevel:  pgText(r.CurrentLevel),
		ReadinessPct:  int(r.ReadinessPct),
		UpdatedAt:     r.UpdatedAt.Time,
	}, nil
}

// Upsert replaces any active calendar with the provided one.
//
// NOTE: the MVP semantics are "one active calendar per user" — we clear then
// insert. sqlc only generates the INSERT half; the DELETE is kept hand-rolled.
func (p *Calendars) Upsert(ctx context.Context, c domain.InterviewCalendar) (domain.InterviewCalendar, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.Calendars.Upsert: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, delErr := tx.Exec(ctx,
		`DELETE FROM interview_calendars WHERE user_id=$1 AND interview_date >= CURRENT_DATE`, c.UserID); delErr != nil {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.Calendars.Upsert: clear: %w", delErr)
	}
	qtx := p.q.WithTx(tx)
	row, err := qtx.UpsertCalendar(ctx, dailydb.UpsertCalendarParams{
		UserID:        pgUUID(c.UserID),
		CompanyID:     pgUUID(c.CompanyID),
		Role:          c.Role,
		InterviewDate: pgtype.Date{Time: c.InterviewDate, Valid: true},
		CurrentLevel:  pgtype.Text{String: c.CurrentLevel, Valid: c.CurrentLevel != ""},
	})
	if err != nil {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.Calendars.Upsert: insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.InterviewCalendar{}, fmt.Errorf("daily.Calendars.Upsert: commit: %w", err)
	}
	return domain.InterviewCalendar{
		ID:            fromPgUUID(row.ID),
		UserID:        fromPgUUID(row.UserID),
		CompanyID:     fromPgUUID(row.CompanyID),
		Role:          row.Role,
		InterviewDate: row.InterviewDate.Time,
		CurrentLevel:  pgText(row.CurrentLevel),
		ReadinessPct:  int(row.ReadinessPct),
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────
// AutopsyRepo
// ─────────────────────────────────────────────────────────────────────────

// Autopsies implements domain.AutopsyRepo.
type Autopsies struct {
	pool *pgxpool.Pool
	q    *dailydb.Queries
}

// NewAutopsies wraps a pool.
func NewAutopsies(pool *pgxpool.Pool) *Autopsies {
	return &Autopsies{pool: pool, q: dailydb.New(pool)}
}

// Create inserts the row and returns it hydrated.
func (p *Autopsies) Create(ctx context.Context, a domain.Autopsy) (domain.Autopsy, error) {
	if !a.Section.IsValid() || !a.Outcome.IsValid() || !a.Status.IsValid() {
		return domain.Autopsy{}, fmt.Errorf("daily.Autopsies.Create: invalid enums")
	}
	var iDate pgtype.Date
	if a.InterviewDate != nil {
		iDate = pgtype.Date{Time: *a.InterviewDate, Valid: true}
	}
	row, err := p.q.CreateAutopsy(ctx, dailydb.CreateAutopsyParams{
		UserID:        pgUUID(a.UserID),
		CompanyID:     pgUUID(a.CompanyID),
		Section:       a.Section.String(),
		Outcome:       a.Outcome.String(),
		InterviewDate: iDate,
		QuestionsRaw:  pgtype.Text{String: a.Questions, Valid: true},
		AnswersRaw:    pgtype.Text{String: a.Answers, Valid: true},
		Notes:         pgtype.Text{String: a.Notes, Valid: a.Notes != ""},
		Status:        a.Status.String(),
		ShareSlug:     pgtype.Text{String: a.ShareSlug, Valid: a.ShareSlug != ""},
	})
	if err != nil {
		return domain.Autopsy{}, fmt.Errorf("daily.Autopsies.Create: %w", err)
	}
	return autopsyFromRow(row), nil
}

// Get loads an autopsy by id.
func (p *Autopsies) Get(ctx context.Context, id uuid.UUID) (domain.Autopsy, error) {
	row, err := p.q.GetAutopsy(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Autopsy{}, fmt.Errorf("daily.Autopsies.Get: %w", domain.ErrNotFound)
		}
		return domain.Autopsy{}, fmt.Errorf("daily.Autopsies.Get: %w", err)
	}
	return autopsyFromRow(row), nil
}

// MarkReady sets status=ready + writes analysis JSON.
func (p *Autopsies) MarkReady(ctx context.Context, id uuid.UUID, analysisJSON []byte) error {
	affected, err := p.q.MarkAutopsyReady(ctx, dailydb.MarkAutopsyReadyParams{
		ID:      pgUUID(id),
		Column2: analysisJSON,
	})
	if err != nil {
		return fmt.Errorf("daily.Autopsies.MarkReady: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("daily.Autopsies.MarkReady: %w", domain.ErrNotFound)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Judge0 stub
// ─────────────────────────────────────────────────────────────────────────

// FakeJudge0 always passes.
// STUB: real Judge0 client hitting http://judge0-server:2358/submissions.
type FakeJudge0 struct{}

// NewFakeJudge0 returns the stub.
func NewFakeJudge0() *FakeJudge0 { return &FakeJudge0{} }

// Submit always reports success.
func (*FakeJudge0) Submit(_ context.Context, _ string, _ string, _ domain.TaskPublic) (bool, int, int, error) {
	return true, 1, 1, nil
}

// ── helpers ────────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func pgText(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

// sectionFromNodeKey maps catalogue keys → sections. STUB: share catalogue via
// admin CMS once that service exists; same table of truth as profile/app/atlas.go.
func sectionFromNodeKey(key string) enums.Section {
	switch {
	case len(key) >= 4 && key[:4] == "algo":
		return enums.SectionAlgorithms
	case len(key) >= 3 && key[:3] == "sql":
		return enums.SectionSQL
	case len(key) >= 2 && key[:2] == "go":
		return enums.SectionGo
	case len(key) >= 2 && key[:2] == "sd":
		return enums.SectionSystemDesign
	case len(key) >= 3 && key[:3] == "beh":
		return enums.SectionBehavioral
	default:
		return enums.SectionAlgorithms
	}
}

func taskPublicFromActiveRow(r dailydb.ListActiveTasksRow) (domain.TaskPublic, error) {
	return assembleTask(fromPgUUID(r.ID), r.Slug, r.TitleRu, r.DescriptionRu, r.Difficulty, r.Section, r.TimeLimitSec, r.MemoryLimitMb)
}

func taskPublicFromTaskRow(r dailydb.GetTaskPublicRow) (domain.TaskPublic, error) {
	return assembleTask(fromPgUUID(r.ID), r.Slug, r.TitleRu, r.DescriptionRu, r.Difficulty, r.Section, r.TimeLimitSec, r.MemoryLimitMb)
}

func assembleTask(id uuid.UUID, slug, title, desc, difficulty, section string, timeLimit, memoryLimit int32) (domain.TaskPublic, error) {
	d := enums.Difficulty(difficulty)
	sec := enums.Section(section)
	if !d.IsValid() || !sec.IsValid() {
		return domain.TaskPublic{}, fmt.Errorf("invalid enum row diff=%q section=%q", difficulty, section)
	}
	return domain.TaskPublic{
		ID:            id,
		Slug:          slug,
		Title:         title,
		Description:   desc,
		Difficulty:    d,
		Section:       sec,
		TimeLimitSec:  int(timeLimit),
		MemoryLimitMB: int(memoryLimit),
		StarterCode:   map[string]string{},
	}, nil
}

func assignmentFromAssignRow(userID uuid.UUID, d time.Time, r dailydb.AssignDailyKataRow) domain.Assignment {
	out := domain.Assignment{
		UserID:       userID,
		KataDate:     d,
		TaskID:       fromPgUUID(r.TaskID),
		IsCursed:     r.IsCursed,
		IsWeeklyBoss: r.IsWeeklyBoss,
		FreezeUsed:   r.FreezeUsed,
	}
	if r.Passed.Valid {
		b := r.Passed.Bool
		out.Passed = &b
	}
	if r.SubmittedAt.Valid {
		t := r.SubmittedAt.Time
		out.SubmittedAt = &t
	}
	return out
}

func assignmentFromGetRow(userID uuid.UUID, d time.Time, r dailydb.GetDailyKataRow) domain.Assignment {
	out := domain.Assignment{
		UserID:       userID,
		KataDate:     d,
		TaskID:       fromPgUUID(r.TaskID),
		IsCursed:     r.IsCursed,
		IsWeeklyBoss: r.IsWeeklyBoss,
		FreezeUsed:   r.FreezeUsed,
	}
	if r.Passed.Valid {
		b := r.Passed.Bool
		out.Passed = &b
	}
	if r.SubmittedAt.Valid {
		t := r.SubmittedAt.Time
		out.SubmittedAt = &t
	}
	return out
}

func autopsyFromRow(r dailydb.InterviewAutopsy) domain.Autopsy {
	out := domain.Autopsy{
		ID:           fromPgUUID(r.ID),
		UserID:       fromPgUUID(r.UserID),
		CompanyID:    fromPgUUID(r.CompanyID),
		Section:      enums.Section(r.Section),
		Outcome:      domain.AutopsyOutcome(r.Outcome),
		Questions:    pgText(r.QuestionsRaw),
		Answers:      pgText(r.AnswersRaw),
		Notes:        pgText(r.Notes),
		Status:       domain.AutopsyStatus(r.Status),
		AnalysisJSON: r.AnalysisJson,
		ShareSlug:    pgText(r.ShareSlug),
		CreatedAt:    r.CreatedAt.Time,
	}
	if r.InterviewDate.Valid {
		t := r.InterviewDate.Time
		out.InterviewDate = &t
	}
	return out
}

// Interface guards.
var (
	_ domain.TaskRepo     = (*TasksKatas)(nil)
	_ domain.SkillRepo    = (*TasksKatas)(nil)
	_ domain.KataRepo     = (*TasksKatas)(nil)
	_ domain.StreakRepo   = (*Streaks)(nil)
	_ domain.CalendarRepo = (*Calendars)(nil)
	_ domain.AutopsyRepo  = (*Autopsies)(nil)
	_ domain.Judge0Client = (*FakeJudge0)(nil)
)
