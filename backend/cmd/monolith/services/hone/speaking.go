// speaking.go — Phase J / H4 (P1) Speaking modality wiring.
//
// Cross-context wiring: hone-side use cases consume an STT interface
// (hone/domain.SpeakingSTT) — the concrete adapter wraps the existing
// transcription Provider (Groq Whisper). Service-to-service import
// happens HERE in monolith bootstrap (allowed); hone package never
// imports transcription.
package hone

import (
	"context"
	"fmt"

	monolithServices "druz9/cmd/monolith/services"
	honeDomain "druz9/hone/domain"
	transcriptionDomain "druz9/transcription/domain"
	transcriptionInfra "druz9/transcription/infra"
)

// transcriptionSpeakingSTT adapts transcriptionDomain.Provider to
// honeDomain.SpeakingSTT — translates input/output structs across the
// boundary. Lives here (not в hone-infra) so hone doesn't import
// transcription package.
type transcriptionSpeakingSTT struct {
	provider transcriptionDomain.Provider
}

func (a *transcriptionSpeakingSTT) Transcribe(ctx context.Context, in honeDomain.STTInput) (honeDomain.STTResult, error) {
	if len(in.Audio) == 0 {
		return honeDomain.STTResult{}, fmt.Errorf("hone-speaking-stt: empty audio")
	}
	res, err := a.provider.Transcribe(ctx, transcriptionDomain.TranscribeInput{
		Audio:    in.Audio,
		Filename: speakingFilenameForMIME(in.MIME),
		MIME:     in.MIME,
		Language: in.Language,
	})
	if err != nil {
		return honeDomain.STTResult{}, fmt.Errorf("hone-speaking-stt: %w", err)
	}
	return honeDomain.STTResult{
		Text:     res.Text,
		Duration: res.Duration,
	}, nil
}

func speakingFilenameForMIME(mime string) string {
	switch mime {
	case "audio/webm":
		return "speaking.webm"
	case "audio/ogg":
		return "speaking.ogg"
	case "audio/mp4", "audio/m4a":
		return "speaking.m4a"
	case "audio/mpeg":
		return "speaking.mp3"
	case "audio/wav", "audio/wave", "audio/x-wav":
		return "speaking.wav"
	default:
		return "speaking.webm"
	}
}

// buildSpeakingSTT returns the appropriate adapter for the current
// environment. Real Groq provider when GROQ_API_KEY is set; otherwise
// caller falls back to the floor adapter (honeInfra.NewNoSpeakingSTT)
// — handled in hone.go itself, this helper only builds the REAL one.
//
// nil result + nil error = "no API key, use floor adapter".
func buildSpeakingSTT(d monolithServices.Deps) honeDomain.SpeakingSTT {
	apiKey := d.Cfg.LLMChain.GroqAPIKey
	if apiKey == "" {
		return nil
	}
	provider := transcriptionInfra.NewGroqProvider(apiKey)
	return &transcriptionSpeakingSTT{provider: provider}
}
