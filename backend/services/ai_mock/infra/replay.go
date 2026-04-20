package infra

import (
	"context"
	"fmt"

	"druz9/ai_mock/domain"

	"github.com/google/uuid"
)

// StubReplayUploader returns a fake presigned URL so the report generator can
// populate replay_url without a real MinIO roundtrip.
//
// STUB: swap for a real MinIO client that PUTs the blob to `mock-replays/{id}`
// and returns a time-boxed presigned GET URL (bible §3.2 — TTL 1h). When that
// lands, assert the URL TTL in a test.
type StubReplayUploader struct {
	BaseURL string
}

// NewStubReplayUploader builds a stub with a fake base URL. Use
// cfg.MinIO.Endpoint in production.
func NewStubReplayUploader(baseURL string) *StubReplayUploader {
	if baseURL == "" {
		baseURL = "https://replays.example.local"
	}
	return &StubReplayUploader{BaseURL: baseURL}
}

// Upload is the stub implementation — it doesn't actually push the bytes; it
// synthesises a URL shape that mirrors what the future MinIO client will return.
func (u *StubReplayUploader) Upload(ctx context.Context, sessionID uuid.UUID, payload []byte) (string, error) {
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	// STUB: real implementation uploads payload + returns presigned GET with
	// X-Amz-Expires=3600. We just drop the payload on the floor and emit a URL.
	_ = payload
	return fmt.Sprintf("%s/mock-replays/%s.json?stub=1", u.BaseURL, sessionID), nil
}

// Interface guard.
var _ domain.ReplayUploader = (*StubReplayUploader)(nil)
