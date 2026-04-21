package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/editor/domain"

	"github.com/google/uuid"
)

// StubReplayUploader fakes a MinIO presigned GET so the replay endpoint can
// return a URL without a real object-storage roundtrip.
//
// STUB: swap for a real MinIO client that PUTs the JSONL payload to
// `editor-replays/{roomID}.jsonl` and issues a presigned GET with
// X-Amz-Expires=3600 (bible §3.1 — TTL 1h). MinIO lifecycle policy handles
// retention (bible §6). Assert presigned URL shape in an integration test
// when the real client lands.
type StubReplayUploader struct {
	// BaseURL is logged into the fake URL shape; production uses cfg.MinIO.Endpoint.
	BaseURL string
	// TTL is surfaced to the caller so they can advertise expires_at.
	TTL time.Duration
}

// NewStubReplayUploader builds a stub with a fake base URL.
// The bible default is https://storage.druz9.local — we honour that.
func NewStubReplayUploader(baseURL string, ttl time.Duration) *StubReplayUploader {
	if baseURL == "" {
		baseURL = "https://storage.druz9.local"
	}
	if ttl <= 0 {
		ttl = domain.DefaultReplayTTL
	}
	return &StubReplayUploader{BaseURL: baseURL, TTL: ttl}
}

// Upload is the stub impl — it drops the payload on the floor and synthesises
// the URL shape the real MinIO client will eventually return.
func (u *StubReplayUploader) Upload(ctx context.Context, roomID uuid.UUID, payload []byte) (string, time.Time, error) {
	if ctx.Err() != nil {
		return "", time.Time{}, fmt.Errorf("ctx cancelled: %w", ctx.Err())
	}
	_ = payload // STUB — real impl uploads JSONL multipart.
	expires := time.Now().Add(u.TTL).UTC()
	return fmt.Sprintf("%s/replays/%s.jsonl", u.BaseURL, roomID), expires, nil
}

// Interface guard.
var _ domain.ReplayUploader = (*StubReplayUploader)(nil)
