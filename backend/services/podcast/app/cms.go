// cms.go — use cases backing the runtime CMS endpoints.
//
//   - ListCMSPodcasts:    GET /podcast (public; populates audio_url via store)
//   - GetCMSPodcast:      GET /podcast/:id
//   - CreatePodcast:      POST /admin/podcast (multipart upload)
//   - UpdatePodcast:      PATCH /admin/podcast/:id (metadata only)
//   - DeletePodcast:      DELETE /admin/podcast/:id (+ MinIO object)
//   - ListCategories:     GET /podcast/categories
//   - CreateCategory:     POST /admin/podcast/categories
//
// Auth lives in ports/cms_handler.go — these use cases assume the caller
// has already vetted role=admin where applicable.
package app

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"time"

	"druz9/podcast/domain"

	"github.com/google/uuid"
)

// PresignTTL is the TTL passed to PodcastObjectStore.PresignGet for both
// list and single endpoints. Aligned with the in-process cache TTL so the
// URL outlives every cached list response.
const PresignTTL = 45 * time.Minute

// CMSService bundles the dependencies of every CMS use case. We collapse
// them into one struct (vs. one struct per use case) because the surface
// is small and every endpoint pulls from the same triplet.
type CMSService struct {
	Repo  domain.PodcastCMSRepo
	Store domain.PodcastObjectStore
	Log   *slog.Logger
	Now   func() time.Time
}

// NewCMSService wires the bundle. log is required; now defaults to time.Now.
func NewCMSService(repo domain.PodcastCMSRepo, store domain.PodcastObjectStore, log *slog.Logger, now func() time.Time) *CMSService {
	if log == nil {
		panic("podcast.app.NewCMSService: logger is required (anti-fallback policy: no silent noop loggers)")
	}
	if now == nil {
		now = time.Now
	}
	if store == nil {
		// Defensive — wirer always passes a non-nil store, but keep the
		// fallback symmetric with the rest of the package.
		store = noopStore{}
	}
	return &CMSService{Repo: repo, Store: store, Log: log, Now: now}
}

// ListCMSPodcasts returns every published podcast (filterable by
// category) annotated with a presigned audio URL.
func (s *CMSService) ListCMSPodcasts(ctx context.Context, f domain.CMSListFilter) ([]domain.CMSPodcast, error) {
	rows, err := s.Repo.ListCMS(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("podcast.app.ListCMSPodcasts: %w", err)
	}
	for i := range rows {
		s.populateAudioURL(ctx, &rows[i])
	}
	return rows, nil
}

// GetCMSPodcast returns a single row + presigned URL.
func (s *CMSService) GetCMSPodcast(ctx context.Context, id uuid.UUID) (domain.CMSPodcast, error) {
	row, err := s.Repo.GetCMSByID(ctx, id)
	if err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.app.GetCMSPodcast: %w", err)
	}
	s.populateAudioURL(ctx, &row)
	return row, nil
}

// populateAudioURL fills row.AudioURL using the store's PresignGet, or
// leaves it empty when the store is unavailable. Never returns an error
// — the caller's surface still includes the metadata even without audio.
func (s *CMSService) populateAudioURL(ctx context.Context, row *domain.CMSPodcast) {
	if row.AudioKey == "" || s.Store == nil || !s.Store.Available() {
		return
	}
	url, err := s.Store.PresignGet(ctx, row.AudioKey, PresignTTL)
	if err != nil {
		s.Log.Warn("podcast.app: presign failed",
			slog.String("audio_key", row.AudioKey), slog.Any("err", err))
		return
	}
	row.AudioURL = url
}

// CreatePodcastInput is the bundle the admin handler builds from the
// multipart request body. Audio is a stream + length pair so the use
// case never buffers it (the store does, once, before signing).
type CreatePodcastInput struct {
	Title       string
	TitleEN     string
	Description string
	Host        string
	CategoryID  *uuid.UUID
	EpisodeNum  *int
	DurationSec int
	CoverURL    string
	IsPublished bool
	PublishedAt *time.Time

	AudioFilename    string // original filename — used for the extension
	AudioContentType string
	AudioBody        io.Reader
	AudioLength      int64
}

