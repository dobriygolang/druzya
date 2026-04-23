// Package infra — Edge TTS WebSocket client.
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
//     header length N; bytes [2:2+N] are an ASCII header block
//     (Path:audio …); bytes [2+N:] are the actual MP3 chunk.
//     Append to output buffer.
//     - Text frame `Path:turn.end`     → done; close connection.
//
//  4. Concatenate every binary chunk's audio body → final MP3.
package infra

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// EdgeVoice enumerates the supported Edge "Neural" voices.
type EdgeVoice string

const (
	EdgeVoiceRUDmitry   EdgeVoice = "ru-RU-DmitryNeural"
	EdgeVoiceRUSvetlana EdgeVoice = "ru-RU-SvetlanaNeural"
	EdgeVoiceENGuy      EdgeVoice = "en-US-GuyNeural"
	EdgeVoiceENJenny    EdgeVoice = "en-US-JennyNeural"
)

// edgeTTSEndpoint is the public Microsoft Edge readaloud endpoint. Exposed
// as a var (not const) so tests can point a local httptest server at it.
var edgeTTSEndpoint = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4"

// ErrEdgeTTSNotImplemented is preserved so the HTTP handler's existing
// fallback branch (501 + X-Edge-TTS-Stub) can still be triggered by callers
// that intentionally want the browser-fallback path (e.g. ops disabling the
// upstream by wiring StubEdgeTTSClient).
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
type EdgeTTSClient interface {
	Synth(ctx context.Context, text string, voice EdgeVoice) ([]byte, error)
}

// StubEdgeTTSClient always returns ErrEdgeTTSNotImplemented. Useful for
// dev environments where the operator intentionally wants the
// frontend's window.speechSynthesis fallback.
type StubEdgeTTSClient struct{}

// Synth implements EdgeTTSClient.
func (StubEdgeTTSClient) Synth(_ context.Context, _ string, _ EdgeVoice) ([]byte, error) {
	return nil, ErrEdgeTTSNotImplemented
}

// EdgeTTSClientImpl is the real WebSocket client that talks to Bing's
// readaloud endpoint and returns a single MP3 blob.
type EdgeTTSClientImpl struct {
	Endpoint string
	Dialer   *websocket.Dialer
	Timeout  time.Duration
}

// NewEdgeTTSClient constructs the real client. timeout==0 → 10s default.
func NewEdgeTTSClient(timeout time.Duration) *EdgeTTSClientImpl {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &EdgeTTSClientImpl{
		Endpoint: edgeTTSEndpoint,
		Dialer: &websocket.Dialer{
			HandshakeTimeout: timeout,
		},
		Timeout: timeout,
	}
}

// Synth dials the Edge endpoint, sends the speech.config + ssml frames,
// then collects every binary frame's audio payload until it sees a
// `Path:turn.end` text frame. Returns the concatenated MP3 bytes.
func (c *EdgeTTSClientImpl) Synth(ctx context.Context, text string, voice EdgeVoice) ([]byte, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, errors.New("edge_tts: empty text")
	}
	if voice == "" {
		voice = EdgeVoiceRUDmitry
	}

	// Apply our own deadline on top of whatever the caller passed in.
	dialCtx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()

	header := http.Header{}
	header.Set("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
	header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")

	endpoint, err := requestEndpoint(c.Endpoint)
	if err != nil {
		return nil, err
	}

	conn, resp, err := c.Dialer.DialContext(dialCtx, endpoint, header)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		return nil, fmt.Errorf("edge_tts: dial: %w", err)
	}
	defer conn.Close()

	// Hard deadline for the entire synth operation.
	deadline := time.Now().Add(c.Timeout)
	_ = conn.SetReadDeadline(deadline)
	_ = conn.SetWriteDeadline(deadline)

	requestID, err := newRequestID()
	if err != nil {
		return nil, err
	}

	// Frame 1: speech.config
	if err := conn.WriteMessage(websocket.TextMessage, []byte(speechConfigFrame())); err != nil {
		return nil, fmt.Errorf("edge_tts: write config: %w", err)
	}

	// Frame 2: SSML
	ssml := buildSSMLFrame(requestID, voice, text)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(ssml)); err != nil {
		return nil, fmt.Errorf("edge_tts: write ssml: %w", err)
	}

	// Read loop. We accept text frames (turn.start, audio.metadata,
	// turn.end) and binary frames (audio chunks). turn.end ends.
	var audio bytes.Buffer
	for {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("edge_tts: context: %w", err)
		}
		mt, payload, err := conn.ReadMessage()
		if err != nil {
			// Premature close before turn.end is an error.
			return nil, fmt.Errorf("edge_tts: read: %w", err)
		}
		switch mt {
		case websocket.TextMessage:
			if isTurnEnd(payload) {
				if audio.Len() == 0 {
					return nil, errors.New("edge_tts: empty audio buffer at turn.end")
				}
				return audio.Bytes(), nil
			}
			// turn.start, response, audio.metadata — drop.
		case websocket.BinaryMessage:
			chunk, perr := parseBinaryFrame(payload)
			if perr != nil {
				return nil, perr
			}
			audio.Write(chunk)
		default:
			// ping/close — ignore; gorilla handles them upstream.
		}
	}
}

