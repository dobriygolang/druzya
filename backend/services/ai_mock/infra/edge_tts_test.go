package infra

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// helper — start an httptest server hosting an upgrader with the given
// per-connection handler and return its ws:// URL plus a shutdown fn.
func startWSServer(t *testing.T, handler func(c *websocket.Conn)) (string, func()) {
	t.Helper()
	upgrader := websocket.Upgrader{
		CheckOrigin: func(*http.Request) bool { return true },
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("upgrade: %v", err)
			return
		}
		defer conn.Close()
		handler(conn)
	}))
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/?TrustedClientToken=test"
	return wsURL, srv.Close
}

// makeBinaryAudioFrame builds a binary frame in Microsoft's wire format:
//
//	[BE uint16 headerLen][header bytes][payload bytes]
func makeBinaryAudioFrame(t *testing.T, header, body []byte) []byte {
	t.Helper()
	if len(header) > 0xFFFF {
		t.Fatalf("test header too long")
	}
	out := make([]byte, 2+len(header)+len(body))
	binary.BigEndian.PutUint16(out[:2], uint16(len(header)))
	copy(out[2:], header)
	copy(out[2+len(header):], body)
	return out
}

func TestEdgeTTSClient_HappyPath(t *testing.T) {
	wsURL, shutdown := startWSServer(t, func(c *websocket.Conn) {
		// Read 2 frames (config + ssml), ignore content.
		for i := 0; i < 2; i++ {
			if _, _, err := c.ReadMessage(); err != nil {
				t.Logf("server read %d: %v", i, err)
				return
			}
		}
		// Send turn.start (text).
		_ = c.WriteMessage(websocket.TextMessage, []byte("Path:turn.start\r\n\r\n{}"))
		// Send 2 audio chunks.
		hdr := []byte("Path:audio\r\nContent-Type:audio/mpeg\r\n")
		_ = c.WriteMessage(websocket.BinaryMessage, makeBinaryAudioFrame(t, hdr, []byte("MP3-CHUNK-1")))
		_ = c.WriteMessage(websocket.BinaryMessage, makeBinaryAudioFrame(t, hdr, []byte("MP3-CHUNK-2")))
		// Send turn.end (text).
		_ = c.WriteMessage(websocket.TextMessage, []byte("Path:turn.end\r\n\r\n{}"))
	})
	defer shutdown()

	c := NewEdgeTTSClient(2 * time.Second)
	c.Endpoint = wsURL

	got, err := c.Synth(context.Background(), "привет", EdgeVoiceRUDmitry)
	if err != nil {
		t.Fatalf("Synth: %v", err)
	}
	want := []byte("MP3-CHUNK-1MP3-CHUNK-2")
	if !bytes.Equal(got, want) {
		t.Errorf("audio mismatch\nwant: %q\ngot:  %q", want, got)
	}
}

func TestEdgeTTSClient_Timeout(t *testing.T) {
	// Server accepts the upgrade but never replies — the client should
	// hit its own deadline.
	wsURL, shutdown := startWSServer(t, func(c *websocket.Conn) {
		// Just block until the client closes.
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	})
	defer shutdown()

	c := NewEdgeTTSClient(150 * time.Millisecond)
	c.Endpoint = wsURL

	start := time.Now()
	_, err := c.Synth(context.Background(), "test", EdgeVoiceRUDmitry)
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("timeout took too long: %v", elapsed)
	}
}

