package copilot

import (
	"context"
	"fmt"

	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/pkg/ratelimit"
	subApp "druz9/subscription/app"
	transcriptionApp "druz9/transcription/app"
	transcriptionInfra "druz9/transcription/infra"
	transcriptionPorts "druz9/transcription/ports"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewTranscription wires the transcription bounded context. Returns an
// empty Module when GROQ_API_KEY is unset.
//
// Транскрипция БЕСПЛАТНА для всех тиров (Whisper-large-v3-turbo на Groq
// стоит ~$0.04/час аудио). Tier влияет только на ВЫБОР МОДЕЛИ:
//   - free → whisper-large-v3-turbo (быстрее, базовое качество)
//   - paid → whisper-large-v3 не-turbo (точнее на русском)
//
// Anti-abuse — rate-limiter `transcribeLimitPerMin = 60` в handler'е.
//
// Никаких model fallback chain'ов: один request → одна модель. Если
// Groq fail'ит — 502; caller (audio-mac) ретрайт следующий audio chunk.
func NewTranscription(d monolithServices.Deps) *monolithServices.Module {
	apiKey := d.Cfg.LLMChain.GroqAPIKey
	if apiKey == "" {
		if d.Log != nil {
			d.Log.Info("transcription: disabled (GROQ_API_KEY not set)")
		}
		return &monolithServices.Module{}
	}

	provider := transcriptionInfra.NewGroqProvider(apiKey)
	inner := &transcriptionApp.Transcribe{
		Provider: provider,
		Log:      d.Log,
		Now:      d.Now,
	}

	tiered := &transcriptionApp.TieredTranscribe{
		Inner:  inner,
		Models: transcriptionApp.DefaultModelSelector{},
	}
	if d.QuotaTierGetter != nil {
		tiered.Tiers = &subTierAdapter{getter: d.QuotaTierGetter}
	}

	var limiter *ratelimit.RedisFixedWindow
	if d.Redis != nil {
		limiter = ratelimit.NewRedisFixedWindow(d.Redis)
	}
	h := &transcriptionPorts.Handler{
		Tiered:     tiered,
		Limiter:    limiter,
		KillSwitch: d.KillSwitch,
		Log:        d.Log,
	}

	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			h.Mount(r)
		},
	}
}

// subTierAdapter — мост между subscription.GetTier (возвращает domain.Tier)
// и transcription.TierResolver (хочет string). Type conversion одной
// строкой; держим adapter чтобы transcription pkg не импортировал
// subscription/domain.
type subTierAdapter struct{ getter *subApp.GetTier }

func (a *subTierAdapter) ResolveTier(ctx context.Context, userID uuid.UUID) (string, error) {
	t, err := a.getter.Do(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("subTierAdapter.ResolveTier: %w", err)
	}
	return string(t), nil
}
