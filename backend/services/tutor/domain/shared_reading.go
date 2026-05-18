package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// SharedMaterial — одна запись «тутор поделился материалом со студентами».
// Не FK на assignments — материал концептуально отдельная сущность,
// persist даже если все сгенерированные assignments archived/deleted.
type SharedMaterial struct {
	ID           uuid.UUID
	TutorID      uuid.UUID
	Title        string
	SourceURL    string
	BodyMD       string
	StudentCount int
	CreatedAt    time.Time
}

// SharedMaterialRepo — pgx-backed history.
type SharedMaterialRepo interface {
	CreateSharedMaterial(ctx context.Context, m SharedMaterial) (SharedMaterial, error)
	// ListSharedMaterialsByTutorPaged — keyset cursor over
	// (created_at DESC, id DESC). cursor "" = first page.
	ListSharedMaterialsByTutorPaged(ctx context.Context, tutorID uuid.UUID, limit int, cursor string) ([]SharedMaterial, string, error)
}
