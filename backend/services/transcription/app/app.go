// Package app — transcription use-cases. One thin use-case for now;
// leaving the package in place so we can grow into "live session
// transcription" later without touching handler wiring.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/transcription/domain"
)

// hallucinationPhrases — известные Whisper-галлюцинации на silent /
// near-silent аудио. Whisper-large-v3 на русском (и всех языках) train'нут
// на YouTube subs, где такие "сабы делал X" / "спасибо за внимание"
// постоянно встречаются как outro — модель учила, что после долгой
// тишины нужно «закрыть видео». Blocklist — pragmatic filter: проще
// чем VAD-pre-filter и не требует backend-side audio analysis.
//
// Источники: https://github.com/openai/whisper/discussions/679,
// https://github.com/SYSTRAN/faster-whisper/issues/156, личные тесты.
var hallucinationPhrases = []string{
	// Russian
	"субтитры делал dimatorzok",
	"субтитры создавал dimatorzok",
	"субтитры подготовил dimatorzok",
	"dimatorzok",
	"продолжение следует",
	"спасибо за внимание",
	"спасибо за просмотр",
	"подписывайтесь на канал",
	"ставьте лайк",
	"всем пока",
	"до новых встреч",
	"редактор субтитров",
	"корректор",
	"субтитры сделал",
	// English
	"thanks for watching",
	"please subscribe",
	"like and subscribe",
	"see you next time",
	"don't forget to subscribe",
	"hit the bell icon",
}

// isHallucination возвращает true если текст — почти целиком одна из
// известных галлюцинаций. Сравниваем нормализованную lower-case строку
// без пунктуации и multispace'ов; если совпадение покрывает ≥70%
// текста — фильтруем (даёт terпимость к мелким префиксам типа «...
// субтитры делал DimaTorzok»).
func isHallucination(text string) bool {
	norm := strings.ToLower(text)
	norm = strings.NewReplacer(
		".", "", ",", "", "!", "", "?", "", ":", "", ";", "", "—", "", "-", "",
		"\"", "", "'", "", "(", "", ")", "",
	).Replace(norm)
	norm = strings.Join(strings.Fields(norm), " ")
	if norm == "" {
		return false
	}
	for _, p := range hallucinationPhrases {
		if strings.Contains(norm, p) {
			// Если phrase покрывает большинство текста — гарантированно
			// hallucination. Иначе короткая фраза-затравка которая
			// могла случайно совпасть → не фильтруем.
			if float64(len(p))/float64(len(norm)) >= 0.6 {
				return true
			}
		}
	}
	return false
}

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
	// Hallucination filter — Whisper на silent/near-silent чанках
	// возвращает классику «Субтитры делал DimaTorzok» / «Спасибо за
	// внимание». Это reproducible и фильтруемо строкой.
	if isHallucination(res.Text) {
		if uc.Log != nil {
			uc.Log.InfoContext(ctx, "transcription: hallucination dropped",
				slog.String("provider", uc.Provider.Name()),
				slog.Int("audio_bytes", len(in.Audio)),
				slog.String("dropped_text", res.Text))
		}
		// Возвращаем пустой результат — вызвавший (audio-mac chunk loop)
		// уже фильтрует empty text перед публикацией в renderer.
		return domain.TranscribeResult{Language: res.Language, Duration: res.Duration}, nil
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
