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

// NewListCatalog wires the use case.
func NewListCatalog(p domain.PodcastRepo, s domain.AudioSigner) *ListCatalog {
	return &ListCatalog{Podcasts: p, Signer: s}
}

// Do returns the full catalog (or a section-filtered slice) annotated with
// per-user progress + signed audio URLs.
//
// nil-safe: a nil `section` parameter means "every section". The repo already
// handles the no-row case by returning an empty slice; this method never
// dereferences Signer if it's nil (STUB handling).
func (uc *ListCatalog) Do(ctx context.Context, userID uuid.UUID, section *enums.Section) ([]CatalogEntry, error) {
	rows, err := uc.Podcasts.ListForUser(ctx, userID, section)
	if err != nil {
		return nil, fmt.Errorf("podcast.ListCatalog: %w", err)
	}
	out := make([]CatalogEntry, 0, len(rows))
	for _, r := range rows {
		url := ""
		if uc.Signer != nil {
			u, err := uc.Signer.Sign(ctx, r.Podcast.AudioKey)
			if err != nil {
				return nil, fmt.Errorf("podcast.ListCatalog: sign: %w", err)
			}
			url = u
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
