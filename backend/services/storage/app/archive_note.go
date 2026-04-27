package app

import (
	"context"
	"fmt"

	"druz9/storage/domain"

	"github.com/google/uuid"
)

// ArchiveNote — single-id archive (POST /storage/archive/note/{id}).
type ArchiveNote struct {
	Repo domain.StorageRepo
}

// Run помечает заметку archived_at=now(). Возвращает domain.ErrNotFound,
// если ноты нет / она чужая.
func (uc *ArchiveNote) Run(ctx context.Context, userID, noteID uuid.UUID) error {
	if err := uc.Repo.SetNoteArchived(ctx, userID, noteID, true); err != nil {
		return fmt.Errorf("storage.ArchiveNote: %w", err)
	}
	return nil
}
