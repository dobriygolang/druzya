// Package killswitch provides an operator-controlled way to disable
// specific features without a deploy. Use-case: Groq bill spikes at
// 3am, operator runs `redis-cli SET killswitch:transcription on` and
// STT stops serving new requests while they diagnose.
//
// Keys are namespaced under `killswitch:<feature>`; presence of any
// value (typically "on" or "1") flips the switch. Absence = feature
// active. Operators can tune TTL if they want auto-recovery:
//
//	SET killswitch:transcription on EX 3600
//
// Checks are Redis GET per call. At 100 req/s per feature × 5 features
// this is ~500 trivial GETs/s — negligible next to an LLM roundtrip.
// We deliberately don't cache locally: an emergency flip should be
// respected within a second, not minutes.
package killswitch

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Feature is a typed string of the allowed kill-switch targets. Adding
// a new one here is the only place you touch — handlers accept it and
// pass through to IsOn.
type Feature string

const (
	FeatureDocumentsUpload   Feature = "documents_upload"
	FeatureDocumentsURL      Feature = "documents_url"
	FeatureTranscription     Feature = "transcription"
	FeatureCopilotAnalyze    Feature = "copilot_analyze"
	FeatureCopilotSuggestion Feature = "copilot_suggestion"
)

// Switch checks Redis for an active kill-switch on a feature. A nil
// Switch (nil client) always returns off — matches dev-without-Redis
// behaviour elsewhere in the codebase.
type Switch struct {
	rdb *redis.Client
}

// New builds a Switch over the shared Redis client. Pass nil-rdb to
// effectively disable the mechanism (every call returns off).
func New(rdb *redis.Client) *Switch {
	return &Switch{rdb: rdb}
}

// IsOn returns true when the feature is currently tripped. On Redis
// transport errors we fail OPEN (return false) — an emergency flip
// that can't be read shouldn't lock users out of the whole feature;
// operators will notice via unrelated monitoring.
//
// Deliberately short timeout: the check sits on the hot path, a slow
// Redis shouldn't add >50ms to every request.
func (s *Switch) IsOn(ctx context.Context, f Feature) bool {
	if s == nil || s.rdb == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()
	_, err := s.rdb.Get(ctx, key(f)).Result()
	if err != nil {
		// redis.Nil → absent → off (expected hot-path outcome).
		if errors.Is(err, redis.Nil) {
			return false
		}
		// Transport error → fail-open, same as rate limiter.
		return false
	}
	// Any non-nil value counts as "on". We don't distinguish between
	// "on" / "1" / "true" — operator picks whatever.
	return true
}

// key builds the Redis key for a feature. Kept private to funnel all
// access through IsOn; cuts the risk of a typo in the operator's
// mental model ("was it killswitch:X or kill-switch:X?").
func key(f Feature) string {
	return "killswitch:" + string(f)
}
