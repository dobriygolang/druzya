// Package app — Speaking modality use cases.
//
// Three orchestrators:
//  1. ListSpeakingExercises — catalog browser (level filter).
//  2. GradeSpeaking — STT + LLM grade + persist session.
//  3. ListSpeakingHistory — recent N rows for sparkline + history list.
//
// Architecture decisions:
//   - Audio is processed once + dropped — server stores transcript +
//     scores only. Privacy + storage cost; recording has no replay value.
//   - Idempotent grade via (user_id, client_session_id) UNIQUE on the
//     repo Insert. Outbox replay-safe.
//   - Audio base64 decoding happens здесь (use-case layer) — domain
//     receives raw bytes via STTInput. Boundary check (MaxSpeakingAudioBytes)
//     is on the decoded length, NOT the base64 length.
package app

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── ListSpeakingExercises ────────────────────────────────────────────────

type ListSpeakingExercises struct {
	Repo domain.SpeakingExerciseRepo
}

type ListSpeakingExercisesInput struct {
	Level string // empty = all levels
}

func (uc *ListSpeakingExercises) Do(ctx context.Context, in ListSpeakingExercisesInput) ([]domain.SpeakingExercise, error) {
	level := domain.SpeakingLevel(strings.TrimSpace(in.Level))
	// Empty level is a valid sentinel — repo treats it as "no filter".
	if level != "" && !level.IsValid() {
		return nil, fmt.Errorf("hone.ListSpeakingExercises: invalid level %q", in.Level)
	}
	items, err := uc.Repo.List(ctx, level)
	if err != nil {
		return nil, fmt.Errorf("hone.ListSpeakingExercises: %w", err)
	}
	return items, nil
}

// ─── GradeSpeaking ────────────────────────────────────────────────────────

type GradeSpeaking struct {
	Exercises domain.SpeakingExerciseRepo
	Sessions  domain.SpeakingSessionRepo
	STT       domain.SpeakingSTT
	Grader    domain.SpeakingGrader
}

type GradeSpeakingInput struct {
	UserID          uuid.UUID
	ExerciseID      string
	ClientSessionID string
	AudioBase64     string
	MIMEType        string
	DurationMS      int
}

