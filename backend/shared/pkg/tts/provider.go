// Package tts — text-to-speech provider interface + free-tier driver
// implementations. Phase K Wave 9 (E4 P1) — реальный native speaker
// audio для Speaking shadowing exercises, заменяет client-side
// speechSynthesis fallback.
//
// Cascade strategy: caller wires Provider один раз в bootstrap'е (см.
// backend/cmd/monolith/services/hone/tts.go). Подходит любой free-tier
// driver:
//
//   - Cloudflare Workers AI MeloTTS (`@cf/myshell-ai/melotts`) — default,
//     reuses existing CF API key + account ID. WAV output.
//   - Groq PlayAI TTS (`playai-tts`) — fast Groq cloud, WAV output.
//   - Google Cloud TTS — 1M chars/month free, MP3/OGG; deferred.
//
// Output bytes — raw audio; caller stores mime + extension. ContentType
// returned alongside так что storage layer не угадывает.
package tts

import (
	"context"
	"errors"
	"time"
)

// SynthesizeInput — minimal payload. Voice optional; provider falls
// back to internal default when empty (CF MeloTTS default = neutral
// English speaker).
type SynthesizeInput struct {
	Text  string
	Voice string // provider-specific id, e.g. "en-us" for MeloTTS
	Lang  string // BCP-47 hint; default "en"
}

// SynthesizeResult — audio payload + content-type. Length-prefixed via
// the byte slice; caller writes to storage as one PUT.
type SynthesizeResult struct {
	Audio       []byte
	ContentType string // "audio/mpeg" | "audio/wav" | "audio/ogg"
	Ext         string // ".mp3" | ".wav" | ".ogg" — convenience for object key
}

// Provider — boundary the use-case talks to. Single method. Errors
// propagate as-is; caller decides 502 (network) vs 503 (unconfigured).
type Provider interface {
	Synthesize(ctx context.Context, in SynthesizeInput) (SynthesizeResult, error)
}

// ErrUnavailable — provider intentionally not wired (no API key / no
// account ID). Caller returns 503; admin sees "TTS not configured".
var ErrUnavailable = errors.New("tts: provider unavailable")

// ErrEmptyText — guard against zero-length input. Cloudflare returns a
// generic 400 in that case; we reject earlier for clearer admin error.
var ErrEmptyText = errors.New("tts: empty text")

// Unconfigured — explicit no-op provider. Returned by NewCloudflare когда
// account_id / api_key пусты, чтобы caller mог wire'нуть без условных
// проверок (`provider != nil` повсюду unsafe — забудешь и упадёшь nil-deref).
type Unconfigured struct{}

// NewUnconfigured wires the no-op.
func NewUnconfigured() *Unconfigured { return &Unconfigured{} }

// Synthesize always returns ErrUnavailable.
func (Unconfigured) Synthesize(_ context.Context, _ SynthesizeInput) (SynthesizeResult, error) {
	return SynthesizeResult{}, ErrUnavailable
}

// Compile-time guards.
var (
	_ Provider = (*Unconfigured)(nil)
	_ Provider = (*Cloudflare)(nil)
)

// AudioStore — minimal storage boundary the use-case sees. MinIOStore
// imlpements; other backends (e.g. local-FS for dev) can plug in.
type AudioStore interface {
	Put(ctx context.Context, objectKey string, body []byte, contentType string) (string, error)
	PresignGet(ctx context.Context, objectKey string, ttl time.Duration) (string, error)
}

// Compile-time guard для MinIOStore.
var _ AudioStore = (*MinIOStore)(nil)

