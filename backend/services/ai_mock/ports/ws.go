package ports

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"druz9/ai_mock/app"
	"druz9/ai_mock/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// wsWriteRateLimit is the per-connection outbound frame budget (bible: 20/s).
const wsWriteRateLimit = 20

// wsWriteBurst is the token-bucket burst. Small, since legitimate bursts are
// streaming-token sequences which are themselves bounded.
const wsWriteBurst = 40

// wsPingInterval is the keep-alive interval.
const wsPingInterval = 30 * time.Second

// wsReadDeadline is the max idle time on a connection before hanging up.
const wsReadDeadline = 120 * time.Second

// WSFrame is the server→client envelope. Payload fields vary per kind.
type WSFrame struct {
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// WSInbound is the client→server envelope.
type WSInbound struct {
	Kind    string          `json:"kind"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// ─────────────────────────────────────────────────────────────────────────
// Hub — per-session registry.
// ─────────────────────────────────────────────────────────────────────────

// Hub fans out server-side events (stress_update, intervention, replay) to all
// connections of a session. Also cross-wired with IngestStress.Emit and the
// InterventionWatch callback.
type Hub struct {
	mu   sync.RWMutex
	conn map[uuid.UUID]map[*wsConn]struct{}
	log  *slog.Logger
}

// NewHub creates an empty hub.
func NewHub(log *slog.Logger) *Hub {
	return &Hub{conn: make(map[uuid.UUID]map[*wsConn]struct{}), log: log}
}

// BroadcastStressUpdate emits a stress_update frame to the session.
func (h *Hub) BroadcastStressUpdate(sessionID uuid.UUID, c domain.StressCrossing) {
	payload, _ := json.Marshal(map[string]any{
		"dimension": c.Dimension,
		"threshold": c.Threshold,
		"value":     c.Value,
	})
	h.broadcast(sessionID, WSFrame{Kind: "stress_update", Payload: payload})
}

// BroadcastIntervention signals the client that the LLM just intervened.
func (h *Hub) BroadcastIntervention(sessionID uuid.UUID, text string) {
	payload, _ := json.Marshal(map[string]any{"text": text})
	h.broadcast(sessionID, WSFrame{Kind: "intervention", Payload: payload})
}

func (h *Hub) broadcast(sessionID uuid.UUID, f WSFrame) {
	h.mu.RLock()
	set := h.conn[sessionID]
	conns := make([]*wsConn, 0, len(set))
	for c := range set {
		conns = append(conns, c)
	}
	h.mu.RUnlock()
	for _, c := range conns {
		c.send(f)
	}
}

func (h *Hub) register(sessionID uuid.UUID, c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	m, ok := h.conn[sessionID]
	if !ok {
		m = make(map[*wsConn]struct{})
		h.conn[sessionID] = m
	}
	m[c] = struct{}{}
}

func (h *Hub) unregister(sessionID uuid.UUID, c *wsConn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m, ok := h.conn[sessionID]; ok {
		delete(m, c)
		if len(m) == 0 {
			delete(h.conn, sessionID)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// wsConn — per-connection writer goroutine + rate limit.
// ─────────────────────────────────────────────────────────────────────────

type wsConn struct {
	ws   *websocket.Conn
	out  chan WSFrame
	done chan struct{}
	log  *slog.Logger

	// tokens is the rate-limit bucket; refilled by the writer loop.
	tokensMu sync.Mutex
	tokens   int
	lastRef  time.Time
}

func newWSConn(ws *websocket.Conn, log *slog.Logger) *wsConn {
	return &wsConn{
		ws:      ws,
		out:     make(chan WSFrame, 64),
		done:    make(chan struct{}),
		log:     log,
		tokens:  wsWriteBurst,
		lastRef: time.Now(),
	}
}

// send enqueues a frame; dropped when the buffer is full.
func (c *wsConn) sendFrame(f WSFrame) {
	select {
	case c.out <- f:
	default:
		if c.log != nil {
			c.log.Warn("mock.ws: drop frame, buffer full", slog.String("kind", f.Kind))
		}
	}
}

// Alias so Hub can call a short method name without exposing channel plumbing.
func (c *wsConn) send(f WSFrame) { c.sendFrame(f) }

func (c *wsConn) writeLoop(ctx context.Context) {
	pinger := time.NewTicker(wsPingInterval)
	defer pinger.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.done:
			return
		case <-pinger.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case f := <-c.out:
			if !c.consumeToken() {
				// Rate-limited — drop the frame. Bible: 20 msg/sec cap.
				continue
			}
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			b, err := json.Marshal(f)
			if err != nil {
				continue
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		}
	}
}

// consumeToken applies a simple per-second refill bucket.
func (c *wsConn) consumeToken() bool {
	c.tokensMu.Lock()
	defer c.tokensMu.Unlock()
	now := time.Now()
	elapsed := now.Sub(c.lastRef).Seconds()
	if elapsed >= 1 {
		refill := int(elapsed) * wsWriteRateLimit
		c.tokens += refill
		if c.tokens > wsWriteBurst {
			c.tokens = wsWriteBurst
		}
		c.lastRef = now
	}
	if c.tokens <= 0 {
		return false
	}
	c.tokens--
	return true
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers for the handler — typed payloads.
// ─────────────────────────────────────────────────────────────────────────

type wsEditorEventPayload struct {
	Type       string         `json:"type"`
	AtMs       int64          `json:"at_ms"`
	DurationMs int64          `json:"duration_ms,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

type wsUserMessagePayload struct {
	Content         string `json:"content"`
	CodeSnapshot    string `json:"code_snapshot,omitempty"`
	VoiceTranscript string `json:"voice_transcript,omitempty"`
}

type wsVoiceChunkPayload struct {
	// Transcript is produced client-side via Web Speech API (bible §8). Raw
	// audio is out of scope for v1 — STUB: real Whisper/TTS.
	Transcript string `json:"transcript"`
}

// toDomainEditorEvent applies validation.
func (p wsEditorEventPayload) toDomain() (domain.EditorEvent, bool) {
	t := domain.EditorEventType(p.Type)
	if !t.IsValid() {
		return domain.EditorEvent{}, false
	}
	return domain.EditorEvent{Type: t, AtMs: p.AtMs, DurationMs: p.DurationMs, Metadata: p.Metadata}, true
}

// Shared type check.
var _ = enums.MessageRoleAssistant
var _ = app.MessageContextSize
