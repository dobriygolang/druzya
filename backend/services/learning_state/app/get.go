// Package app — use cases для learning_state. Тонкие orchestrators
// поверх domain + repo.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/learning_state/domain"

	"github.com/google/uuid"
)

// Clock — взято внутрь, чтобы тесты подсовывали детерминированный now().
type Clock func() time.Time

// GetState возвращает State юзера. Если строки нет — лениво создаёт
// default ('explore', explore_started_at = now). Это устраняет
// per-user backfill в миграции и держит DB чистой для давно
// зарегистрировавшихся юзеров, которые ни разу не открывали /coach.
type GetState struct {
	Repo  domain.Repo
	Clock Clock
}

func (uc GetState) Execute(ctx context.Context, userID uuid.UUID) (domain.State, error) {
	s, err := uc.Repo.Get(ctx, userID)
	if err == nil {
		return s, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return domain.State{}, fmt.Errorf("learning_state.GetState: %w", err)
	}
	now := uc.now()
	def := domain.Default(userID, now)
	if upErr := uc.Repo.Upsert(ctx, def); upErr != nil {
		return domain.State{}, fmt.Errorf("learning_state.GetState lazy-create: %w", upErr)
	}
	return def, nil
}

func (uc GetState) now() time.Time {
	if uc.Clock != nil {
		return uc.Clock()
	}
	return time.Now()
}
