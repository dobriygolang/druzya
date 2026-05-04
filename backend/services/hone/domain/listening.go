package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Listening sub-context — Wave 6.1 of docs/feature/plan.md.
// Parallel to Reading (Wave 4): one library of materials, click-on-word
// reuses the existing hone_vocab_queue table. No sessions for V1 — we
// don't track «how much I listened» yet.

// ListeningMaterial mirrors a row in hone_listening_materials. AudioURL
// is whatever the user pasted; the frontend is expected to validate that
// it's a directly playable URL before submit (the backend takes it as a
// flat string — a future YouTube/Spotify fetcher would be a server-side
// transformer that lands a usable URL here).
type ListeningMaterial struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	Title        string
	AudioURL     string
	TranscriptMD string
	ArchivedAt   *time.Time // soft-delete; nil = active
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// ListeningRepo is the persistence surface. Same shape as ReadingRepo's
// material methods — Hone's other sub-contexts use one fat repo per
// area, we follow suit.
type ListeningRepo interface {
	// CreateMaterial persists a new material. Caller fills Title,
	// AudioURL, TranscriptMD; the repo stamps ID + timestamps.
	CreateMaterial(ctx context.Context, m ListeningMaterial) (ListeningMaterial, error)

	// GetMaterial loads a single material; ErrNotFound when absent OR
	// when the requested user_id doesn't own it (cross-user leak
	// protection — same convention as ReadingRepo).
	GetMaterial(ctx context.Context, userID, materialID uuid.UUID) (ListeningMaterial, error)

	// ListMaterials returns the user's active materials (ArchivedAt
	// IS NULL), most-recent first. limit caps the result.
	ListMaterials(ctx context.Context, userID uuid.UUID, limit int) ([]ListeningMaterial, error)

	// ArchiveMaterial soft-deletes a material. Returns ErrNotFound if
	// the row doesn't exist or belongs to another user.
	ArchiveMaterial(ctx context.Context, userID, materialID uuid.UUID, now time.Time) error
}

// YouTubeFetcher — pulls auto-captions из YouTube видео. Реализуется через
// yt-dlp бинарь в monolith infra (не FFmpeg / не Whisper). Если у видео
// нет captions — возвращает ErrInvalidInput с понятным message.
type YouTubeFetcher interface {
	Fetch(ctx context.Context, url, languageHint string) (YouTubeFetchResult, error)
}

// YouTubeFetchResult — результат успешного pull'а.
type YouTubeFetchResult struct {
	// Title видео (если удалось extract'нуть).
	Title string
	// Transcript — plain-text версия captions, склеенная line-by-line.
	Transcript string
	// CanonicalURL — youtube.com/watch?v=<id> формат для embed'а.
	CanonicalURL string
	// LanguageDetected — какой captions track в итоге pulled (en/ru/...).
	LanguageDetected string
}
