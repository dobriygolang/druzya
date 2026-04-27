// tier_reader.go — Phase: gate'инг premium-endpoint'ов. Adapter напрямую
// читает `subscriptions` table, без зависимости от subscription-сервиса.
// Перенесён дословно из cmd/monolith/services/adapters.go (honeTierAdapter).
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

// TierReader — Postgres impl of domain.TierReader.
type TierReader struct {
	pool *pgxpool.Pool
}

// NewTierReader wraps pool.
func NewTierReader(pool *pgxpool.Pool) domain.TierReader {
	return &TierReader{pool: pool}
}

// IsPro возвращает true, когда tier == 'pro' И endpoint-период не истёк.
// Отсутствие строки = free (не ошибка).
func (a *TierReader) IsPro(ctx context.Context, userID uuid.UUID) (bool, error) {
	const q = `
SELECT tier,
       status,
       GREATEST(COALESCE(current_period_end, to_timestamp(0)),
                COALESCE(grace_until,        to_timestamp(0))) AS valid_until
FROM subscriptions
WHERE user_id = $1`
	var tier, status string
	var validUntil pgtype.Timestamptz
	err := a.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&tier, &status, &validUntil)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("hone.TierReader.IsPro: %w", err)
	}
	if tier != "pro" || status != "active" {
		return false, nil
	}
	if validUntil.Valid && validUntil.Time.Before(timeNowUTC()) {
		return false, nil
	}
	return true, nil
}

// timeNowUTC — индирекция для стабильных тестов.
func timeNowUTC() time.Time { return time.Now().UTC() }