func (uc *GradeSpeaking) Do(ctx context.Context, in GradeSpeakingInput) (domain.SpeakingSession, error) {
	if uc.Exercises == nil || uc.Sessions == nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: repos not wired")
	}
	if uc.STT == nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: stt not wired")
	}
	if uc.Grader == nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: grader not wired")
	}
	if in.UserID == uuid.Nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: user_id required")
	}
	exerciseID := strings.TrimSpace(in.ExerciseID)
	if exerciseID == "" {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: exercise_id required")
	}
	clientSessionID := strings.TrimSpace(in.ClientSessionID)
	if clientSessionID == "" {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: client_session_id required")
	}
	// Cheap UUID-ish guard: client_session_id should look like a UUIDv4.
	// We don't enforce strict format (other clients might send slug-ish
	// keys) — just ban obvious typos like single chars.
	if len(clientSessionID) < 8 {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: client_session_id too short")
	}

	// Decode + size check на ДЕКОДИРОВАННОЙ длине — base64 expands by ~33%,
	// 5MB binary cap = ~6.7MB encoded.
	audio, err := base64.StdEncoding.DecodeString(in.AudioBase64)
	if err != nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: bad audio_base64: %w", err)
	}
	if len(audio) == 0 {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: %w", domain.ErrEmptyAudio)
	}
	if len(audio) > domain.MaxSpeakingAudioBytes {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: %w", domain.ErrAudioTooLarge)
	}

	mime := strings.TrimSpace(in.MIMEType)
	if mime == "" {
		mime = "audio/webm"
	}

	// Look up the exercise to get the reference prompt + level. Catalog
	// is fixed; mismatch = client bug.
	ex, err := uc.Exercises.Get(ctx, exerciseID)
	if err != nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: %w", err)
	}

	// Transcribe via Whisper. Hint language=en — shadowing катedex always
	// English. Provider may fail (network / quota) → bubble up as a
	// typed error; handler surfaces 502 if so.
	sttOut, err := uc.STT.Transcribe(ctx, domain.STTInput{
		Audio:    audio,
		MIME:     mime,
		Language: "en",
	})
	if err != nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: stt: %w", err)
	}

	transcript := strings.TrimSpace(sttOut.Text)
	durationMS := in.DurationMS
	if durationMS <= 0 && sttOut.Duration > 0 {
		durationMS = int(sttOut.Duration * 1000)
	}

	// LLM grade — even when transcript is empty (silent recording) we want
	// the floor "say something" feedback rather than zero-score void.
	fb, err := uc.Grader.GradeSpeaking(ctx, domain.SpeakingGraderInput{
		Prompt:     ex.Prompt,
		Transcript: transcript,
		Level:      ex.Level,
		DurationMS: durationMS,
	})
	if err != nil {
		// Floor adapter returns ErrLLMUnavailable; handler maps to 503.
		// Still persist a session row with the transcript so юзер не
		// теряет recording — фон только feedback пуст.
		if errors.Is(err, domain.ErrLLMUnavailable) {
			saved, sErr := uc.Sessions.Insert(ctx, domain.SpeakingSession{
				UserID:          in.UserID,
				ClientSessionID: clientSessionID,
				ExerciseID:      exerciseID,
				Prompt:          ex.Prompt,
				UserTranscript:  transcript,
				DurationMS:      durationMS,
			})
			if sErr != nil {
				return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: persist after llm-fail: %w", sErr)
			}
			return saved, fmt.Errorf("hone.GradeSpeaking: %w", err)
		}
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: grade: %w", err)
	}

	saved, err := uc.Sessions.Insert(ctx, domain.SpeakingSession{
		UserID:             in.UserID,
		ClientSessionID:    clientSessionID,
		ExerciseID:         exerciseID,
		Prompt:             ex.Prompt,
		UserTranscript:     transcript,
		PronunciationScore: fb.PronunciationScore,
		FluencyScore:       fb.FluencyScore,
		CoachFeedback:      fb.CoachFeedback,
		DurationMS:         durationMS,
	})
	if err != nil {
		return domain.SpeakingSession{}, fmt.Errorf("hone.GradeSpeaking: persist: %w", err)
	}
	// Re-attach the WordDiffs onto the returned session — they're not
	// persisted (token-level data isn't queryable, doesn't earn its
	// storage cost), but the handler still surfaces them in the
	// immediate response. Stored as a transient field via closure in the
	// caller's view.
	saved.PronunciationScore = fb.PronunciationScore
	saved.FluencyScore = fb.FluencyScore
	saved.CoachFeedback = fb.CoachFeedback
	return saved, nil
}

// GradeSpeakingResult — what the handler turns into the proto Response.
// Wraps the persisted SpeakingSession + transient WordDiffs (which live
// only in this response, not in the DB row).
type GradeSpeakingResult struct {
	Session   domain.SpeakingSession
	WordDiffs []domain.WordDiff
}

