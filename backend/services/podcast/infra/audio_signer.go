package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/podcast/domain"
)

// DefaultAudioSignTTL — TTL of presigned audio URLs returned to the client.
// Picked to outlive the catalog cache + a generous listen-then-resume window.
const DefaultAudioSignTTL = 60 * time.Minute

// MinioAudioSigner adapts a domain.PodcastObjectStore (MinIO-backed) to the
// domain.AudioSigner contract used by ListCatalog.
//
// No fallback path: if the underlying store is unconfigured, every Sign call
// surfaces ErrObjectStoreUnavailable so the catalog response carries a real
// error instead of a placeholder URL.
type MinioAudioSigner struct {
	Store domain.PodcastObjectStore
	TTL   time.Duration
}

// NewMinioAudioSigner wires the adapter. ttl <= 0 → DefaultAudioSignTTL.
// store is required.
func NewMinioAudioSigner(store domain.PodcastObjectStore, ttl time.Duration) *MinioAudioSigner {
	if store == nil {
		panic("podcast.infra.NewMinioAudioSigner: store is required")
	}
	if ttl <= 0 {
		ttl = DefaultAudioSignTTL
	}
	return &MinioAudioSigner{Store: store, TTL: ttl}
}

// Sign returns a presigned GET URL valid for s.TTL.
func (s *MinioAudioSigner) Sign(ctx context.Context, audioKey string) (string, error) {
	if audioKey == "" {
		return "", fmt.Errorf("podcast.infra.MinioAudioSigner.Sign: empty audioKey")
	}
	url, err := s.Store.PresignGet(ctx, audioKey, s.TTL)
	if err != nil {
		return "", fmt.Errorf("podcast.infra.MinioAudioSigner.Sign: %w", err)
	}
	return url, nil
}

// Compile-time guard.
var _ domain.AudioSigner = (*MinioAudioSigner)(nil)
