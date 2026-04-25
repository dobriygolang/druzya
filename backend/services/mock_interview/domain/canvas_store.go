package domain

import (
	"context"
	"errors"
	"time"
)

// ErrCanvasStoreUnavailable — sentinel for canvas store failure / no creds.
// Orchestrator falls back to inline-data-url storage when this is returned
// so the feature degrades gracefully on prod without MinIO credentials.
var ErrCanvasStoreUnavailable = errors.New("mock_interview.canvas_store: unavailable")

// CanvasStore is a small object-store interface used by the sysdesign-canvas
// flow. Implementations:
//
//   - infra.MinIOCanvasStore — S3-compatible bucket (production).
//   - infra.UnconfiguredCanvasStore — explicit no-op fallback that returns
//     ErrCanvasStoreUnavailable on every op.
type CanvasStore interface {
	// Available reports whether the store has the minimum config to operate.
	Available() bool
	// PutPNG uploads a PNG (or JPEG — content_type controlled by caller) and
	// returns the persisted key (without the s3:// prefix).
	PutPNG(ctx context.Context, key string, png []byte, contentType string) error
	// PresignGet returns a time-limited GET URL for the object.
	PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error)
}
