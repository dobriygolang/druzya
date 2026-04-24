// Package app — use-cases subscription-сервиса. Каждый файл = один use-case.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// GetTier возвращает эффективный tier пользователя на текущий момент.
// Отсутствие записи трактуется как TierFree (не ошибка UX).
type GetTier struct {
	Repo  domain.Repo
	Clock domain.Clock
}

// NewGetTier — конструктор с nil-safe clock'ом.
func NewGetTier(repo domain.Repo, clk domain.Clock) *GetTier {
	if clk == nil {
		clk = domain.RealClock{}
	}
	return &GetTier{Repo: repo, Clock: clk}
}

// Do вычисляет текущий tier. Всегда возвращает доменно-валидный Tier; error
// пропагируется только при реальных infra-сбоях (Postgres down).
func (uc *GetTier) Do(ctx context.Context, userID uuid.UUID) (domain.Tier, error) {
	sub, err := uc.Repo.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.TierFree, nil
		}
		return domain.TierFree, fmt.Errorf("subscription.GetTier: %w", err)
	}
	return sub.ActiveAt(uc.now()), nil
}

// DoFull возвращает помимо tier'а ещё и раскрытую Subscription (для
// GetMyTier API, чтобы фронт мог показать expiry-дату и provider-бейдж).
// ErrNotFound → пустой Subscription с TierFree (чтобы caller не ветвился).
func (uc *GetTier) DoFull(ctx context.Context, userID uuid.UUID) (domain.Subscription, error) {
	sub, err := uc.Repo.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return domain.Subscription{UserID: userID, Tier: domain.TierFree, Status: domain.StatusActive}, nil
		}
		return domain.Subscription{}, fmt.Errorf("subscription.GetTier.DoFull: %w", err)
	}
	return sub, nil
}

func (uc *GetTier) now() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
