// Phase B-2: thin hook into the Coach memory layer.
//
// hone-domain не импортит intelligence — это разрушит bounded context.
// Вместо этого определяем здесь узкий interface MemoryHook, который
// monolith wiring имплементирует через intelligence/app.Memory.
//
// nil-safe: hone use cases должны checkнуть `if h.Memory != nil` перед
// вызовом. Это позволяет hone тестироваться изолированно без intelligence.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// MemoryHook — fire-and-forget side-effect channel в Coach memory.
// Все методы должны быть быстрыми (caller'ы в hot-path юзера); реализация
// в monolith adapter использует AppendAsync — горутину под background ctx.
type MemoryHook interface {
	OnReflectionAdded(ctx context.Context, userID uuid.UUID, reflection, planItemID string, seconds int, occurredAt time.Time)
	OnStandupRecorded(ctx context.Context, userID uuid.UUID, yesterday, today, blockers string, occurredAt time.Time)
	OnPlanSkipped(ctx context.Context, userID uuid.UUID, title, skillKey string, occurredAt time.Time)
	OnPlanCompleted(ctx context.Context, userID uuid.UUID, title, skillKey string, occurredAt time.Time)
	OnNoteCreated(ctx context.Context, userID, noteID uuid.UUID, title, body200 string, occurredAt time.Time)
	OnFocusSessionDone(ctx context.Context, userID uuid.UUID, pinnedTitle string, secondsFocused int, planItemID string, completedPomodoros int, occurredAt time.Time)
}
