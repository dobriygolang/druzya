// Package app contains the podcast use cases and event handlers. One use-case
// file per REST endpoint; event handlers collected in handlers.go.
package app

import (
	"context"
	"fmt"

	"druz9/podcast/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// CatalogEntry is the app-level projection returned by ListCatalog.
type CatalogEntry struct {
	Podcast   domain.Podcast
	AudioURL  string
	Progress  int
	Completed bool
}

// ListCatalog is the use case behind GET /podcast.
type ListCatalog struct {
	Podcasts domain.PodcastRepo
	Signer   domain.AudioSigner
}

// NewListCatalog wires the use case. Both repo and signer are required.
func NewListCatalog(p domain.PodcastRepo, s domain.AudioSigner) *ListCatalog {
	if p == nil {
		panic("podcast.NewListCatalog: PodcastRepo is required")
	}
	if s == nil {
		panic("podcast.NewListCatalog: AudioSigner is required")
	}
	return &ListCatalog{Podcasts: p, Signer: s}
}

// Do returns the full catalog (or a section-filtered slice) annotated with
// per-user progress + signed audio URLs. A nil `section` means "every section".
// Sign failures fail loudly — no placeholder URLs.
func (uc *ListCatalog) Do(ctx context.Context, userID uuid.UUID, section *enums.Section) ([]CatalogEntry, error) {
	rows, err := uc.Podcasts.ListForUser(ctx, userID, section)
	if err != nil {
		return nil, fmt.Errorf("podcast.ListCatalog: %w", err)
	}
	out := make([]CatalogEntry, 0, len(rows))
	for _, r := range rows {
		url, err := uc.Signer.Sign(ctx, r.Podcast.AudioKey)
		if err != nil {
			return nil, fmt.Errorf("podcast.ListCatalog: sign: %w", err)
		}
		out = append(out, CatalogEntry{
			Podcast:   r.Podcast,
			AudioURL:  url,
			Progress:  r.Progress,
			Completed: r.Completed,
		})
	}
	return out, nil
}
