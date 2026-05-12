// edit_memory_entry.go — F1 Memory expansion (2026-05-12): user-editable entries.
//
// Юзер может уточнить formulation entry'и в /profile transparency панели.
// Не пересчитываем embedding — это done на следующем embed_worker tick'е
// после edit'а (UPDATE сбрасывает embedded_at, см. infra-side).
package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// EditMemoryEntry UC — обновляет summary одной entry, ставит edited_at.
type EditMemoryEntry struct {
	Reader domain.MemoryEntryReader
}

// EditMemoryEntryInput — payload.
type EditMemoryEntryInput struct {
	UserID    uuid.UUID
	EpisodeID uuid.UUID
	// Content — новое значение summary. После TrimSpace должен быть [1..2000] chars.
	Content string
}

// Do валидирует content и делегирует Reader.Edit.
//
// Validation:
//   - UserID / EpisodeID != uuid.Nil
//   - len(strings.TrimSpace(Content)) в [1, 2000] characters (rune-aware
//     для UTF-8 — кириллица занимает 2 byte/rune но мы считаем по rune).
//
// Repo сам гарантирует scope (user_id, id, deleted_at IS NULL) — если row
// не принадлежит юзеру или soft-deleted, вернёт ErrNotFound.
func (uc *EditMemoryEntry) Do(ctx context.Context, in EditMemoryEntryInput) (domain.Episode, error) {
	if in.UserID == uuid.Nil {
		return domain.Episode{}, fmt.Errorf("intelligence.EditMemoryEntry: %w: zero user_id", domain.ErrInvalidInput)
	}
	if in.EpisodeID == uuid.Nil {
		return domain.Episode{}, fmt.Errorf("intelligence.EditMemoryEntry: %w: zero episode_id", domain.ErrInvalidInput)
	}
	trimmed := strings.TrimSpace(in.Content)
	if trimmed == "" {
		return domain.Episode{}, fmt.Errorf("intelligence.EditMemoryEntry: %w: empty content", domain.ErrInvalidInput)
	}
	if n := len([]rune(trimmed)); n > 2000 {
		return domain.Episode{}, fmt.Errorf("intelligence.EditMemoryEntry: %w: content too long (%d > 2000)", domain.ErrInvalidInput, n)
	}
	ep, err := uc.Reader.Edit(ctx, in.UserID, in.EpisodeID, trimmed)
	if err != nil {
		return domain.Episode{}, fmt.Errorf("intelligence.EditMemoryEntry: %w", err)
	}
	return ep, nil
}
