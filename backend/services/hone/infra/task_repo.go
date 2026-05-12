// task_repo.go — TaskBoard persistence (hone_tasks + hone_task_comments).
//
// Hand-rolled pgx (no sqlc) because the repo is small, the queries are
// already parameterised cleanly, and adding a brand-new sqlc bundle
// just for two tables would be more setup than upkeep.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TaskRepo implements domain.TaskRepo over hone_tasks + hone_task_comments.
type TaskRepo struct {
	pool *pgxpool.Pool
}

// NewTaskRepo wires a TaskRepo.
func NewTaskRepo(pool *pgxpool.Pool) *TaskRepo { return &TaskRepo{pool: pool} }

// Create inserts a new task row.
func (r *TaskRepo) Create(ctx context.Context, t domain.Task) (domain.Task, error) {
	if !t.Status.IsValid() {
		t.Status = domain.TaskStatusToDo
	}
	if !t.Kind.IsValid() {
		return domain.Task{}, fmt.Errorf("hone.TaskRepo.Create: invalid kind %q", t.Kind)
	}
	if t.Source == "" {
		t.Source = domain.TaskSourceUser
	}
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	now := time.Now().UTC()
	if t.CreatedAt.IsZero() {
		t.CreatedAt = now
	}
	t.UpdatedAt = now
	var skillKey *string
	if t.SkillKey != "" {
		s := t.SkillKey
		skillKey = &s
	}
	if t.RecommendedReading == nil {
		t.RecommendedReading = []string{}
	}
	row := r.pool.QueryRow(ctx, `
        INSERT INTO hone_tasks (
            id, user_id, status, kind, source, title, brief_md,
            skill_key, deep_link, recommended_reading, priority, due_at,
            created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
        RETURNING id, created_at, updated_at`,
		sharedpg.UUID(t.ID), sharedpg.UUID(t.UserID),
		string(t.Status), string(t.Kind), string(t.Source),
		t.Title, t.BriefMD,
		skillKey, t.DeepLink, t.RecommendedReading, t.Priority,
		dueAtParam(t.DueAt),
		t.CreatedAt,
	)
	var id pgtype.UUID
	if err := row.Scan(&id, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return domain.Task{}, fmt.Errorf("hone.TaskRepo.Create: %w", err)
	}
	t.ID = sharedpg.UUIDFrom(id)
	return t, nil
}

// Get returns a task by id+owner. ErrNotFound when missing.
func (r *TaskRepo) Get(ctx context.Context, userID, taskID uuid.UUID) (domain.Task, error) {
	row := r.pool.QueryRow(ctx, taskSelect+`
         WHERE id = $1 AND user_id = $2`,
		sharedpg.UUID(taskID), sharedpg.UUID(userID))
	t, err := scanTask(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Task{}, domain.ErrNotFound
		}
		return domain.Task{}, fmt.Errorf("hone.TaskRepo.Get: %w", err)
	}
	return t, nil
}