// DoWithDiffs — variant returning both the persisted row AND the
// transient word-diff slice. Separate method (vs adding a return) so
// the existing Do contract stays small for callers that only need the
// row (admin / analytics / batch replay).
func (uc *GradeSpeaking) DoWithDiffs(ctx context.Context, in GradeSpeakingInput) (GradeSpeakingResult, error) {
	if uc.Exercises == nil || uc.Sessions == nil {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: repos not wired")
	}
	if uc.STT == nil {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: stt not wired")
	}
	if uc.Grader == nil {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: grader not wired")
	}
	if in.UserID == uuid.Nil {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: user_id required")
	}
	exerciseID := strings.TrimSpace(in.ExerciseID)
	if exerciseID == "" {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: exercise_id required")
	}
	clientSessionID := strings.TrimSpace(in.ClientSessionID)
	if clientSessionID == "" {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: client_session_id required")
	}
	if len(clientSessionID) < 8 {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: client_session_id too short")
	}

	audio, err := base64.StdEncoding.DecodeString(in.AudioBase64)
	if err != nil {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: bad audio_base64: %w", err)
	}
	if len(audio) == 0 {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: %w", domain.ErrEmptyAudio)
	}
	if len(audio) > domain.MaxSpeakingAudioBytes {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: %w", domain.ErrAudioTooLarge)
	}

	mime := strings.TrimSpace(in.MIMEType)
	if mime == "" {
		mime = "audio/webm"
	}

	ex, err := uc.Exercises.Get(ctx, exerciseID)
	if err != nil {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: %w", err)
	}

	sttOut, err := uc.STT.Transcribe(ctx, domain.STTInput{
		Audio:    audio,
		MIME:     mime,
		Language: "en",
	})
	if err != nil {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: stt: %w", err)
	}

	transcript := strings.TrimSpace(sttOut.Text)
	durationMS := in.DurationMS
	if durationMS <= 0 && sttOut.Duration > 0 {
		durationMS = int(sttOut.Duration * 1000)
	}

	fb, err := uc.Grader.GradeSpeaking(ctx, domain.SpeakingGraderInput{
		Prompt:     ex.Prompt,
		Transcript: transcript,
		Level:      ex.Level,
		DurationMS: durationMS,
	})
	if err != nil {
		if errors.Is(err, domain.ErrLLMUnavailable) {
			saved, sErr := uc.Sessions.Insert(ctx, domain.SpeakingSession{
				UserID:          in.UserID,
				ClientSessionID: clientSessionID,
				ExerciseID:      exerciseID,
				Prompt:          ex.Prompt,
				UserTranscript:  transcript,
				DurationMS:      durationMS,
			})
			if sErr != nil {
				return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: persist after llm-fail: %w", sErr)
			}
			return GradeSpeakingResult{Session: saved}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: %w", err)
		}
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: grade: %w", err)
	}

	saved, err := uc.Sessions.Insert(ctx, domain.SpeakingSession{
		UserID:             in.UserID,
		ClientSessionID:    clientSessionID,
		ExerciseID:         exerciseID,
		Prompt:             ex.Prompt,
		UserTranscript:     transcript,
		PronunciationScore: fb.PronunciationScore,
		FluencyScore:       fb.FluencyScore,
		CoachFeedback:      fb.CoachFeedback,
		DurationMS:         durationMS,
	})
	if err != nil {
		return GradeSpeakingResult{}, fmt.Errorf("hone.GradeSpeaking.DoWithDiffs: persist: %w", err)
	}
	saved.PronunciationScore = fb.PronunciationScore
	saved.FluencyScore = fb.FluencyScore
	saved.CoachFeedback = fb.CoachFeedback
	return GradeSpeakingResult{Session: saved, WordDiffs: fb.WordDiffs}, nil
}

// ─── ListSpeakingHistory ──────────────────────────────────────────────────

type ListSpeakingHistory struct {
	Repo domain.SpeakingSessionRepo
}

type ListSpeakingHistoryInput struct {
	UserID uuid.UUID
	Limit  int
}

// defaultHistoryLimit — 14 covers two-week sparkline window. Server caps
// at 100 to bound payload size.
const defaultHistoryLimit = 14
const maxHistoryLimit = 100

func (uc *ListSpeakingHistory) Do(ctx context.Context, in ListSpeakingHistoryInput) ([]domain.SpeakingSession, error) {
	if in.UserID == uuid.Nil {
		return nil, fmt.Errorf("hone.ListSpeakingHistory: user_id required")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = defaultHistoryLimit
	}
	if limit > maxHistoryLimit {
		limit = maxHistoryLimit
	}
	items, err := uc.Repo.ListByUser(ctx, in.UserID, limit)
	if err != nil {
		return nil, fmt.Errorf("hone.ListSpeakingHistory: %w", err)
	}
	return items, nil
}
