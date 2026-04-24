package services

import (
	transcriptionApp "druz9/transcription/app"
	transcriptionInfra "druz9/transcription/infra"
	transcriptionPorts "druz9/transcription/ports"

	"github.com/go-chi/chi/v5"
)

// NewTranscription wires the transcription bounded context. Returns an
// empty Module when GROQ_API_KEY is unset — without a key there's no
// usable STT provider, and a handler that always 502's is worse than
// "endpoint doesn't exist".
//
// Groq is the only provider for MVP. Swapping in AssemblyAI / Deepgram
// is a one-line change here once their domain.Provider impl lands.
func NewTranscription(d Deps) *Module {
	apiKey := d.Cfg.LLMChain.GroqAPIKey
	if apiKey == "" {
		if d.Log != nil {
			d.Log.Info("transcription: disabled (GROQ_API_KEY not set)")
		}
		return &Module{}
	}

	provider := transcriptionInfra.NewGroqProvider(apiKey)
	uc := &transcriptionApp.Transcribe{
		Provider: provider,
		Log:      d.Log,
		Now:      d.Now,
	}
	h := &transcriptionPorts.Handler{Transcribe: uc, Log: d.Log}

	return &Module{
		MountREST: func(r chi.Router) {
			h.Mount(r)
		},
	}
}
