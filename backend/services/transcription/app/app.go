// Package app — transcription use-cases. One thin use-case for now;
// leaving the package in place so we can grow into "live session
// transcription" later without touching handler wiring.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/transcription/domain"
)

// Transcribe — single call → transcript. Delegates to the configured
// Provider. The extra layer looks redundant with one impl but is the
// right shape for: (1) future caching (repeat audio hash → cached
// result), (2) quota accounting (STT minutes billing), (3) fan-out
// to multiple providers for reliability. None of these are wired yet,
// but the contract is stable.
type Transcribe struct {
	Provider domain.Provider
	Log      *slog.Logger
	Now      func() time.Time
}

// Do validates bounds and invokes the provider. Returns domain errors
// unchanged so handlers can map to HTTP codes.
func (uc *Transcribe) Do(ctx context.Context, in domain.TranscribeInput) (domain.TranscribeResult, error) {
	if len(in.Audio) == 0 {
		return domain.TranscribeResult{}, domain.ErrEmptyAudio
	}
	if len(in.Audio) > domain.MaxAudioBytes {
		return domain.TranscribeResult{}, domain.ErrTooLarge
	}

	started := time.Now()
	if uc.Now != nil {
		started = uc.Now()
	}

	res, err := uc.Provider.Transcribe(ctx, in)
	if err != nil {
		if uc.Log != nil {
			uc.Log.WarnContext(ctx, "transcription: provider failed",
				slog.String("provider", uc.Provider.Name()),
				slog.Int("audio_bytes", len(in.Audio)),
				slog.Any("err", err))
		}
		return domain.TranscribeResult{}, fmt.Errorf("transcription.Transcribe.Do: %w", err)
	}
	if uc.Log != nil {
		uc.Log.InfoContext(ctx, "transcription: ok",
			slog.String("provider", uc.Provider.Name()),
			slog.Int("audio_bytes", len(in.Audio)),
			slog.Int("text_bytes", len(res.Text)),
			slog.Float64("audio_seconds", res.Duration),
			slog.Duration("wall_time", time.Since(started)))
	}
	return res, nil
}
