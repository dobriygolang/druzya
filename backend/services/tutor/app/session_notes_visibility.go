// Package app — share per-event session note WITH the student.
//
// Tutor can opt in to share the note, optionally crafting a curated copy via
// shared_content_md instead of exposing the raw private write-up.
//
// Privacy rule: default is PRIVATE. SetSessionNoteVisibility is the
// explicit opt-in. The migration (00115) defaults the column to
// 'private' so existing completed events stay private retroactively.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// SharedContentMDMax bounds the curated student-facing copy. Same scale
// as SessionNote (8KB) — generous; past this the tutor should be sharing
// a link to a Hone Note instead of pasting longform.
const SharedContentMDMax = 8_000

// SetSessionNoteVisibility — tutor toggles share + optionally edits the
// student-facing copy. Use case enforces:
//   - tutorID / eventID non-zero
//   - visibility ∈ {private, shared}
//   - shared_content_md within length cap (empty is valid → use full note)
// Repo enforces ownership + completed-status gates.
type SetSessionNoteVisibility struct {
	Repo domain.EventRepo
	Now  func() time.Time
}

// SetSessionNoteVisibilityInput — surface for the handler. SharedContentMD
// is optional: empty + visibility=shared means «share raw private note».
type SetSessionNoteVisibilityInput struct {
	TutorID         uuid.UUID
	EventID         uuid.UUID
	Visibility      domain.EventVisibility
	SharedContentMD string
}

func (uc *SetSessionNoteVisibility) Do(
	ctx context.Context, in SetSessionNoteVisibilityInput,
) (domain.Event, error) {
	if uc == nil || uc.Repo == nil {
		return domain.Event{}, fmt.Errorf("tutor.SetSessionNoteVisibility: not wired")
	}
	if in.TutorID == uuid.Nil || in.EventID == uuid.Nil {
		return domain.Event{}, fmt.Errorf("tutor.SetSessionNoteVisibility: %w", domain.ErrInvalidInput)
	}
	if !in.Visibility.IsValid() {
		return domain.Event{}, fmt.Errorf("tutor.SetSessionNoteVisibility: bad visibility: %w", domain.ErrInvalidInput)
	}
	// Trim trailing whitespace but preserve markdown leading indents.
	curated := strings.TrimRight(in.SharedContentMD, " \t\r\n")
	if len(curated) > SharedContentMDMax {
		return domain.Event{}, fmt.Errorf("tutor.SetSessionNoteVisibility: shared_content_md too long (max %d): %w", SharedContentMDMax, domain.ErrInvalidInput)
	}
	out, err := uc.Repo.SetSessionNoteVisibility(
		ctx, in.TutorID, in.EventID, in.Visibility, curated, nowOr(uc.Now),
	)
	if err != nil {
		return domain.Event{}, fmt.Errorf("tutor.SetSessionNoteVisibility: %w", err)
	}
	return out, nil
}

// ListSharedSessionNotesForStudent — student-side feed of notes the
// tutor opted to share. Read-only; auth is implicit through the
// student_id filter at the SQL gate (caller passes their own user id
// from the bearer).
type ListSharedSessionNotesForStudent struct {
	Repo domain.EventRepo
}

// ListSharedSessionNotesForStudentOutput — items + opaque next cursor.
type ListSharedSessionNotesForStudentOutput struct {
	Items      []domain.SharedSessionNote
	NextCursor string
}

func (uc *ListSharedSessionNotesForStudent) Do(
	ctx context.Context, studentID uuid.UUID, limit int, cursor string,
) (ListSharedSessionNotesForStudentOutput, error) {
	if uc == nil || uc.Repo == nil {
		return ListSharedSessionNotesForStudentOutput{}, fmt.Errorf("tutor.ListSharedSessionNotesForStudent: not wired")
	}
	if studentID == uuid.Nil {
		return ListSharedSessionNotesForStudentOutput{}, fmt.Errorf("tutor.ListSharedSessionNotesForStudent: %w", domain.ErrInvalidInput)
	}
	items, next, err := uc.Repo.ListSharedSessionNotesForStudent(ctx, studentID, limit, cursor)
	if err != nil {
		return ListSharedSessionNotesForStudentOutput{}, fmt.Errorf("tutor.ListSharedSessionNotesForStudent: %w", err)
	}
	return ListSharedSessionNotesForStudentOutput{Items: items, NextCursor: next}, nil
}
