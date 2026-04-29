// Package app — TieredTranscribe wraps the bare Transcribe use-case с
// tier-aware model selection. Никаких квот: транскрипция бесплатна для
// всех тиров (Whisper-large-v3-turbo стоит ~$0.04/час, anti-abuse
// держится rate-limiter'ом 60 req/min на handler'е). Tier влияет только
// на качество: free → turbo (быстрее), paid → large-v3 не-turbo
// (точнее на русском технических терминах).
//
// Никакого fallback chain'а: если выбранная для tier'а модель fail'ит
// (network, Groq 5xx) — провайдер возвращает ErrProviderUnavailable
// → handler 502. Caller (audio-mac) ретрайт следующий chunk; нам не
// нужно скрытно подменять модель на «попроще».

package app

import (
	"context"

	"druz9/transcription/domain"

	"github.com/google/uuid"
)

// TierResolver — minimal interface для resolve'а tier'а пользователя.
// Реализуется через `subDeps.QuotaTierGetter.Do(ctx, userID)`.
type TierResolver interface {
	ResolveTier(ctx context.Context, userID uuid.UUID) (string, error)
}

// ModelSelector — выбор Whisper модели для tier'а.
type ModelSelector interface {
	ModelForTier(tier string) string
}

// DefaultModelSelector — production mapping:
//
//	free → whisper-large-v3-turbo (быстрее, базовое качество)
//	pro  → whisper-large-v3 (выше точность для русского/имён)
//	max  → whisper-large-v3 (то же что pro)
//
// Если приедет новый tier — turbo как conservative default (по cost'у).
type DefaultModelSelector struct{}

func (DefaultModelSelector) ModelForTier(tier string) string {
	switch tier {
	case "pro", "max", "seeker", "ascended", "ascendant":
		return "whisper-large-v3"
	default:
		return "whisper-large-v3-turbo"
	}
}

// TieredTranscribe — decorator над Transcribe use-case'ом. Единственная
// логика: выбрать модель по tier'у перед делегированием.
type TieredTranscribe struct {
	Inner  *Transcribe
	Tiers  TierResolver
	Models ModelSelector
}

// Do executes a tier-aware transcription.
//
//   - userID == uuid.Nil → handler bug (auth middleware should populate);
//     пропускаем tier resolve и используем default model.
//   - Tiers / Models == nil → permissive (subscription wiring not loaded);
//     fall through to inner.Do без model override (Groq использует свой
//     default из env GROQ_TRANSCRIPTION_MODEL).
func (t *TieredTranscribe) Do(ctx context.Context, userID uuid.UUID, in domain.TranscribeInput) (domain.TranscribeResult, error) {
	if t.Models != nil && t.Tiers != nil && userID != uuid.Nil {
		tier := "free"
		if resolved, err := t.Tiers.ResolveTier(ctx, userID); err == nil && resolved != "" {
			tier = resolved
		}
		in.Model = t.Models.ModelForTier(tier)
	}
	return t.Inner.Do(ctx, in)
}