// ListByUser returns a user's tasks filtered by status set. Empty `statuses`
// means "every active column" (todo + in_progress + in_review + done).
func (r *TaskRepo) ListByUser(ctx context.Context, userID uuid.UUID, statuses []domain.TaskStatus, limit int) ([]domain.Task, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	if len(statuses) == 0 {
		statuses = []domain.TaskStatus{
			domain.TaskStatusToDo, domain.TaskStatusInProgress,
			domain.TaskStatusInReview, domain.TaskStatusDone,
		}
	}
	statusStrs := make([]string, len(statuses))
	for i, s := range statuses {
		statusStrs[i] = string(s)
	}
	rows, err := r.pool.Query(ctx, taskSelect+`
         WHERE user_id = $1 AND status = ANY($2::text[])
         ORDER BY status ASC, created_at DESC
         LIMIT $3`,
		sharedpg.UUID(userID), statusStrs, limit)
	if err != nil {
		return nil, fmt.Errorf("hone.TaskRepo.ListByUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Task, 0, 16)
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, fmt.Errorf("hone.TaskRepo.ListByUser: scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.TaskRepo.ListByUser: rows: %w", err)
	}
	return out, nil
}

// CountInTodo — used by the cap=7 gate.
func (r *TaskRepo) CountInTodo(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM hone_tasks WHERE user_id = $1 AND status = 'todo'`,
		sharedpg.UUID(userID)).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("hone.TaskRepo.CountInTodo: %w", err)
	}
	return n, nil
}

// FindOpenBySkill — dedup gate for AI generation.
func (r *TaskRepo) FindOpenBySkill(ctx context.Context, userID uuid.UUID, skillKey string) (domain.Task, error) {
	if skillKey == "" {
		return domain.Task{}, domain.ErrNotFound
	}
	row := r.pool.QueryRow(ctx, taskSelect+`
         WHERE user_id = $1 AND skill_key = $2
           AND status IN ('todo','in_progress','in_review')
         ORDER BY created_at DESC
         LIMIT 1`,
		sharedpg.UUID(userID), skillKey)
	t, err := scanTask(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Task{}, domain.ErrNotFound
		}
		return domain.Task{}, fmt.Errorf("hone.TaskRepo.FindOpenBySkill: %w", err)
	}
	return t, nil
}

// SetStatus mutates one task's column and stamps completed_at /
// dismissed_at as the column dictates.
func (r *TaskRepo) SetStatus(ctx context.Context, userID, taskID uuid.UUID, status domain.TaskStatus) (domain.Task, error) {
	if !status.IsValid() {
		return domain.Task{}, fmt.Errorf("hone.TaskRepo.SetStatus: invalid status %q", status)
	}
	row := r.pool.QueryRow(ctx, `
        UPDATE hone_tasks
           SET status       = $3,
               updated_at   = now(),
               completed_at = CASE WHEN $3 = 'done'      THEN now() ELSE NULL END,
               dismissed_at = CASE WHEN $3 = 'dismissed' THEN now() ELSE dismissed_at END
         WHERE id = $1 AND user_id = $2
        RETURNING `+taskColumns,
		sharedpg.UUID(taskID), sharedpg.UUID(userID), string(status))
	t, err := scanTask(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Task{}, domain.ErrNotFound
		}
		return domain.Task{}, fmt.Errorf("hone.TaskRepo.SetStatus: %w", err)
	}
	return t, nil
}

// AutoDismissOlderThan — TTL sweep. Marks `todo` rows whose created_at is
// older than cutoff as `dismissed`, freeing slots for fresh AI suggestions.
func (r *TaskRepo) AutoDismissOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	cmd, err := r.pool.Exec(ctx, `
        UPDATE hone_tasks
           SET status = 'dismissed', dismissed_at = now(), updated_at = now()
         WHERE status = 'todo' AND created_at < $1`,
		pgtype.Timestamptz{Time: cutoff, Valid: true})
	if err != nil {
		return 0, fmt.Errorf("hone.TaskRepo.AutoDismissOlderThan: %w", err)
	}
	return cmd.RowsAffected(), nil
}

// Delete removes a task by id+owner.
func (r *TaskRepo) Delete(ctx context.Context, userID, taskID uuid.UUID) error {
	cmd, err := r.pool.Exec(ctx,
		`DELETE FROM hone_tasks WHERE id = $1 AND user_id = $2`,
		sharedpg.UUID(taskID), sharedpg.UUID(userID))
	if err != nil {
		return fmt.Errorf("hone.TaskRepo.Delete: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// ── Comments ─────────────────────────────────────────────────────────────

// AddComment inserts a comment under a task.
func (r *TaskRepo) AddComment(ctx context.Context, c domain.TaskComment) (domain.TaskComment, error) {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	if c.AuthorKind == "" {
		c.AuthorKind = domain.TaskCommentAuthorAI
	}
	row := r.pool.QueryRow(ctx, `
        INSERT INTO hone_task_comments (id, task_id, author_kind, body_md)
        VALUES ($1, $2, $3, $4)
        RETURNING created_at`,
		sharedpg.UUID(c.ID), sharedpg.UUID(c.TaskID), string(c.AuthorKind), c.BodyMD)
	if err := row.Scan(&c.CreatedAt); err != nil {
		return domain.TaskComment{}, fmt.Errorf("hone.TaskRepo.AddComment: %w", err)
	}
	return c, nil
}

// ListComments returns the thread for a task, oldest first.
func (r *TaskRepo) ListComments(ctx context.Context, taskID uuid.UUID) ([]domain.TaskComment, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, task_id, author_kind, body_md, created_at
           FROM hone_task_comments
          WHERE task_id = $1
          ORDER BY created_at ASC`,
		sharedpg.UUID(taskID))
	if err != nil {
		return nil, fmt.Errorf("hone.TaskRepo.ListComments: %w", err)
	}
	defer rows.Close()
	out := make([]domain.TaskComment, 0, 4)
	for rows.Next() {
		var (
			id, tid pgtype.UUID
			author  string
			body    string
			created time.Time
		)
		if err := rows.Scan(&id, &tid, &author, &body, &created); err != nil {
			return nil, fmt.Errorf("hone.TaskRepo.ListComments: scan: %w", err)
		}
		out = append(out, domain.TaskComment{
			ID: sharedpg.UUIDFrom(id), TaskID: sharedpg.UUIDFrom(tid),
			AuthorKind: domain.TaskCommentAuthor(author),
			BodyMD:     body, CreatedAt: created,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.TaskRepo.ListComments: %w", err)
	}
	return out, nil
}

// ── Phase J / H3 (2026-05-12) — kind override + bulk auto-categorise ──

// SetKind changes the task's kind. When manualOverride=true, flips
// manual_kind_override = true so background re-categorisers skip the
// row. When false (used internally by auto-categoriser path), preserves
// the existing flag value.
func (r *TaskRepo) SetKind(ctx context.Context, userID, taskID uuid.UUID, kind domain.TaskKind, manualOverride bool) (domain.Task, error) {
	if !kind.IsValid() {
		return domain.Task{}, fmt.Errorf("hone.TaskRepo.SetKind: invalid kind %q", kind)
	}
	// Two paths: when manualOverride=true we set the flag; otherwise
	// we leave the flag column untouched (COALESCE keeps existing).
	var row pgx.Row
	if manualOverride {
		row = r.pool.QueryRow(ctx, `
            UPDATE hone_tasks
               SET kind = $3, manual_kind_override = true, updated_at = now()
             WHERE id = $1 AND user_id = $2
            RETURNING `+taskColumns,
			sharedpg.UUID(taskID), sharedpg.UUID(userID), string(kind))
	} else {
		row = r.pool.QueryRow(ctx, `
            UPDATE hone_tasks
               SET kind = $3, updated_at = now()
             WHERE id = $1 AND user_id = $2
               -- Guard: do NOT silently overwrite a manual override even
               -- if caller passed manualOverride=false. Caller must
               -- decide upstream whether to skip (BulkAutoCategorise UC
               -- pre-filters); this guard is a safety net.
               AND manual_kind_override = false
            RETURNING `+taskColumns,
			sharedpg.UUID(taskID), sharedpg.UUID(userID), string(kind))
	}
	t, err := scanTask(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Task{}, domain.ErrNotFound
		}
		return domain.Task{}, fmt.Errorf("hone.TaskRepo.SetKind: %w", err)
	}
	return t, nil
}

// ListAutoCategorisable returns up to `limit` open tasks (todo/in_progress/
// in_review) where manual_kind_override = false. Ordered oldest-first so
// backlog cleanup processes the longest-pending items first.
func (r *TaskRepo) ListAutoCategorisable(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Task, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, taskSelect+`
         WHERE user_id = $1
           AND status IN ('todo','in_progress','in_review')
           AND manual_kind_override = false
         ORDER BY created_at ASC
         LIMIT $2`,
		sharedpg.UUID(userID), limit)
	if err != nil {
		return nil, fmt.Errorf("hone.TaskRepo.ListAutoCategorisable: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Task, 0, 16)
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, fmt.Errorf("hone.TaskRepo.ListAutoCategorisable: scan: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.TaskRepo.ListAutoCategorisable: rows: %w", err)
	}
	return out, nil
}

// ── helpers ──────────────────────────────────────────────────────────────

const taskColumns = `id, user_id, status, kind, source, title, brief_md,
        skill_key, deep_link, recommended_reading, priority, due_at,
        created_at, updated_at, completed_at, dismissed_at, manual_kind_override`

const taskSelect = `SELECT ` + taskColumns + ` FROM hone_tasks`

// scanTask reads a row in the canonical taskColumns order.
func scanTask(s pgx.Row) (domain.Task, error) {
	var (
		id, uid              pgtype.UUID
		status, kind, source string
		title, briefMD       string
		skillKey             pgtype.Text
		deepLink             string
		recommendedReading   []string
		priority             int16
		dueAt                pgtype.Timestamptz
		createdAt, updatedAt time.Time
		completedAt, dismAt  pgtype.Timestamptz
		manualOverride       bool
	)
	if err := s.Scan(
		&id, &uid, &status, &kind, &source, &title, &briefMD,
		&skillKey, &deepLink, &recommendedReading, &priority, &dueAt,
		&createdAt, &updatedAt, &completedAt, &dismAt, &manualOverride,
	); err != nil {
		return domain.Task{}, fmt.Errorf("hone.scanTask: %w", err)
	}
	t := domain.Task{
		ID: sharedpg.UUIDFrom(id), UserID: sharedpg.UUIDFrom(uid),
		Status: domain.TaskStatus(status), Kind: domain.TaskKind(kind),
		Source: domain.TaskSource(source),
		Title:  title, BriefMD: briefMD,
		DeepLink: deepLink, RecommendedReading: recommendedReading,
		Priority:  priority,
		CreatedAt: createdAt, UpdatedAt: updatedAt,
		ManualKindOverride: manualOverride,
	}
	if skillKey.Valid {
		t.SkillKey = skillKey.String
	}
	if dueAt.Valid {
		ts := dueAt.Time
		t.DueAt = &ts
	}
	if completedAt.Valid {
		ts := completedAt.Time
		t.CompletedAt = &ts
	}
	if dismAt.Valid {
		ts := dismAt.Time
		t.DismissedAt = &ts
	}
	return t, nil
}

func dueAtParam(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// Compile-time guard.
var _ domain.TaskRepo = (*TaskRepo)(nil)
