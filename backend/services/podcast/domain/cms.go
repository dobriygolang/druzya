// cms.go — runtime CMS surface (admin upload + public discovery).
//
// The legacy types in entity.go / repo.go drive the bible §3.9 catalog with
// per-user progress (GET /podcast Connect RPC). The CMS additions in this
// file are deliberately separate so they can evolve without churning the
// existing PodcastRepo / Listing surface used by progress tracking.
//
// Wiring:
//   - PodcastCMSRepo is implemented by infra.PostgresCMS and lives behind
//     a Redis read-through (infra.NewCachedCMSRepo).
//   - PodcastObjectStore is implemented by infra.MinIOPodcastStore (real
//     S3 v4 — no minio-go SDK, mirrors ai_mock/infra/replay.go) or by
//     infra.UnconfiguredObjectStore which returns ErrObjectStoreUnavailable
//     so the admin endpoints answer 503 instead of producing dead audio_url.
package domain

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors for the CMS surface. Wrapped via fmt.Errorf at every
// boundary; ports/cms_handler.go maps them to HTTP status codes.
var (
	// ErrCategoryNotFound — admin asked for a category id that does not
	// exist in podcast_categories.
	ErrCategoryNotFound = errors.New("podcast: category not found")
	// ErrCategoryConflict — slug uniqueness violation.
	ErrCategoryConflict = errors.New("podcast: category slug already exists")
	// ErrInvalidPodcast — required CMS field missing (title, audio key, …).
	ErrInvalidPodcast = errors.New("podcast: invalid input")
	// ErrObjectStoreUnavailable — MinIO creds are not configured. The
	// admin endpoints answer 503 with this in the body so operators see
	// "missing MINIO_*" instead of an opaque 500.
	ErrObjectStoreUnavailable = errors.New("podcast: object store not configured")
)

// PodcastCategory mirrors a row of `podcast_categories`. Color is stored
// as a 7-char hex string (#rrggbb) and is used by the UI for filter chips.
type PodcastCategory struct {
	ID        uuid.UUID
	Slug      string
	Name      string
	Color     string
	SortOrder int
	CreatedAt time.Time
}

// CMSPodcast is the CMS-augmented projection of a row of `podcasts`. It
// keeps all fields of the legacy entity.Podcast plus the new optional
// CMS metadata. AudioURL is populated by the use case after asking the
// PodcastObjectStore for a presigned GET URL.
type CMSPodcast struct {
	ID          uuid.UUID
	Title       string // mirrors title_ru (CMS UI is RU-first; title_en preserved)
	TitleEN     string // legacy column kept for compatibility
	Description string
	Host        string
	CategoryID  *uuid.UUID
	Category    *PodcastCategory // populated when the repo joins
	EpisodeNum  *int
	DurationSec int
	AudioKey    string // object key in the podcasts bucket
	AudioURL    string // presigned GET URL — empty when store unavailable
	CoverURL    string
	IsPublished bool
	PublishedAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CMSPodcastUpsert is the input bundle the admin handler hands the repo
// when creating or patching a row. Pointer fields ⇒ "leave the existing
// value untouched on PATCH"; non-pointer fields are required on CREATE.
type CMSPodcastUpsert struct {
	Title       string
	TitleEN     string
	Description string
	Host        string
	CategoryID  *uuid.UUID
	EpisodeNum  *int
	DurationSec int
	AudioKey    string
	CoverURL    string
	IsPublished bool
	PublishedAt *time.Time
}

// CMSListFilter constrains GET /podcast (CMS variant). CategoryID filters
// by id (the legacy section filter is unaffected).
type CMSListFilter struct {
	CategoryID    *uuid.UUID
	OnlyPublished bool
	Limit         int // 0 → repo default (50)
	Offset        int
}

// PodcastCMSRepo is the persistence port for the CMS surface.
//
//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/cms_mock.go -source cms.go
type PodcastCMSRepo interface {
	// ListCMS returns a category-aware podcast page. Non-published rows
	// are excluded when OnlyPublished is true (public path); admin path
	// passes false so curators see drafts.
	ListCMS(ctx context.Context, f CMSListFilter) ([]CMSPodcast, error)
	// GetCMSByID returns a single CMS row. ErrNotFound when missing
	// (re-uses the legacy sentinel from entity.go for symmetry).
	GetCMSByID(ctx context.Context, id uuid.UUID) (CMSPodcast, error)
	// CreateCMS inserts a row and returns the freshly created entity.
	CreateCMS(ctx context.Context, in CMSPodcastUpsert) (CMSPodcast, error)
	// UpdateCMS patches the row. Pointer/empty-string semantics: see
	// CMSPodcastUpsert godoc.
	UpdateCMS(ctx context.Context, id uuid.UUID, in CMSPodcastUpsert) (CMSPodcast, error)
	// DeleteCMS removes the row. Returns ErrNotFound when the row does
	// not exist. Caller is responsible for removing the MinIO object.
	DeleteCMS(ctx context.Context, id uuid.UUID) (audioKey string, err error)

	// ListCategories returns every category, sorted by sort_order asc.
	ListCategories(ctx context.Context) ([]PodcastCategory, error)
	// GetCategoryByID — single row lookup. ErrCategoryNotFound when
	// missing.
	GetCategoryByID(ctx context.Context, id uuid.UUID) (PodcastCategory, error)
	// CreateCategory inserts a new category. Returns ErrCategoryConflict
	// when the slug already exists.
	CreateCategory(ctx context.Context, in PodcastCategory) (PodcastCategory, error)
}

// PodcastObjectStore abstracts the MinIO bucket. Two implementations:
//
//   - infra.MinIOPodcastStore — real S3 v4 client (PUT + presigned GET +
//     DELETE).
//   - infra.UnconfiguredObjectStore — every method returns
//     ErrObjectStoreUnavailable so the admin endpoints can answer 503
//     when the operator forgot to set MINIO_* env vars.
type PodcastObjectStore interface {
	// PutAudio uploads `body` under `objectKey` and returns the canonical
	// object key. Length is required so the S3 v4 PUT can set
	// Content-Length without buffering the entire stream.
	PutAudio(ctx context.Context, objectKey string, body io.Reader, length int64, contentType string) (string, error)
	// PresignGet returns a time-limited GET URL for `objectKey`.
	// Implementations cap ttl at 7 days (S3 v4 hard limit).
	PresignGet(ctx context.Context, objectKey string, ttl time.Duration) (string, error)
	// Delete removes the object. Idempotent — returns nil for "missing".
	Delete(ctx context.Context, objectKey string) error
	// Available reports whether the store is reachable. False ⇒ caller
	// should answer 503 ErrObjectStoreUnavailable instead of trying.
	Available() bool
}
