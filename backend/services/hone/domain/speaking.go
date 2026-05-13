// speaking.go — Phase J / H4 (P1) Speaking modality.
//
// Speaking sub-context — fourth English modality. Hone English hub had
// Reading/Writing/Listening but no Speaking → hub ≈ Reader. H4 closes:
// shadowing exercises (text prompt → mic record → STT grade against
// reference → coach feedback) + persisted sessions for drift tracking.
//
// Architecture:
//   - Exercises catalog — fixed, seeded в migration. ExerciseRepo.List
//     reads speaking_exercises.
//   - Per-recording session — speaking_sessions row. Idempotent via
//     (user_id, client_session_id) UNIQUE.
//   - Transcription — reuses transcription.Provider (Groq Whisper),
//     wrapped в STTProvider interface here чтобы hone не импортировал
//     transcription пакет напрямую (domain → infra adapter inversion).
//   - Grading — LLM compares user transcript vs reference, returns
//     pronunciation + fluency + word-diff + coach feedback line. Floor
//     adapter returns ErrLLMUnavailable when llmchain not wired.
//
// 2026-05-12: Audio is NOT persisted server-side — после STT мы
// держим только transcript + scores. Privacy + storage cost; the
// recording does its job once, no replay value.
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// SpeakingLevel — CEFR coarse buckets. Matches CHECK constraint in
// migration 00105.
type SpeakingLevel string

const (
	SpeakingLevelB1 SpeakingLevel = "B1"
	SpeakingLevelB2 SpeakingLevel = "B2"
	SpeakingLevelC1 SpeakingLevel = "C1"
)

// IsValid keeps switches downstream exhaustive.
func (l SpeakingLevel) IsValid() bool {
	switch l {
	case SpeakingLevelB1, SpeakingLevelB2, SpeakingLevelC1:
		return true
	}
	return false
}

// SpeakingExercise — one canned shadowing prompt from the catalog.
// AudioURL optional (empty when TTS pipeline not yet wired; client
// falls back to native speechSynthesis to render reference audio).
type SpeakingExercise struct {
	ID       string
	Level    SpeakingLevel
	Topic    string
	Prompt   string
	AudioURL string
}

// WordDiffStatus enumerates per-token comparison outcomes between the
// reference prompt and user transcript.
type WordDiffStatus string

const (
	WordDiffMatch      WordDiffStatus = "match"      // expected == actual
	WordDiffMiss       WordDiffStatus = "miss"       // expected present, actual absent
	WordDiffExtra      WordDiffStatus = "extra"      // actual present, no reference
	WordDiffSubstitute WordDiffStatus = "substitute" // both present, differ
)

// WordDiff — one token-level row from the alignment.
type WordDiff struct {
	Status   WordDiffStatus
	Expected string
	Actual   string
}

// SpeakingFeedback — what the grader returns. Persisted into
// speaking_sessions by the use case.
type SpeakingFeedback struct {
	PronunciationScore int    // 0..100
	FluencyScore       int    // 0..100
	CoachFeedback      string // 1 line, ≤140 chars
	WordDiffs          []WordDiff
}

// SpeakingSession — persisted history row.
type SpeakingSession struct {
	ID                 uuid.UUID
	UserID             uuid.UUID
	ClientSessionID    string // outbox idempotency key
	ExerciseID         string
	Prompt             string
	UserTranscript     string
	PronunciationScore int
	FluencyScore       int
	CoachFeedback      string
	DurationMS         int
	CreatedAt          time.Time
}

// ─── Ports (interfaces — infra adapters live elsewhere) ──────────────

// SpeakingExerciseRepo reads the seeded catalog. `level` filter is
// empty-string = all. UpdateAudioURL — admin-only write path used by
// the TTS-regen flow (Phase K Wave 9 / E4 P1); сами row'ы create'ятся
// миграцией, не RPC'ом.
type SpeakingExerciseRepo interface {
	List(ctx context.Context, level SpeakingLevel) ([]SpeakingExercise, error)
	Get(ctx context.Context, id string) (SpeakingExercise, error)
	UpdateAudioURL(ctx context.Context, id, audioURL string) error
}

// SpeakingSessionRepo persists graded sessions + reads history.
type SpeakingSessionRepo interface {
	// Insert is idempotent on (user_id, client_session_id) — ON CONFLICT
	// DO NOTHING. Returns the row that actually persisted (existing or
	// new). Outbox replay safe.
	Insert(ctx context.Context, s SpeakingSession) (SpeakingSession, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]SpeakingSession, error)
}

// STTInput — minimal payload for transcription.
type STTInput struct {
	Audio    []byte
	MIME     string // e.g. "audio/webm"
	Language string // BCP-47; empty = auto-detect (we hint "en" for Speaking)
}

// STTResult — Whisper output we care about.
type STTResult struct {
	Text     string
	Duration float64 // seconds — for fluency timing calc
}

// SpeakingSTT — boundary to transcription provider. Implementation
// wraps the existing transcription/domain.Provider (Groq Whisper).
// Adapter lives в infra/speaking_stt.go so the hone domain doesn't
// pull transcription as a dependency.
type SpeakingSTT interface {
	Transcribe(ctx context.Context, in STTInput) (STTResult, error)
}

// SpeakingGraderInput — what the LLM grader sees. Prompt is the
// reference; Transcript is what STT heard; Level scopes severity.
type SpeakingGraderInput struct {
	Prompt     string
	Transcript string
	Level      SpeakingLevel
	// DurationMS used to compute fluency variance vs target. 0 → skip
	// timing penalty (grader returns pure phonetic accuracy).
	DurationMS int
}

// SpeakingGrader — LLM-backed comparison. Floor adapter returns
// ErrLLMUnavailable. Same nil-policy as other Hone graders.
type SpeakingGrader interface {
	GradeSpeaking(ctx context.Context, in SpeakingGraderInput) (SpeakingFeedback, error)
}

// ErrAudioTooLarge — caller bound check. Use case returns user-actionable
// 413. 5MB pre-base64 is the cap (Whisper supports up to 25MB but a 5MB
// webm clip is ~5min of speech — much longer than any shadowing exercise).
var ErrAudioTooLarge = errors.New("hone: audio too large")

// ErrEmptyAudio — zero bytes. Client bug. Use case → 400.
var ErrEmptyAudio = errors.New("hone: empty audio")

// MaxSpeakingAudioBytes — 5MB hard cap before base64 expansion.
const MaxSpeakingAudioBytes = 5 * 1024 * 1024