// parseBinaryFrame extracts the MP3 body from a binary frame:
//
//	[2 bytes BE uint16 = headerLen][headerLen bytes ASCII header][... body]
//
// The header block lists Path:audio etc.; we ignore it and just return
// the body bytes. Returns an error on malformed frames.
func parseBinaryFrame(payload []byte) ([]byte, error) {
	if len(payload) < 2 {
		return nil, fmt.Errorf("edge_tts: binary frame too short (%d bytes)", len(payload))
	}
	headerLen := int(binary.BigEndian.Uint16(payload[:2]))
	if 2+headerLen > len(payload) {
		return nil, fmt.Errorf("edge_tts: binary frame header (%d) exceeds payload (%d)", headerLen, len(payload))
	}
	body := payload[2+headerLen:]
	return body, nil
}

// isTurnEnd inspects a text frame's headers and returns true if Path:turn.end.
func isTurnEnd(payload []byte) bool {
	// Headers come as `Key:value\r\n` lines, terminated by `\r\n\r\n`.
	idx := bytes.Index(payload, []byte("\r\n\r\n"))
	headers := payload
	if idx >= 0 {
		headers = payload[:idx]
	}
	return bytes.Contains(headers, []byte("Path:turn.end"))
}

// requestEndpoint returns the WSS URL with a fresh ConnectionId query
// parameter — Microsoft requires a UUID-style ConnectionId per dial.
func requestEndpoint(base string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("edge_tts: parse endpoint: %w", err)
	}
	id, err := newRequestID()
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("ConnectionId", id)
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// newRequestID returns a 32-char hex string (no dashes) per Microsoft's
// X-RequestId convention.
func newRequestID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("edge_tts: request id: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

func speechConfigFrame() string {
	ts := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	body := `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":false,"wordBoundaryEnabled":false},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
	return fmt.Sprintf("X-Timestamp:%s\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n%s", ts, body)
}

// buildSSMLFrame returns the second text frame: SSML payload preceded by
// the X-RequestId / X-Timestamp / Path / Content-Type headers.
func buildSSMLFrame(requestID string, voice EdgeVoice, text string) string {
	ts := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	lang := strings.SplitN(string(voice), "-", 3)
	xmlLang := "ru-RU"
	if len(lang) >= 2 {
		xmlLang = lang[0] + "-" + lang[1]
	}
	ssml := fmt.Sprintf(
		`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='%s'><voice name='%s'><prosody pitch='+0Hz' rate='+0%%' volume='+0%%'>%s</prosody></voice></speak>`,
		xmlLang, voice, escapeSSML(text),
	)
	return fmt.Sprintf("X-RequestId:%s\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:%s\r\nPath:ssml\r\n\r\n%s", requestID, ts, ssml)
}

// escapeSSML escapes the five XML special characters so the user-supplied
// text can't break out of <prosody>.
func escapeSSML(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}
