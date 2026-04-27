package app

import (
	"context"
	"fmt"

	"druz9/storage/domain"

	"github.com/google/uuid"
)

// ArchiveOldestNotes — bulk-helper для «Storage full» dialog'а: помечает
// archived_at = now() у N самых старых активных заметок юзера.
type ArchiveOldestNotes struct {
	Repo domain.StorageRepo
}

// ArchiveOldestNotesIn — clamp'ится здесь (10 default, 100 max), чтобы
// HTTP-handler'у не дублировать guard'ы.
type ArchiveOldestNotesIn struct {
	UserID uuid.UUID
	Count  int
}

// ArchiveOldestNotesOut — число фактически архивированных строк.
type ArchiveOldestNotesOut struct {
	Archived int64
}

// Run валидирует Count и делегирует в repo.
func (uc *ArchiveOldestNotes) Run(ctx context.Context, in ArchiveOldestNotesIn) (ArchiveOldestNotesOut, error) {
	count := in.Count
	if count <= 0 {
		count = 10
	}
	if count > 100 {
		count = 100
	}
	n, err := uc.Repo.ArchiveOldestNotes(ctx, in.UserID, count)
	if err != nil {
		return ArchiveOldestNotesOut{}, fmt.Errorf("storage.ArchiveOldestNotes: %w", err)
	}
	return ArchiveOldestNotesOut{Archived: n}, nil
}