func TestEdgeTTSClient_MalformedBinaryFrame(t *testing.T) {
	wsURL, shutdown := startWSServer(t, func(c *websocket.Conn) {
		for i := 0; i < 2; i++ {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
		// Header length claims 999 bytes but the frame is only 5 bytes total.
		bad := []byte{0x03, 0xE7, 0x01, 0x02, 0x03}
		_ = c.WriteMessage(websocket.BinaryMessage, bad)
	})
	defer shutdown()

	c := NewEdgeTTSClient(1 * time.Second)
	c.Endpoint = wsURL

	_, err := c.Synth(context.Background(), "test", EdgeVoiceRUDmitry)
	if err == nil {
		t.Fatal("expected error on malformed frame, got nil")
	}
	if !strings.Contains(err.Error(), "exceeds payload") {
		t.Errorf("expected 'exceeds payload' error, got: %v", err)
	}
}

func TestEdgeTTSClient_PrematureClose(t *testing.T) {
	wsURL, shutdown := startWSServer(t, func(c *websocket.Conn) {
		// Read one frame then bail.
		_, _, _ = c.ReadMessage()
		_ = c.Close()
	})
	defer shutdown()

	c := NewEdgeTTSClient(1 * time.Second)
	c.Endpoint = wsURL

	_, err := c.Synth(context.Background(), "test", EdgeVoiceRUDmitry)
	if err == nil {
		t.Fatal("expected error on premature close, got nil")
	}
}

func TestEdgeTTSClient_EmptyAudioAtTurnEnd(t *testing.T) {
	wsURL, shutdown := startWSServer(t, func(c *websocket.Conn) {
		for i := 0; i < 2; i++ {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
		// Send turn.end without any audio binary frames.
		_ = c.WriteMessage(websocket.TextMessage, []byte("Path:turn.end\r\n\r\n{}"))
	})
	defer shutdown()

	c := NewEdgeTTSClient(1 * time.Second)
	c.Endpoint = wsURL

	_, err := c.Synth(context.Background(), "test", EdgeVoiceRUDmitry)
	if err == nil {
		t.Fatal("expected empty-audio error, got nil")
	}
}

func TestEdgeTTSClient_EmptyText(t *testing.T) {
	c := NewEdgeTTSClient(1 * time.Second)
	_, err := c.Synth(context.Background(), "   ", EdgeVoiceRUDmitry)
	if err == nil || !strings.Contains(err.Error(), "empty text") {
		t.Errorf("expected empty text error, got: %v", err)
	}
}

func TestEdgeTTSClient_DialFailure(t *testing.T) {
	c := NewEdgeTTSClient(200 * time.Millisecond)
	// Point at a non-listening port.
	c.Endpoint = "ws://127.0.0.1:1/?TrustedClientToken=test"
	_, err := c.Synth(context.Background(), "hi", EdgeVoiceRUDmitry)
	if err == nil {
		t.Fatal("expected dial error, got nil")
	}
	if !strings.Contains(err.Error(), "dial") {
		t.Errorf("expected dial error, got: %v", err)
	}
}

func TestEdgeTTSClient_ContextCancelled(t *testing.T) {
	wsURL, shutdown := startWSServer(t, func(c *websocket.Conn) {
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	})
	defer shutdown()

	c := NewEdgeTTSClient(2 * time.Second)
	c.Endpoint = wsURL

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := c.Synth(ctx, "hi", EdgeVoiceRUDmitry)
	if err == nil {
		t.Fatal("expected error on cancelled context, got nil")
	}
}

func TestStubEdgeTTSClient(t *testing.T) {
	_, err := StubEdgeTTSClient{}.Synth(context.Background(), "x", EdgeVoiceRUDmitry)
	if !errors.Is(err, ErrEdgeTTSNotImplemented) {
		t.Errorf("expected ErrEdgeTTSNotImplemented, got: %v", err)
	}
}

func TestPickEdgeVoice(t *testing.T) {
	tests := []struct {
		voice, lang string
		want        EdgeVoice
	}{
		{"premium-male", "ru-RU", EdgeVoiceRUDmitry},
		{"premium-female", "ru-RU", EdgeVoiceRUSvetlana},
		{"premium-male", "en-US", EdgeVoiceENGuy},
		{"premium-female", "en-US", EdgeVoiceENJenny},
		{"unknown", "", EdgeVoiceRUDmitry}, // default lang ru-RU
	}
	for _, tc := range tests {
		got := PickEdgeVoice(tc.voice, tc.lang)
		if got != tc.want {
			t.Errorf("PickEdgeVoice(%q,%q) = %v, want %v", tc.voice, tc.lang, got, tc.want)
		}
	}
}

func TestParseBinaryFrame(t *testing.T) {
	hdr := []byte("Path:audio\r\n")
	body := []byte("MP3DATA")
	frame := makeBinaryAudioFrame(t, hdr, body)
	got, err := parseBinaryFrame(frame)
	if err != nil {
		t.Fatalf("parseBinaryFrame: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Errorf("body mismatch: want %q got %q", body, got)
	}

	// Too short.
	if _, err := parseBinaryFrame([]byte{0x00}); err == nil {
		t.Error("expected error on 1-byte frame")
	}
}

func TestSpeechConfigFrame(t *testing.T) {
	got := speechConfigFrame()
	for _, want := range []string{
		"Path:speech.config",
		"Content-Type:application/json",
		"X-Timestamp:",
		"audio-24khz-48kbitrate-mono-mp3",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("speechConfigFrame missing %q", want)
		}
	}
}

func TestBuildSSMLFrame_EscapesText(t *testing.T) {
	got := buildSSMLFrame("abc123", EdgeVoiceRUDmitry, "<script>&\"'")
	if !strings.Contains(got, "&lt;script&gt;&amp;&quot;&apos;") {
		t.Errorf("SSML escape failed; got: %s", got)
	}
	if !strings.Contains(got, "X-RequestId:abc123") {
		t.Errorf("missing X-RequestId; got: %s", got)
	}
	if !strings.Contains(got, "Path:ssml") {
		t.Errorf("missing Path:ssml; got: %s", got)
	}
	// Lang derived from voice prefix.
	if !strings.Contains(got, "xml:lang='ru-RU'") {
		t.Errorf("unexpected xml:lang; got: %s", got)
	}
}

func TestNewRequestID(t *testing.T) {
	id, err := newRequestID()
	if err != nil {
		t.Fatalf("newRequestID: %v", err)
	}
	if len(id) != 32 {
		t.Errorf("want 32 chars, got %d", len(id))
	}
}
