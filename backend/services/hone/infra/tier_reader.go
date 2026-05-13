// Package infra — gating premium endpoints. Adapter читает `subscriptions`
// table напрямую без зависимости от subscription-сервиса.
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

// IsPro возвращает true, когда plan ∈ {pro,max} И endpoint-период не истёк.
// Отсутствие строки = free (не ошибка). Schema: subscriptions.plan ∈
// {free,pro,max} (см 00001_baseline subscriptions_plan_valid CHECK).
func (a *TierReader) IsPro(ctx context.Context, userID uuid.UUID) (bool, error) {
	const q = `
SELECT plan,
       status,
       GREATEST(COALESCE(current_period_end, to_timestamp(0)),
                COALESCE(grace_until,        to_timestamp(0))) AS valid_until
FROM subscriptions
WHERE user_id = $1`
	var plan, status string
	var validUntil pgtype.Timestamptz
	err := a.pool.QueryRow(ctx, q, sharedpg.UUID(userID)).Scan(&plan, &status, &validUntil)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("hone.TierReader.IsPro: %w", err)
	}
	if (plan != "pro" && plan != "max") || status != "active" {
		return false, nil
	}
	if validUntil.Valid && validUntil.Time.Before(timeNowUTC()) {
		return false, nil
	}
	return true, nil
}

// timeNowUTC — индирекция для стабильных тестов.
func timeNowUTC() time.Time { return time.Now().UTC() }
