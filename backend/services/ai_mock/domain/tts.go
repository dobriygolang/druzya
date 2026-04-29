package domain

import (
	"context"
	"errors"
)

// TTSClient is the abstract contract the voice port depends on. Lives in
// domain so ports doesn't need to know which TTS engine is wired (Edge,
// future replacements). The concrete adapter in infra picks the engine-
// specific voice based on the (voice, lang) pair.
type TTSClient interface {
	Synth(ctx context.Context, text, voice, lang string) ([]byte, error)
}

// ErrTTSNotImplemented is the sentinel returned when no TTS engine is wired
// (i.e. a stub adapter). The HTTP handler maps it to 501 + X-TTS-Stub so the
// frontend can fall back to window.speechSynthesis.
var ErrTTSNotImplemented = errors.New("tts: not implemented (stub)")
