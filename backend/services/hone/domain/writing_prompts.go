// Package domain — curated writing-prompt library.
//
// Separate from writing.go: that file owns the stateless grader; this one
// owns persistence for the prompts catalog.
//
// Architecture:
//   - WritingPrompt — slug-keyed admin-authored row (id is the slug).
//   - Level filter — single CEFR bucket, empty = all.
//   - Soft-delete via Archive (archived_at TIMESTAMPTZ). List returns
//     only active rows; archive is one-way (admin re-creates with new
//     slug if they want to undo).
package domain

import (
	"context"
	"time"
)

// WritingPromptLevel — CEFR bucket. Mirrors the CHECK constraint in
// migration 00119 (B1 / B2 / C1). Same enum shape as SpeakingLevel
// intentionally — they target the same English skill axis and admin
// UIs share level pickers.
type WritingPromptLevel string

const (
	WritingPromptLevelB1 WritingPromptLevel = "B1"
	WritingPromptLevelB2 WritingPromptLevel = "B2"
	WritingPromptLevelC1 WritingPromptLevel = "C1"
)

// IsValid keeps downstream switches exhaustive.
func (l WritingPromptLevel) IsValid() bool {
	switch l {
	case WritingPromptLevelB1, WritingPromptLevelB2, WritingPromptLevelC1:
		return true
	}
	return false
}

// WritingPrompt — one catalog row. id is the admin-authored slug.
type WritingPrompt struct {
	ID        string
	Level     WritingPromptLevel
	Topic     string
	Prompt    string
	RubricMD  string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// WritingPromptRepo — persistence interface. Read path (List) is
// user-facing; write paths (Add / Archive) are admin-only, gated at
// the REST router level.
type WritingPromptRepo interface {
	// List returns active (non-archived) prompts. Empty level = all
	// active rows. Order: level ASC, id ASC for deterministic UI paging.
	List(ctx context.Context, level WritingPromptLevel) ([]WritingPrompt, error)
	// Add inserts a new prompt. Errors if id already exists (admin
	// fixes by archiving the old + creating with a new slug).
	Add(ctx context.Context, p WritingPrompt) (WritingPrompt, error)
	// Archive flips archived_at to NOW(). ErrNotFound if id absent or
	// already archived. One-way — admin re-creates with new slug to undo.
	Archive(ctx context.Context, id string) error
}
