// energy_repo.go — Postgres impl of domain.EnergyRepo.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EnergyRepo — hand-rolled pgx adapter on energy_logs.
type EnergyRepo struct {
	pool *pgxpool.Pool
}

// NewEnergyRepo wires an EnergyRepo.
func NewEnergyRepo(pool *pgxpool.Pool) *EnergyRepo { return &EnergyRepo{pool: pool} }

// Create вставляет одну точку. ID + LoggedAt заполняются если zero.
func (r *EnergyRepo) Create(ctx context.Context, l domain.EnergyLog) (domain.EnergyLog, error) {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	if l.LoggedAt.IsZero() {
		l.LoggedAt = time.Now().UTC()
	}
	var note *string
	if l.Note != "" {
		s := l.Note
		note = &s
	}
	row := r.pool.QueryRow(ctx, `
        INSERT INTO energy_logs (id, user_id, logged_at, level, note)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, logged_at`,
		sharedpg.UUID(l.ID), sharedpg.UUID(l.UserID), l.LoggedAt, int16(l.Level), note,
	)
	var (
		id     pgtype.UUID
		logged pgtype.Timestamptz
	)
	if err := row.Scan(&id, &logged); err != nil {
		return domain.EnergyLog{}, fmt.Errorf("hone.EnergyRepo.Create: %w", err)
	}
	l.ID = sharedpg.UUIDFrom(id)
	if logged.Valid {
		l.LoggedAt = logged.Time
	}
	return l, nil
}

// ListRecent возвращает точки юзера за последние `days` дней.
func (r *EnergyRepo) ListRecent(ctx context.Context, userID uuid.UUID, days int) ([]domain.EnergyLog, error) {
	if days <= 0 {
		days = 7
	}
	if days > 90 {
		days = 90
	}
	cutoff := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour)
	rows, err := r.pool.Query(ctx, `
        SELECT id, user_id, logged_at, level, note
          FROM energy_logs
         WHERE user_id = $1 AND logged_at >= $2
         ORDER BY logged_at DESC
         LIMIT 1000`,
		sharedpg.UUID(userID), cutoff,
	)
	if err != nil {
		return nil, fmt.Errorf("hone.EnergyRepo.ListRecent: %w", err)
	}
	defer rows.Close()
	out := make([]domain.EnergyLog, 0, 32)
	for rows.Next() {
		var (
			id, uid pgtype.UUID
			logged  pgtype.Timestamptz
			level   int16
			note    pgtype.Text
		)
		if err := rows.Scan(&id, &uid, &logged, &level, &note); err != nil {
			return nil, fmt.Errorf("hone.EnergyRepo.ListRecent: scan: %w", err)
		}
		l := domain.EnergyLog{
			ID:     sharedpg.UUIDFrom(id),
			UserID: sharedpg.UUIDFrom(uid),
			Level:  int(level),
		}
		if logged.Valid {
			l.LoggedAt = logged.Time
		}
		if note.Valid {
			l.Note = note.String
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.EnergyRepo.ListRecent: rows: %w", err)
	}
	return out, nil
}

// Compile-time guard.
var _ domain.EnergyRepo = (*EnergyRepo)(nil)
