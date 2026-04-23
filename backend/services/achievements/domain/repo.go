package domain

import (
	"context"

	"github.com/google/uuid"
)

// UserAchievementRepo инкапсулирует CRUD по user_achievements.
//
// Методы возвращают доменные сущности (никаких pgx/json), упрощают тесты.
type UserAchievementRepo interface {
	// Get загружает одну строку. (zero, ErrNotFound) если строки нет.
	Get(ctx context.Context, userID uuid.UUID, code string) (UserAchievement, error)
	// List возвращает все строки одного пользователя. Никогда не nil.
	List(ctx context.Context, userID uuid.UUID) ([]UserAchievement, error)
	// UpsertProgress апсёртит прогресс. Если progress >= target и unlocked_at
	// был NULL — стампит unlocked_at = now() в той же транзакции (атомарно).
	// Возвращает финальную строку с актуальным unlocked_at (если случился).
	// `unlocked` — true если эта операция впервые перевела ачивку в unlocked.
	UpsertProgress(ctx context.Context, userID uuid.UUID, code string, progress int, target int) (row UserAchievement, unlocked bool, err error)
	// Unlock форсирует unlock (для бинарных ачивок типа first-blood). Идемпотентен.
	// `unlocked` — true только если это была первая разблокировка.
	Unlock(ctx context.Context, userID uuid.UUID, code string, target int) (row UserAchievement, unlocked bool, err error)
}