// CreatePodcast uploads the audio, then inserts the metadata row. On
// upload failure the row is NOT created (we return ErrObjectStoreUnavailable
// or a wrapped err). On DB failure after a successful upload we attempt a
// best-effort object delete to avoid orphans.
func (s *CMSService) CreatePodcast(ctx context.Context, in CreatePodcastInput) (domain.CMSPodcast, error) {
	if strings.TrimSpace(in.Title) == "" {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.app.CreatePodcast: %w: title required", domain.ErrInvalidPodcast)
	}
	if in.AudioBody == nil || in.AudioLength == 0 {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.app.CreatePodcast: %w: audio required", domain.ErrInvalidPodcast)
	}
	if !s.Store.Available() {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.app.CreatePodcast: %w", domain.ErrObjectStoreUnavailable)
	}
	// Validate category up-front so a bogus id does not consume an upload.
	if in.CategoryID != nil {
		if _, cerr := s.Repo.GetCategoryByID(ctx, *in.CategoryID); cerr != nil {
			return domain.CMSPodcast{}, fmt.Errorf("podcast.app.CreatePodcast: %w", cerr)
		}
	}
	objectKey := buildObjectKey(in.AudioFilename)
	// Если duration не передан — пробуем вытащить из mp3-frame'ов. Для
	// этого читаем тело в буфер один раз; PutAudio тоже буферизует —
	// двойной alloc, но podcast'ы небольшие (≤200 MB) и юзер благодарит
	// за «не указывайте duration вручную». Не-mp3 → возвращается 0,
	// падаем обратно на user-provided.
	durationSec := in.DurationSec
	body := in.AudioBody
	if durationSec == 0 {
		buf, rerr := io.ReadAll(in.AudioBody)
		if rerr != nil {
			return domain.CMSPodcast{}, fmt.Errorf("podcast.app.CreatePodcast: read audio: %w", rerr)
		}
		if extracted := extractMP3Duration(buf); extracted > 0 {
			durationSec = extracted
		}
		body = bytes.NewReader(buf)
	}
	if _, err := s.Store.PutAudio(ctx, objectKey, body, in.AudioLength, in.AudioContentType); err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.app.CreatePodcast: %w", err)
	}
	row, err := s.Repo.CreateCMS(ctx, domain.CMSPodcastUpsert{
		Title:       in.Title,
		TitleEN:     in.TitleEN,
		Description: in.Description,
		Host:        in.Host,
		CategoryID:  in.CategoryID,
		EpisodeNum:  in.EpisodeNum,
		DurationSec: durationSec,
		AudioKey:    objectKey,
		CoverURL:    in.CoverURL,
		IsPublished: in.IsPublished,
		PublishedAt: in.PublishedAt,
	})
	if err != nil {
		// Best-effort orphan cleanup. Logging is sufficient — the next
		// admin upload starts fresh.
		if delErr := s.Store.Delete(ctx, objectKey); delErr != nil {
			s.Log.Warn("podcast.app: orphan cleanup failed after CreatePodcast db error",
				slog.String("object_key", objectKey), slog.Any("delete_err", delErr))
		}
		return domain.CMSPodcast{}, fmt.Errorf("podcast.app.CreatePodcast: %w", err)
	}
	s.populateAudioURL(ctx, &row)
	return row, nil
}

// UpdatePodcastInput is the metadata-only PATCH body. To replace the
// audio file the admin must DELETE + POST.
type UpdatePodcastInput struct {
	Title       string
	Description string
	Host        string
	CategoryID  *uuid.UUID
	EpisodeNum  *int
	DurationSec int
	CoverURL    string
	IsPublished bool
	PublishedAt *time.Time
}

