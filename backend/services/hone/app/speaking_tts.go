// Package app — admin-only TTS regen UC for Speaking exercises.
//
// Replaces client-side `window.speechSynthesis` fallback for Speaking
// reference audio. Flow:
//
//  1. Lookup speaking_exercises row (prompt + existing audio_url).
//  2. If audio_url already set and `force=false` → skip (return current).
//  3. Synthesize via configured TTS provider (Cloudflare MeloTTS default).
//  4. Upload bytes to MinIO bucket `tts-audio` под key
//     `speaking/<exercise_id>.mp3`.
//  5. Presign GET URL (7-day TTL) → persist в speaking_exercises.audio_url.
//  6. Return the new URL.
//
// Side-effect: previous audio_url overwritten (object is replaced, same
// key). Каскадных подписок нет; client следующий List вернёт fresh URL.
//
// Errors:
//   - ErrNotFound from repo Get → 404.
//   - tts.ErrUnavailable (provider not configured) → caller maps to 503.
//   - other provider/storage errors → 502.
package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/hone/domain"
	"druz9/shared/pkg/tts"
)

// PresignTTL — how long the audio_url URL stays valid. 7d matches MinIO
// hard ceiling. Audio bytes don't change frequently — admin re-generate
// is explicit click, не cron.
const PresignTTL = 7 * 24 * time.Hour

// GenerateSpeakingTTS — admin use case. Fields all required:
//   - Exercises: repo to read/update speaking_exercises row.
//   - Provider: TTS driver (may be Unconfigured → ErrUnavailable).
//   - Store: MinIO AudioStore (may be unconfigured → returns error
//     pointing к "MINIO_* not set").
type GenerateSpeakingTTS struct {
	Exercises domain.SpeakingExerciseRepo
	Provider  tts.Provider
	Store     tts.AudioStore
}

// GenerateSpeakingTTSInput — admin-only payload.
type GenerateSpeakingTTSInput struct {
	ExerciseID string
	Force      bool // overwrite existing audio_url
	// Voice + Lang оптимизны; defaults handled inside provider.
	Voice string
	Lang  string
}

// GenerateSpeakingTTSResult — returned URL ready for frontend cache.
type GenerateSpeakingTTSResult struct {
	AudioURL string
}

// Do orchestrates the synthesize → upload → DB-update flow.
func (uc *GenerateSpeakingTTS) Do(ctx context.Context, in GenerateSpeakingTTSInput) (GenerateSpeakingTTSResult, error) {
	if uc == nil || uc.Exercises == nil {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: repo not wired")
	}
	if uc.Provider == nil {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: %w", tts.ErrUnavailable)
	}
	if uc.Store == nil {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: storage not wired")
	}
	exerciseID := strings.TrimSpace(in.ExerciseID)
	if exerciseID == "" {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: exercise_id required")
	}

	ex, err := uc.Exercises.Get(ctx, exerciseID)
	if err != nil {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: %w", err)
	}

	// Idempotent skip: existing URL still works → keep it. Force=true
	// always regen'ит (admin clicks "Re-generate").
	if !in.Force && strings.TrimSpace(ex.AudioURL) != "" {
		return GenerateSpeakingTTSResult{AudioURL: ex.AudioURL}, nil
	}

	prompt := strings.TrimSpace(ex.Prompt)
	if prompt == "" {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: exercise %q has empty prompt", exerciseID)
	}

	out, err := uc.Provider.Synthesize(ctx, tts.SynthesizeInput{
		Text:  prompt,
		Voice: in.Voice,
		Lang:  in.Lang,
	})
	if err != nil {
		// Surface ErrUnavailable verbatim — handler maps to 503.
		if errors.Is(err, tts.ErrUnavailable) {
			return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: %w", err)
		}
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: synth: %w", err)
	}
	if len(out.Audio) == 0 {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: provider returned empty audio")
	}

	ext := out.Ext
	if ext == "" {
		ext = ".mp3"
	}
	objectKey := fmt.Sprintf("speaking/%s%s", exerciseID, ext)
	if _, err := uc.Store.Put(ctx, objectKey, out.Audio, out.ContentType); err != nil {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: upload: %w", err)
	}

	signed, err := uc.Store.PresignGet(ctx, objectKey, PresignTTL)
	if err != nil {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: presign: %w", err)
	}

	if err := uc.Exercises.UpdateAudioURL(ctx, exerciseID, signed); err != nil {
		return GenerateSpeakingTTSResult{}, fmt.Errorf("hone.GenerateSpeakingTTS: persist: %w", err)
	}
	return GenerateSpeakingTTSResult{AudioURL: signed}, nil
}
