package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// PublishRepo — низкоуровневая персистенция Phase C-4 «Publish to web» поверх
// колонок hone_notes.public_slug / published_at / encrypted. Держим отдельным
// интерфейсом (а не методами на NoteRepo), чтобы не разрастать NoteRepo и не
// тащить publish-семантику в чистый CRUD.
type PublishRepo interface {
	// LookupForPublish читает текущее publish-состояние + encrypted-флаг для
	// (user, note). ErrNotFound — note нет / не принадлежит юзеру.
	LookupForPublish(ctx context.Context, userID, noteID uuid.UUID) (PublishLookup, error)

	// SetPublishSlug пытается выставить slug (atomic). Возвращает (slug, at)
	// при успехе. UniqueViolation мапится в ErrPublishSlugCollision —
	// caller'у retry'ить с другим slug'ом. ErrNotFound — note нет.
	SetPublishSlug(ctx context.Context, userID, noteID uuid.UUID, slug string) (string, time.Time, error)

	// ClearPublish обнуляет slug + published_at. ErrNotFound — note нет.
	ClearPublish(ctx context.Context, userID, noteID uuid.UUID) error

	// GetPublishStatus читает только slug+at (для status endpoint).
	GetPublishStatus(ctx context.Context, userID, noteID uuid.UUID) (slug *string, at *time.Time, err error)

	// ListNotesMeta — bulk meta для всех активных (не archived) заметок
	// юзера. Возвращает только flags, не body.
	ListNotesMeta(ctx context.Context, userID uuid.UUID) ([]NoteMeta, error)

	// GetPublicView — server-side render data: title, body_md, updated_at —
	// по slug'у, только если note published И не archived.
	GetPublicView(ctx context.Context, slug string) (title, bodyMD string, updatedAt time.Time, err error)
}

// PublishLookup — что вернул LookupForPublish.
type PublishLookup struct {
	Slug        *string
	PublishedAt *time.Time
	Encrypted   bool
}

// NoteMeta — bulk-flags row.
type NoteMeta struct {
	ID        string
	Encrypted bool
	Published bool
}

// ErrPublishSlugCollision — UNIQUE-violation на public_slug. Retry-loop
// в use-case'е с новым slug'ом.
var ErrPublishSlugCollision = errPublishSlugCollision{}

type errPublishSlugCollision struct{}

func (errPublishSlugCollision) Error() string { return "hone: publish slug collision" }

// ErrEncryptedCannotPublish — note encrypted, publish запрещён.
var ErrEncryptedCannotPublish = errEncryptedCannotPublish{}

type errEncryptedCannotPublish struct{}

func (errEncryptedCannotPublish) Error() string { return "hone: encrypted note cannot be published" }
