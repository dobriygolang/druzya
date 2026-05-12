// list_memory_entries.go — F1 Memory expansion Phase 2 (2026-05-12).
//
// /profile transparency панель показывает юзеру что AI «помнит» о нём.
// Это две RPC:
//
//   ListMemoryEntries — paginated read над coach_episodes (alive only).
//     Filter by kind, optional since-date. Default limit 50, hard cap 200.
//
//   DeleteMemoryEntry — soft-delete (deleted_at = now). Recall / DailyBrief /
//     Stats фильтруют по deleted_at IS NULL → AI «забывает» этот эпизод.
//     History сохраняется для audit + потенциального undo.
package app

import (
	"context"
	"fmt"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// ListMemoryEntries UC.
type ListMemoryEntries struct {
	Reader domain.MemoryEntryReader
}

// ListMemoryEntriesInput.
type ListMemoryEntriesInput struct {
	UserID uuid.UUID
	// Kind — optional filter; empty = all kinds. Validated в UC.
	Kind string
	// Since — optional lower bound on occurred_at. Zero time = unrestricted.
	Since  time.Time
	Limit  int
	Offset int
}

// ListMemoryEntriesResult.
type ListMemoryEntriesResult struct {
	Items []domain.Episode
	Total int
}

// Do reads paginated memory entries. Default limit 50, cap 200.
func (uc *ListMemoryEntries) Do(ctx context.Context, in ListMemoryEntriesInput) (ListMemoryEntriesResult, error) {
	if in.UserID == uuid.Nil {
		return ListMemoryEntriesResult{}, fmt.Errorf("intelligence.ListMemoryEntries: %w: zero user_id", domain.ErrInvalidInput)
	}
	kind := domain.EpisodeKind(in.Kind)
	if in.Kind != "" && !kind.IsValid() {
		return ListMemoryEntriesResult{}, fmt.Errorf("intelligence.ListMemoryEntries: %w: invalid kind %q", domain.ErrInvalidInput, in.Kind)
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset := in.Offset
	if offset < 0 {
		offset = 0
	}
	var sincePtr *time.Time
	if !in.Since.IsZero() {
		s := in.Since
		sincePtr = &s
	}
	page, err := uc.Reader.List(ctx, domain.MemoryEntryFilter{
		UserID: in.UserID,
		Kind:   kind,
		Since:  sincePtr,
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		return ListMemoryEntriesResult{}, fmt.Errorf("intelligence.ListMemoryEntries: %w", err)
	}
	return ListMemoryEntriesResult{Items: page.Items, Total: page.Total}, nil
}

// ── DeleteMemoryEntry ─────────────────────────────────────────────────────

// DeleteMemoryEntry UC — soft-delete (deleted_at stamp). Repo scoped to
// (user_id, episode_id) — отказ если row принадлежит другому юзеру.
type DeleteMemoryEntry struct {
	Reader domain.MemoryEntryReader
}

// Do soft-deletes one episode.
func (uc *DeleteMemoryEntry) Do(ctx context.Context, userID, episodeID uuid.UUID) error {
	if userID == uuid.Nil {
		return fmt.Errorf("intelligence.DeleteMemoryEntry: %w: zero user_id", domain.ErrInvalidInput)
	}
	if episodeID == uuid.Nil {
		return fmt.Errorf("intelligence.DeleteMemoryEntry: %w: zero episode_id", domain.ErrInvalidInput)
	}
	return uc.Reader.SoftDelete(ctx, userID, episodeID)
}
