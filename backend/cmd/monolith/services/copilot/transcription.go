package copilot

import (
	"context"
	"fmt"
	"os"

	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"
	"druz9/shared/pkg/ratelimit"
	subApp "druz9/subscription/app"
	transcriptionApp "druz9/transcription/app"
	transcriptionDomain "druz9/transcription/domain"
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
//
// WS streaming endpoint `/ws/transcription/stream`.
// Реализация: handler аккумулирует BinaryMessage'ы (PCM16 16kHz mono)
// в окно 1-2s и дёргает StreamingTranscriber. Default impl — GroqWhisperBatch
// (WAV-wrap + batch /audio/transcriptions). Future: Deepgram / AssemblyAI
// streaming behind же интерфейсу. Selection through env STREAMING_TRANSCRIBER
// (default "groq").
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

	// StreamingTranscriber selection. Только "groq" реализован для MVP;
	// будущие impl (deepgram/assemblyai) добавляются в `pickStreamingTranscriber`
	// и читают свой API key из env. fallback на groq при unknown value
	// чтобы typo не убивал всю фичу.
	streaming := pickStreamingTranscriber(provider)
	if d.Log != nil {
		d.Log.Info("transcription: streaming enabled",
			"impl", streaming.Name(),
			"env", os.Getenv("STREAMING_TRANSCRIBER"))
	}

	wsHandler := transcriptionPorts.NewStreamHandler(
		tiered,
		streaming,
		authServices.TranscriptionTokenVerifier{Issuer: d.TokenIssuer},
		limiter,
		d.KillSwitch,
		d.Log,
	)

	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			h.Mount(r)
		},
		MountWS: func(ws chi.Router) {
			// /ws префикс уже подмонтирован роутером (см.
			// bootstrap/router.go) — здесь регистрируем only suffix.
			ws.Get("/transcription/stream", wsHandler.Handle)
		},
	}
}

// pickStreamingTranscriber — env-driven selection. Default groq.
//
//	STREAMING_TRANSCRIBER=groq      (default) — GroqWhisperBatch
//	STREAMING_TRANSCRIBER=deepgram   — RESERVED, paid; falls back to groq.
//	STREAMING_TRANSCRIBER=assemblyai — RESERVED, paid; falls back to groq.
//
// Свободные провайдеры на 2026-05 (groq/cerebras/mistral) не имеют
// native streaming WS — все batch. Поэтому единственный legit choice
// для free-tier — groq-batch с WAV-wrap, а alt-impl будут paid и
// activate'нутся только когда `groq-batch` окажется недостаточным
// для интерактивного UX (а сейчас он fine: <800ms на 2s окно).
func pickStreamingTranscriber(provider transcriptionDomain.Provider) transcriptionDomain.StreamingTranscriber {
	choice := os.Getenv("STREAMING_TRANSCRIBER")
	switch choice {
	case "", "groq", "groq-batch":
		return transcriptionInfra.NewGroqWhisperBatch(provider)
	default:
		// Unknown / future impl — degrade to groq так же как auto.
		return transcriptionInfra.NewGroqWhisperBatch(provider)
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
