// publish_note.go — use-case'ы Phase C-4 «Publish to web».
package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// publishMaxAttempts — retry-loop на UNIQUE-collision slug'а.
const publishMaxAttempts = 5

// PublishNote — owner toggles note to public (idempotent: повторный publish
// возвращает existing slug).
type PublishNote struct {
	Repo domain.PublishRepo
	Log  *slog.Logger
	// SlugGen — фабрика slug'ов (12 hex chars by default). nil → дефолт
	// crypto/rand.
	SlugGen func() (string, error)
}

// PublishNoteInput — wire body.
type PublishNoteInput struct {
	UserID uuid.UUID
	NoteID uuid.UUID
}

// PublishNoteOutput — wire response.
type PublishNoteOutput struct {
	Slug        string
	PublishedAt time.Time
	// AlreadyPublished=true если до вызова уже был slug — caller возвращает
	// existing без генерации.
	AlreadyPublished bool
}

// Do executes the use case.
func (uc *PublishNote) Do(ctx context.Context, in PublishNoteInput) (PublishNoteOutput, error) {
	lookup, err := uc.Repo.LookupForPublish(ctx, in.UserID, in.NoteID)
	if err != nil {
		return PublishNoteOutput{}, fmt.Errorf("hone.PublishNote.Do: %w", err)
	}
	if lookup.Encrypted {
		return PublishNoteOutput{}, domain.ErrEncryptedCannotPublish
	}
	if lookup.Slug != nil && lookup.PublishedAt != nil {
		return PublishNoteOutput{
			Slug:             *lookup.Slug,
			PublishedAt:      *lookup.PublishedAt,
			AlreadyPublished: true,
		}, nil
	}

	slugGen := uc.SlugGen
	if slugGen == nil {
		slugGen = generateSlug
	}

	for attempt := 0; attempt < publishMaxAttempts; attempt++ {
		candidate, gerr := slugGen()
		if gerr != nil {
			return PublishNoteOutput{}, fmt.Errorf("hone.PublishNote.Do: slug-gen: %w", gerr)
		}
		newSlug, newAt, err := uc.Repo.SetPublishSlug(ctx, in.UserID, in.NoteID, candidate)
		if err == nil {
			return PublishNoteOutput{Slug: newSlug, PublishedAt: newAt}, nil
		}
		if errors.Is(err, domain.ErrPublishSlugCollision) {
			continue
		}
		return PublishNoteOutput{}, fmt.Errorf("hone.PublishNote.Do: %w", err)
	}
	return PublishNoteOutput{}, fmt.Errorf("hone.PublishNote.Do: %d slug attempts failed", publishMaxAttempts)
}

// generateSlug — 12 hex chars (48 bits) crypto/rand.
func generateSlug() (string, error) {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("hone.generateSlug: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

// ─── UnpublishNote ────────────────────────────────────────────────────────

// UnpublishNote — owner toggles note back to private. ErrNotFound если
// note нет или не принадлежит юзеру.
type UnpublishNote struct {
	Repo domain.PublishRepo
	Log  *slog.Logger
}

// UnpublishNoteInput.
type UnpublishNoteInput struct {
	UserID uuid.UUID
	NoteID uuid.UUID
}

// Do executes the use case.
func (uc *UnpublishNote) Do(ctx context.Context, in UnpublishNoteInput) error {
	if err := uc.Repo.ClearPublish(ctx, in.UserID, in.NoteID); err != nil {
		return fmt.Errorf("hone.UnpublishNote.Do: %w", err)
	}
	return nil
}

// ─── PublishStatus ────────────────────────────────────────────────────────

// PublishStatus — owner reads current publish state.
type PublishStatus struct {
	Repo domain.PublishRepo
	Log  *slog.Logger
}

// PublishStatusInput.
type PublishStatusInput struct {
	UserID uuid.UUID
	NoteID uuid.UUID
}

// PublishStatusOutput.
type PublishStatusOutput struct {
	Published bool
	Slug      string
	At        *time.Time
}

// Do executes the use case.
func (uc *PublishStatus) Do(ctx context.Context, in PublishStatusInput) (PublishStatusOutput, error) {
	slug, at, err := uc.Repo.GetPublishStatus(ctx, in.UserID, in.NoteID)
	if err != nil {
		return PublishStatusOutput{}, fmt.Errorf("hone.PublishStatus.Do: %w", err)
	}
	out := PublishStatusOutput{}
	if slug != nil && at != nil {
		out.Published = true
		out.Slug = *slug
		out.At = at
	}
	return out, nil
}

// ─── BulkNotesMeta ────────────────────────────────────────────────────────

// BulkNotesMeta — bulk per-note flags для sidebar (encrypted/published).
type BulkNotesMeta struct {
	Repo domain.PublishRepo
	Log  *slog.Logger
}

// BulkNotesMetaInput.
type BulkNotesMetaInput struct {
	UserID uuid.UUID
}

// BulkNotesMetaOutput.
type BulkNotesMetaOutput struct {
	Notes []domain.NoteMeta
}

// Do executes the use case.
func (uc *BulkNotesMeta) Do(ctx context.Context, in BulkNotesMetaInput) (BulkNotesMetaOutput, error) {
	rows, err := uc.Repo.ListNotesMeta(ctx, in.UserID)
	if err != nil {
		return BulkNotesMetaOutput{}, fmt.Errorf("hone.BulkNotesMeta.Do: %w", err)
	}
	return BulkNotesMetaOutput{Notes: rows}, nil
}

// ─── PublicView ───────────────────────────────────────────────────────────

// PublicView — read body+title+updatedAt by slug (anonymous, no auth).
// ErrNotFound если slug не существует / note unpublished / archived.
type PublicView struct {
	Repo domain.PublishRepo
	Log  *slog.Logger
}

// PublicViewInput.
type PublicViewInput struct {
	Slug string
}

// PublicViewOutput — render-ready data.
type PublicViewOutput struct {
	Title     string
	BodyMD    string
	UpdatedAt time.Time
}

// Do executes the use case.
func (uc *PublicView) Do(ctx context.Context, in PublicViewInput) (PublicViewOutput, error) {
	title, body, at, err := uc.Repo.GetPublicView(ctx, in.Slug)
	if err != nil {
		return PublicViewOutput{}, fmt.Errorf("hone.PublicView.Do: %w", err)
	}
	return PublicViewOutput{Title: title, BodyMD: body, UpdatedAt: at}, nil
}
