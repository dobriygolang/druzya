// Package domain declares the types and ports for the transcription
// service. Speech-to-text plus a thin StreamingTranscriber port for the
// WS surface — no diarization, no live audio mixing at this layer.
// Those belong to higher-level orchestrators (future: live-coach service).
package domain

import (
	"context"
	"errors"
)

// TranscribeInput carries everything a Provider needs to transcribe one
// audio blob. Language is a BCP-47 code ("ru", "en", …) or empty for
// auto-detect.
//
// The handler enforces an upper bound on Audio length before this struct
// is built; domain code trusts the size as a given.
type TranscribeInput struct {
	// Audio — the raw container bytes (webm/opus, mp3, wav, m4a — any
	// format the Provider supports). We don't re-encode on the server.
	Audio []byte
	// Filename hint — some providers key format detection off the
	// extension. "recording.webm" is a safe default.
	Filename string
	// MIME type of Audio. Passed verbatim in the multipart Content-Type
	// so provider-side detection works when the extension is ambiguous.
	MIME string
	// Language — BCP-47 hint. Empty → provider auto-detects.
	Language string
	// Prompt — optional bias phrase ("Druz9, Elo, cohort") that primes
	// the model toward domain vocabulary. Used for project-specific
	// jargon that generic Whisper mis-hears.
	Prompt string
	// Model — Whisper model identifier (provider-specific). Empty →
	// provider chooses default. Used by tier-aware decorator to route
	// free-tier users to faster/cheaper turbo и paid users to higher-
	// accuracy non-turbo. Например: "whisper-large-v3-turbo" vs
	// "whisper-large-v3" для Groq.
	Model string
}

// TranscribeResult is what we hand back to callers. Segments are
// populated when the Provider was asked for timestamped output;
// zero-length otherwise. Always check Text — it's the canonical form.
type TranscribeResult struct {
	Text     string
	Language string  // what the provider detected (or the hint we passed through)
	Duration float64 // seconds — useful for cost accounting upstream
	// Segments — optional word/sentence-level timestamps. Empty slice
	// when the Provider was asked for plain text (the default).
	Segments []Segment
}

type Segment struct {
	Start float64 // seconds
	End   float64
	Text  string
}

// Provider is the STT boundary. Implementations are infra concerns —
// GroqProvider, future AssemblyAIProvider, mock for tests.
type Provider interface {
	Transcribe(ctx context.Context, in TranscribeInput) (TranscribeResult, error)
	// Name identifies the provider in logs/metrics — "groq",
	// "assemblyai". Stable across deploys.
	Name() string
}

// ─────────────────────────────────────────────────────────────────────────
// Errors — handler maps these to HTTP codes.
// ─────────────────────────────────────────────────────────────────────────

var (
	// ErrTooLarge — audio byte cap exceeded. Handler returns 413.
	ErrTooLarge = errors.New("transcription: audio too large")
	// ErrEmptyAudio — zero bytes. Client bug (mic permission denied
	// silently?). Handler returns 400.
	ErrEmptyAudio = errors.New("transcription: empty audio")
	// ErrProviderUnavailable — network/auth failure at the STT provider.
	// Handler returns 502; caller retries if they want.
	ErrProviderUnavailable = errors.New("transcription: provider unavailable")
)

// MaxAudioBytes — hard cap on a single Transcribe request's audio size.
// 25MB mirrors OpenAI/Groq Whisper's documented input limit; we reject
// earlier at the API boundary so the user sees a clear error.
const MaxAudioBytes = 25 * 1024 * 1024

// ─────────────────────────────────────────────────────────────────────────
// Streaming surface (WS endpoint).
// ─────────────────────────────────────────────────────────────────────────

// StreamingTranscriber — boundary для WS handler'а. Pragmatic shim:
// Whisper и аналоги (Cerebras, Mistral) на free-tier'е НЕ умеют
// продолжительный stream — они принимают batch и возвращают batch.
// Поэтому интерфейс называется streaming "по контексту" (handler
// аккумулирует input chunks в окно и дёргает реализацию), а не по
// payload'у. Будущая Deepgram/AssemblyAI streaming impl сможет
// переопределить behaviour прокинув `keep` true чтобы handler НЕ
// сбрасывал window после flush'а.
//
// Implementations:
//   - GroqWhisperBatch (infra): WAV-wrap PCM16 + Provider.Transcribe.
//   - Mock (tests): deterministic for assertion на windowing logic.
type StreamingTranscriber interface {
	// TranscribeWindow принимает накопленный аудио-window и возвращает
	// результат в формате Provider'а. isPartial=true сигналит handler'у
	// что текущий window НЕ финальный — например streaming-impl ещё
	// получит больше данных в этой же фразе. Для Groq/Cerebras всегда
	// false (один window = один final fragment).
	TranscribeWindow(ctx context.Context, in TranscribeInput) (res TranscribeResult, isPartial bool, err error)
	// Name — provider id для logs/metrics ("groq-batch", "deepgram-stream").
	Name() string
}
