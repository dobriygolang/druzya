// Package infra — Edge TTS WebSocket client (STUB).
//
// Microsoft Edge's "Read Aloud" service exposes a free, undocumented WSS
// endpoint at:
//
//	wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
//	  ?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4
//
// Connecting + getting audio back is a multi-message dance:
//
//  1. Open WSS with these headers (case matters):
//     Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold
//     User-Agent: Mozilla/5.0 ... Edg/...
//     Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits
//
//  2. Send TWO text frames:
//
//     a) Speech config (sets audio format):
//     ```
//     X-Timestamp:<RFC3339Nano>
//     Content-Type:application/json; charset=utf-8
//     Path:speech.config
//
//     {"context":{"synthesis":{"audio":{"metadataoptions":{
//     "sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},
//     "outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}
//     ```
//
//     b) SSML (the actual text + voice selection):
//     ```
//     X-RequestId:<32-char-hex, no dashes>
//     Content-Type:application/ssml+xml
//     X-Timestamp:<RFC3339Nano>
//     Path:ssml
//
//     <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis'
//     xml:lang='ru-RU'>
//     <voice name='ru-RU-DmitryNeural'>
//     <prosody pitch='+0Hz' rate='+0%' volume='+0%'>TEXT</prosody>
//     </voice>
//     </speak>
//     ```
//
//  3. Read frames in a loop:
//     - Text frame `Path:turn.start`   → ack, ignore.
//     - Text frame `Path:audio.metadata` → ignore (timing markers).
//     - Binary frame                   → first 2 bytes are big-endian
//     header length N; bytes [2:2+N]
//     are an ASCII header block
//     (Path:audio …); bytes [2+N:]
//     are the actual MP3 chunk.
//     Append to output buffer.
//     - Text frame `Path:turn.end`     → done; close connection.
//
//  4. Concatenate every binary chunk's audio body → final MP3.
//
// Voices we want to support:
//   - ru-RU-DmitryNeural   (premium-male RU)
//   - ru-RU-SvetlanaNeural (premium-female RU)
//   - en-US-GuyNeural      (premium-male EN)
//   - en-US-JennyNeural    (premium-female EN)
//
// STATUS: STUB. The full WS implementation requires:
//   - gorilla/websocket (already in go.mod) — connect with custom headers
//   - the binary-frame parser (the 2-byte header-length prefix above)
//   - retry/backoff for 429 throttling
//   - request id pooling (Microsoft rate-limits per X-RequestId reuse)
//
// Synth() therefore returns ErrEdgeTTSNotImplemented; the HTTP handler
// translates that to 501 with header `X-Edge-TTS-Stub: true` so the
// frontend gracefully falls back to the browser voice.
package infra

import (
	"context"
	"errors"
)

// EdgeVoice enumerates the supported Edge "Neural" voices.
type EdgeVoice string

const (
	EdgeVoiceRUDmitry   EdgeVoice = "ru-RU-DmitryNeural"
	EdgeVoiceRUSvetlana EdgeVoice = "ru-RU-SvetlanaNeural"
	EdgeVoiceENGuy      EdgeVoice = "en-US-GuyNeural"
	EdgeVoiceENJenny    EdgeVoice = "en-US-JennyNeural"
)

// ErrEdgeTTSNotImplemented signals that the WS protocol is not yet wired.
// Handlers return 501 with header X-Edge-TTS-Stub: true on this error.
var ErrEdgeTTSNotImplemented = errors.New("edge_tts: WS protocol not implemented (stub)")

// PickEdgeVoice maps the abstract (voice, lang) pair the API exposes to
// the concrete Edge voice name.
//
//	voice in {"premium-male", "premium-female"}; lang in {"ru-RU","en-US"}.
func PickEdgeVoice(voice, lang string) EdgeVoice {
	switch lang {
	case "en-US":
		if voice == "premium-female" {
			return EdgeVoiceENJenny
		}
		return EdgeVoiceENGuy
	default: // ru-RU
		if voice == "premium-female" {
			return EdgeVoiceRUSvetlana
		}
		return EdgeVoiceRUDmitry
	}
}

// EdgeTTSClient is the minimal contract the HTTP handler depends on.
// A future real client (RealEdgeTTSClient) will satisfy the same shape so
// switching is a one-line change in main.go.
type EdgeTTSClient interface {
	Synth(ctx context.Context, text string, voice EdgeVoice) ([]byte, error)
}

// StubEdgeTTSClient always returns ErrEdgeTTSNotImplemented. Wired by
// default; replace in main.go when the full WS impl lands.
type StubEdgeTTSClient struct{}

// Synth implements EdgeTTSClient.
func (StubEdgeTTSClient) Synth(_ context.Context, _ string, _ EdgeVoice) ([]byte, error) {
	return nil, ErrEdgeTTSNotImplemented
}