// UpdatePodcast patches the row.
func (s *CMSService) UpdatePodcast(ctx context.Context, id uuid.UUID, in UpdatePodcastInput) (domain.CMSPodcast, error) {
	if strings.TrimSpace(in.Title) == "" {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.app.UpdatePodcast: %w: title required", domain.ErrInvalidPodcast)
	}
	if in.CategoryID != nil {
		if _, cerr := s.Repo.GetCategoryByID(ctx, *in.CategoryID); cerr != nil {
			return domain.CMSPodcast{}, fmt.Errorf("podcast.app.UpdatePodcast: %w", cerr)
		}
	}
	row, err := s.Repo.UpdateCMS(ctx, id, domain.CMSPodcastUpsert{
		Title:       in.Title,
		Description: in.Description,
		Host:        in.Host,
		CategoryID:  in.CategoryID,
		EpisodeNum:  in.EpisodeNum,
		DurationSec: in.DurationSec,
		CoverURL:    in.CoverURL,
		IsPublished: in.IsPublished,
		PublishedAt: in.PublishedAt,
	})
	if err != nil {
		return domain.CMSPodcast{}, fmt.Errorf("podcast.app.UpdatePodcast: %w", err)
	}
	s.populateAudioURL(ctx, &row)
	return row, nil
}

// DeletePodcast removes the row and the MinIO object. Object deletion is
// best-effort — a stale object is preferable to a failed admin op.
func (s *CMSService) DeletePodcast(ctx context.Context, id uuid.UUID) error {
	key, err := s.Repo.DeleteCMS(ctx, id)
	if err != nil {
		return fmt.Errorf("podcast.app.DeletePodcast: %w", err)
	}
	if key != "" && s.Store != nil && s.Store.Available() {
		if delErr := s.Store.Delete(ctx, key); delErr != nil {
			s.Log.Warn("podcast.app: object delete failed after row delete",
				slog.String("object_key", key), slog.Any("err", delErr))
		}
	}
	return nil
}

// ListCategories — public.
func (s *CMSService) ListCategories(ctx context.Context) ([]domain.PodcastCategory, error) {
	rows, err := s.Repo.ListCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("podcast.app.ListCategories: %w", err)
	}
	return rows, nil
}

// CreateCategory — admin.
func (s *CMSService) CreateCategory(ctx context.Context, in domain.PodcastCategory) (domain.PodcastCategory, error) {
	if strings.TrimSpace(in.Slug) == "" || strings.TrimSpace(in.Name) == "" {
		return domain.PodcastCategory{}, fmt.Errorf("podcast.app.CreateCategory: %w", domain.ErrInvalidPodcast)
	}
	out, err := s.Repo.CreateCategory(ctx, in)
	if err != nil {
		return domain.PodcastCategory{}, fmt.Errorf("podcast.app.CreateCategory: %w", err)
	}
	return out, nil
}

// buildObjectKey produces a stable per-upload key. Collisions are
// astronomically unlikely thanks to the embedded uuid.
func buildObjectKey(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" || len(ext) > 8 {
		ext = ".bin"
	}
	return "audio/" + uuid.NewString() + ext
}

// noopStore is the tiny fallback baked into NewCMSService for nil-store
// safety. Real wirers MUST pass a real store; this exists only to keep
// the public constructor robust against test fixtures.
type noopStore struct{}

func (noopStore) Available() bool { return false }
func (noopStore) PutAudio(_ context.Context, _ string, _ io.Reader, _ int64, _ string) (string, error) {
	return "", domain.ErrObjectStoreUnavailable
}
func (noopStore) PresignGet(_ context.Context, _ string, _ time.Duration) (string, error) {
	return "", domain.ErrObjectStoreUnavailable
}
func (noopStore) Delete(_ context.Context, _ string) error {
	return domain.ErrObjectStoreUnavailable
}
