package app

import (
	"context"
	"fmt"

	"druz9/storage/domain"

	"github.com/google/uuid"
)

// RestoreNote — обратная операция к ArchiveNote (archived_at=NULL).
type RestoreNote struct {
	Repo domain.StorageRepo
}

// Run сбрасывает archived_at. Возвращает domain.ErrNotFound, если ноты
// нет / она чужая.
func (uc *RestoreNote) Run(ctx context.Context, userID, noteID uuid.UUID) error {
	if err := uc.Repo.SetNoteArchived(ctx, userID, noteID, false); err != nil {
		return fmt.Errorf("storage.RestoreNote: %w", err)
	}
	return nil
}
