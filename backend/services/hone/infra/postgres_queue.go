// Queue repository — split out of postgres.go.
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

// Queue implements domain.QueueRepo.
type Queue struct {
	pool *pgxpool.Pool
}

func NewQueue(pool *pgxpool.Pool) *Queue { return &Queue{pool: pool} }

const queueColumns = "id, user_id, title, source, status, date, COALESCE(skill_key, ''), created_at, updated_at"

func (q *Queue) scanRow(row pgx.Row) (domain.QueueItem, error) {
	var (
		id        pgtype.UUID
		userID    pgtype.UUID
		title     string
		source    string
		status    string
		date      pgtype.Date
		skillKey  string
		createdAt time.Time
		updatedAt time.Time
	)
	if err := row.Scan(&id, &userID, &title, &source, &status, &date, &skillKey, &createdAt, &updatedAt); err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.queue.scan: %w", err)
	}
	return domain.QueueItem{
		ID:        sharedpg.UUIDFrom(id).String(),
		UserID:    sharedpg.UUIDFrom(userID).String(),
		Title:     title,
		Source:    domain.QueueItemSource(source),
		Status:    domain.QueueItemStatus(status),
		Date:      date.Time,
		SkillKey:  skillKey,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

// ListByDate — sorted: in_progress (top) → todo (by created_at) → done.
func (q *Queue) ListByDate(ctx context.Context, userID uuid.UUID, date time.Time) ([]domain.QueueItem, error) {
	rows, err := q.pool.Query(ctx,
		`SELECT `+queueColumns+`
		   FROM hone_queue_items
		  WHERE user_id=$1 AND date=$2
		  ORDER BY CASE status
		             WHEN 'in_progress' THEN 0
		             WHEN 'todo'        THEN 1
		             ELSE 2
		           END, created_at ASC`,
		sharedpg.UUID(userID), pgtype.Date{Time: date, Valid: true},
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Queue.ListByDate: %w", err)
	}
	defer rows.Close()
	out := make([]domain.QueueItem, 0)
	for rows.Next() {
		item, err := q.scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("hone.Queue.ListByDate: scan: %w", err)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Queue.ListByDate: rows: %w", err)
	}
	return out, nil
}

func (q *Queue) Create(ctx context.Context, item domain.QueueItem) (domain.QueueItem, error) {
	uid, err := uuid.Parse(item.UserID)
	if err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.Create: parse user_id: %w", err)
	}
	var skillKey *string
	if item.SkillKey != "" {
		s := item.SkillKey
		skillKey = &s
	}
	row := q.pool.QueryRow(ctx,
		`INSERT INTO hone_queue_items (user_id, title, source, status, date, skill_key)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING `+queueColumns,
		sharedpg.UUID(uid),
		item.Title,
		string(item.Source),
		string(item.Status),
		pgtype.Date{Time: item.Date, Valid: true},
		skillKey,
	)
	out, err := q.scanRow(row)
	if err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.Create: %w", err)
	}
	return out, nil
}

// UpdateStatus — атомарно реализует «один in_progress на user». Single TX:
// если new=in_progress → reset all peers первыми, потом update target.
// Status переходов не валидируем (можно todo→done напрямую) — UI controls
// решает что показывать; сервер только enforce'ит constraint.
func (q *Queue) UpdateStatus(ctx context.Context, id, userID uuid.UUID, status domain.QueueItemStatus) (domain.QueueItem, error) {
	tx, err := q.pool.Begin(ctx)
	if err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.UpdateStatus: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if status == domain.QueueItemStatusInProgress {
		// Сбрасываем все остальные in_progress этого user'а на сегодня.
		// CURRENT_DATE — потому что бизнес-правило применяется только к
		// today-pull'ам (исторические данные не трогаем).
		if _, eerr := tx.Exec(ctx,
			`UPDATE hone_queue_items
			    SET status='todo', updated_at=NOW()
			  WHERE user_id=$1 AND date=CURRENT_DATE
			    AND status='in_progress' AND id != $2`,
			sharedpg.UUID(userID), sharedpg.UUID(id),
		); eerr != nil {
			return domain.QueueItem{}, fmt.Errorf("hone.Queue.UpdateStatus: reset peers: %w", eerr)
		}
	}

	row := tx.QueryRow(ctx,
		`UPDATE hone_queue_items
		    SET status=$3, updated_at=NOW()
		  WHERE id=$1 AND user_id=$2
		  RETURNING `+queueColumns,
		sharedpg.UUID(id), sharedpg.UUID(userID), string(status),
	)
	out, err := q.scanRow(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.QueueItem{}, domain.ErrNotFound
		}
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.UpdateStatus: update: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return domain.QueueItem{}, fmt.Errorf("hone.Queue.UpdateStatus: commit: %w", err)
	}
	return out, nil
}

func (q *Queue) Delete(ctx context.Context, id, userID uuid.UUID) error {
	tag, err := q.pool.Exec(ctx,
		`DELETE FROM hone_queue_items WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(id), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.Queue.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (q *Queue) ExistsByTitleToday(ctx context.Context, userID uuid.UUID, title string) (bool, error) {
	// W13: was COUNT(*) on hone_queue_items — Postgres scans every matching
	// row even though we only need a boolean. EXISTS short-circuits on the
	// first hit and lets the planner pick an index-only walk.
	var exists bool
	err := q.pool.QueryRow(ctx,
		`SELECT EXISTS (
		    SELECT 1 FROM hone_queue_items
		     WHERE user_id=$1 AND date=CURRENT_DATE AND title=$2
		 )`,
		sharedpg.UUID(userID), title,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("hone.Queue.ExistsByTitleToday: %w", err)
	}
	return exists, nil
}

func (q *Queue) CountTodayByStatus(ctx context.Context, userID uuid.UUID) (total, done int, err error) {
	err = q.pool.QueryRow(ctx,
		`SELECT COUNT(*) FILTER (WHERE TRUE),
		        COUNT(*) FILTER (WHERE status='done')
		   FROM hone_queue_items
		  WHERE user_id=$1 AND date=CURRENT_DATE`,
		sharedpg.UUID(userID),
	).Scan(&total, &done)
	if err != nil {
		return 0, 0, fmt.Errorf("hone.Queue.CountTodayByStatus: %w", err)
	}
	return total, done, nil
}

func (q *Queue) GetAIShareLast7Days(ctx context.Context, userID uuid.UUID) (aiShare, userShare float32, err error) {
	rows, err := q.pool.Query(ctx,
		`SELECT source, COUNT(*)::int
		   FROM hone_queue_items
		  WHERE user_id=$1 AND status='done'
		    AND date >= CURRENT_DATE - INTERVAL '7 days'
		  GROUP BY source`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return 0, 0, fmt.Errorf("hone.Queue.GetAIShareLast7Days: %w", err)
	}
	defer rows.Close()
	var ai, user int
	for rows.Next() {
		var src string
		var cnt int
		if err := rows.Scan(&src, &cnt); err != nil {
			return 0, 0, fmt.Errorf("hone.Queue.GetAIShareLast7Days: scan: %w", err)
		}
		switch src {
		case "ai":
			ai = cnt
		case "user":
			user = cnt
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, fmt.Errorf("hone.Queue.GetAIShareLast7Days: rows: %w", err)
	}
	total := ai + user
	if total == 0 {
		return 0, 0, nil
	}
	return float32(ai) / float32(total), float32(user) / float32(total), nil
}
