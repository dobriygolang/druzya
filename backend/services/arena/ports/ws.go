// Package ports wires the arena domain to HTTP + WebSocket transports.
package ports

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"druz9/arena/app"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// TokenVerifier is the local interface the WS hub uses to validate JWT tokens
// at handshake. Implemented by the auth domain's TokenIssuer; injected by
// cmd/monolith wiring.
type TokenVerifier interface {
	// VerifyAccess parses a raw token and returns the user id it belongs to.
	VerifyAccess(raw string) (uuid.UUID, error)
}

// Outbound message types (server → client) — bible / openapi x-websocket.
const (
	MsgMatchStart       = "match_start"
	MsgOpponentAccepted = "opponent_accepted"
	MsgOpponentProgress = "opponent_progress"
	MsgMatchResult      = "match_result"
	MsgCountdown        = "countdown"
)

// Inbound message types (client → server).
const (
	MsgMatchReady = "match_ready"
	MsgCodeSubmit = "code_submit"
	MsgHeartbeat  = "heartbeat"
	// Extra anticheat-signal messages.
	MsgPasteAttempt = "paste_attempt"
	MsgTabSwitch    = "tab_switch"
)

// rateLimit: 20 msgs/sec per connection (bible §11).
const maxMsgsPerSecond = 20

// Envelope is the common message shape.
type Envelope struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

// client is one WS connection attached to a match.
type client struct {
	matchID uuid.UUID
	userID  uuid.UUID
	conn    *websocket.Conn
	send    chan []byte
	log     *slog.Logger
	// rate limiting window
	rlMu    sync.Mutex
	rlStart time.Time
	rlCount int
}

// Hub owns per-match rooms.
type Hub struct {
	Log            *slog.Logger
	Verifier       TokenVerifier
	AllowedOrigins []string
	upgrader       websocket.Upgrader

	mu    sync.RWMutex
	rooms map[uuid.UUID]map[*client]struct{}

	// anticheat hooks — wired from cmd/monolith.
	OnPaste OnPasteFunc
	OnTab   OnTabSwitchFunc
}

// OnPasteFunc is invoked whenever a client sends a paste_attempt event.
type OnPasteFunc func(ctx context.Context, matchID, userID uuid.UUID)

// OnTabSwitchFunc is invoked on tab_switch events.
type OnTabSwitchFunc func(ctx context.Context, matchID, userID uuid.UUID)

// NewHub wires a hub. Origins is the comma-separated list of allowed origins;
// an empty list accepts any origin for local dev.
func NewHub(log *slog.Logger, verifier TokenVerifier, allowedOrigins []string) *Hub {
	h := &Hub{
		Log:            log,
		Verifier:       verifier,
		AllowedOrigins: allowedOrigins,
		rooms:          make(map[uuid.UUID]map[*client]struct{}),
	}
	h.upgrader = websocket.Upgrader{
		CheckOrigin: h.originAllowed,
	}
	return h
}

func (h *Hub) originAllowed(r *http.Request) bool {
	if len(h.AllowedOrigins) == 0 {
		return true
	}
	o := r.Header.Get("Origin")
	for _, allowed := range h.AllowedOrigins {
		if strings.EqualFold(strings.TrimSpace(allowed), o) {
			return true
		}
	}
	return false
}

// register adds a client to a room.
func (h *Hub) register(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.rooms[c.matchID]
	if !ok {
		room = make(map[*client]struct{})
		h.rooms[c.matchID] = room
	}
	room[c] = struct{}{}
}

// unregister removes a client and closes its send channel.
func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if room, ok := h.rooms[c.matchID]; ok {
		if _, present := room[c]; present {
			delete(room, c)
			close(c.send)
		}
		if len(room) == 0 {
			delete(h.rooms, c.matchID)
		}
	}
}

