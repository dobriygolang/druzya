package domain

import (
	"context"

	"github.com/google/uuid"
)

// Repo абстрагирует persist-слой learning_state.
//
// Все методы идемпотентны: повторный SetMode с тем же payload'ом —
// no-op (UpdatedAt всё равно bump'нется). Get при отсутствии строки
// возвращает ErrNotFound; lazy-create — на app-уровне.
type Repo interface {
	// Get возвращает текущий State юзера или ErrNotFound.
	Get(ctx context.Context, userID uuid.UUID) (State, error)

	// Upsert вставляет или обновляет строку целиком. Repo сам выставляет
	// UpdatedAt = now(). Caller должен передать validated state (см
	// ValidateState).
	Upsert(ctx context.Context, s State) error
}
