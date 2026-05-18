// Notes AI flag use case.
//
// Тонкий wrapper над NoteRepo.SetAIExcluded. Отдельный UC чтобы будущие
// побочные эффекты (telemetry / coach memory invalidate / cache invalidate)
// добавлялись в одном месте, а не в каждом callsite ports.
package app

import (
	"context"
	"fmt"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// UpdateNoteAIExcluded use case.
type UpdateNoteAIExcluded struct {
	Notes domain.NoteRepo
	// Cache — optional. AcceptTaskSuggestion path also зовёт Delete(cache)
	// чтобы suggestions пересобрались; здесь же логика «нота стала ai_excluded»
	// делает прежние suggestions нерелевантными — drop cache в любом случае.
	Cache SuggestionCache
}

// UpdateNoteAIExcludedInput — wire body.
type UpdateNoteAIExcludedInput struct {
	UserID     uuid.UUID
	NoteID     uuid.UUID
	AIExcluded bool
}

// Do executes the use case.
func (uc *UpdateNoteAIExcluded) Do(ctx context.Context, in UpdateNoteAIExcludedInput) (domain.Note, error) {
	if in.NoteID == uuid.Nil {
		return domain.Note{}, fmt.Errorf("hone.UpdateNoteAIExcluded: note_id empty: %w", domain.ErrInvalidInput)
	}
	note, err := uc.Notes.SetAIExcluded(ctx, in.UserID, in.NoteID, in.AIExcluded)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.UpdateNoteAIExcluded: %w", err)
	}
	if uc.Cache != nil {
		uc.Cache.Delete(ctx, in.UserID)
	}
	return note, nil
}