// Broadcast sends the envelope to every client in the match room.
func (h *Hub) Broadcast(matchID uuid.UUID, msgType string, payload any) {
	env := Envelope{Type: msgType}
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			h.Log.Error("arena.ws.Broadcast: marshal", slog.Any("err", err))
			return
		}
		env.Data = raw
	}
	buf, err := json.Marshal(env)
	if err != nil {
		h.Log.Error("arena.ws.Broadcast: encode", slog.Any("err", err))
		return
	}
	h.mu.RLock()
	room := h.rooms[matchID]
	// snapshot recipients so we don't hold the lock during slow writes
	targets := make([]*client, 0, len(room))
	for c := range room {
		targets = append(targets, c)
	}
	h.mu.RUnlock()
	for _, c := range targets {
		select {
		case c.send <- buf:
		default:
			// Client is slow — drop and log; don't block the hub.
			h.Log.Warn("arena.ws: slow client dropped",
				slog.String("user", c.userID.String()),
				slog.String("match", matchID.String()))
		}
	}
}

// NotifyMatched implements app.MatchNotifier — called by the matchmaker. The
// WS hub forwards a match_start envelope addressed to the given user only.
func (h *Hub) NotifyMatched(_ context.Context, userID, matchID uuid.UUID) {
	// Per-user routing — find their connection (if they are already connected
	// to the room) and send the envelope. If they aren't connected yet the
	// initial GET /match/{matchId} will fill in state.
	h.mu.RLock()
	room := h.rooms[matchID]
	targets := make([]*client, 0, len(room))
	for c := range room {
		if c.userID == userID {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()
	buf, _ := json.Marshal(Envelope{Type: MsgOpponentAccepted})
	for _, c := range targets {
		select {
		case c.send <- buf:
		default:
		}
	}
}

// ServeWS upgrades the HTTP connection and starts the client's read/write loops.
// matchId is parsed from the URL by the caller.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, matchID uuid.UUID, userID uuid.UUID) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.Log.Warn("arena.ws: upgrade failed", slog.Any("err", err))
		return
	}
	c := &client{
		matchID: matchID,
		userID:  userID,
		conn:    conn,
		send:    make(chan []byte, 32),
		log:     h.Log,
		rlStart: time.Now(),
	}
	h.register(c)
	go c.writePump()
	go c.readPump(h)
}

// STUB: spectator read-only WS — for spectator mode we'd accept connections
// without matching the user to a participant and skip the rate-limit drop,
// but allow no inbound messages. Out of MVP scope.

// readPump reads inbound messages from the client, rate-limits them, and
// dispatches by type.
func (c *client) readPump(h *Hub) {
	defer func() {
		h.unregister(c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(64 * 1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if !c.rateOk() {
			h.Log.Warn("arena.ws: rate limit — dropping message",
				slog.String("user", c.userID.String()))
			continue
		}
		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			h.Log.Warn("arena.ws: bad json", slog.Any("err", err))
			continue
		}
		switch env.Type {
		case MsgHeartbeat:
			// no-op — pong keeps the deadline fresh via pong handler
		case MsgMatchReady:
			// The HTTP /confirm endpoint is the source of truth; the WS event
			// just echoes readiness to the opposite side.
			h.Broadcast(c.matchID, MsgOpponentAccepted, map[string]any{
				"user_id": c.userID,
			})
		case MsgCodeSubmit:
			// Submissions are also served via HTTP. A WS-delivered submission
			// would broadcast progress; out-of-scope for MVP.
		case MsgPasteAttempt:
			if h.OnPaste != nil {
				h.OnPaste(context.Background(), c.matchID, c.userID)
			}
		case MsgTabSwitch:
			if h.OnTab != nil {
				h.OnTab(context.Background(), c.matchID, c.userID)
			}
		default:
			// Unknown type — ignore.
		}
	}
}

// rateOk returns true when the client is under the 20 msg/sec budget.
func (c *client) rateOk() bool {
	c.rlMu.Lock()
	defer c.rlMu.Unlock()
	now := time.Now()
	if now.Sub(c.rlStart) >= time.Second {
		c.rlStart = now
		c.rlCount = 0
	}
	c.rlCount++
	return c.rlCount <= maxMsgsPerSecond
}

// writePump streams outgoing messages + sends periodic pings.
func (c *client) writePump() {
	ping := time.NewTicker(30 * time.Second)
	defer func() {
		ping.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Compile-time: Hub implements app.MatchNotifier.
var _ app.MatchNotifier = (*Hub)(nil)
