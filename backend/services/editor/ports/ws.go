package ports

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"druz9/editor/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// wsRateLimit is the per-connection inbound-msg budget. Editor — Yjs
// deltas + cursor bursts на paste/auto-format/multi-line edits. CodeMirror
// при typing easily эмитит >40 events/sec (insert + cursor + selection).
// 40 был слишком жёстким → silent-drop real-time updates → "reconnecting"
// у клиента из-за того что server-side snapshot не успевает settle.
// 200 даёт запас и совместим с Excalidraw frame-rate (mirror whiteboard'а).
const wsRateLimit = 200

// wsPingInterval is the server-initiated keepalive.
const wsPingInterval = 30 * time.Second

// wsReadDeadline is the max idle time on a connection before hanging up.
// Bible §5: "долгоживущие соединения (30-60 мин)". We keep the per-read
// deadline short (60s) and rely on pings to refresh it.
const wsReadDeadline = 120 * time.Second

// replayBufferCap is the rolling ring per room. ~10k ops covers a ~30 min
// session at reasonable edit rates; older entries drop on overflow.
const replayBufferCap = 10_000

// Outbound message kinds (server → client). See bible §5 / openapi x-websocket.
const (
	KindOp                = "op"
	KindCursor            = "cursor"
	KindFreeze            = "freeze"
	KindRoleChange        = "role_change"
	KindParticipantJoined = "participant_joined"
	KindParticipantLeft   = "participant_left"
	KindError             = "error"
	KindPong              = "pong"
)

// Inbound message kinds (client → server).
const (
	InOp       = "op"
	InCursor   = "cursor"
	InPresence = "presence"
	InPing     = "ping"
)

// Envelope is the common WS message shape.
type Envelope struct {
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data,omitempty"`
}

// opPayload is the Yjs delta carrier. Payload is opaque — we never parse it.
type opPayload struct {
	Payload []byte `json:"payload"`
}

// cursorPayload is presence-level: a single line/column update. Ephemeral —
// never persisted.
type cursorPayload struct {
	Line   int `json:"line"`
	Column int `json:"column"`
}

// ─────────────────────────────────────────────────────────────────────────
// Hub — per-room registry + replay buffer.
// ─────────────────────────────────────────────────────────────────────────

// Hub fans out editor events across all connections in a room, enforces
// role + freeze gates on inbound ops, and buffers the op stream for
// replay upload.
//
// Implements app.FreezeNotifier so the Freeze use case can trigger a
// server-originated "freeze" frame.
type Hub struct {
	Log *slog.Logger
	// RoomResolver resolves a room's current freeze state. Called on every
	// inbound op — cheap in practice since the hub caches it.
	RoomResolver func(ctx context.Context, roomID uuid.UUID) (domain.Room, error)
	// RoleResolver resolves a (room, user) role. Called once at handshake
	// and again when the server observes a role_change.
	RoleResolver func(ctx context.Context, roomID, userID uuid.UUID) (enums.EditorRole, error)

	mu    sync.RWMutex
	rooms map[uuid.UUID]*roomHub

	// seqCounter hands out monotonic op sequence numbers per room. Atomic
	// bump keeps the hub lock-free on the hot path.
	seqCounters sync.Map // uuid.UUID -> *atomic.Int64
}

// NewHub builds an empty hub.
func NewHub(log *slog.Logger) *Hub {
	return &Hub{Log: log, rooms: make(map[uuid.UUID]*roomHub)}
}

// roomHub holds the per-room state.
type roomHub struct {
	mu      sync.RWMutex
	clients map[*wsConn]struct{}
	// buffer is a ring of the last `replayBufferCap` ops.
	buffer  []bufferedEntry
	bufHead int // next write index
	bufLen  int // 0..replayBufferCap
}

// bufferedEntry is an op or cursor in the rolling replay buffer.
type bufferedEntry struct {
	Kind      string    `json:"kind"`
	Seq       int64     `json:"seq,omitempty"`
	UserID    uuid.UUID `json:"user_id"`
	Payload   []byte    `json:"payload,omitempty"`
	Line      int       `json:"line,omitempty"`
	Column    int       `json:"column,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (h *Hub) room(roomID uuid.UUID) *roomHub {
	h.mu.RLock()
	rh := h.rooms[roomID]
	h.mu.RUnlock()
	if rh != nil {
		return rh
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if rh = h.rooms[roomID]; rh != nil {
		return rh
	}
	rh = &roomHub{
		clients: make(map[*wsConn]struct{}),
		buffer:  make([]bufferedEntry, replayBufferCap),
	}
	h.rooms[roomID] = rh
	return rh
}

func (h *Hub) register(roomID uuid.UUID, c *wsConn) {
	rh := h.room(roomID)
	rh.mu.Lock()
	rh.clients[c] = struct{}{}
	rh.mu.Unlock()
	h.Broadcast(roomID, KindParticipantJoined, map[string]any{"user_id": c.userID})
}

func (h *Hub) unregister(roomID uuid.UUID, c *wsConn) {
	h.mu.RLock()
	rh := h.rooms[roomID]
	h.mu.RUnlock()
	if rh == nil {
		return
	}
	rh.mu.Lock()
	delete(rh.clients, c)
	rh.mu.Unlock()
	h.Broadcast(roomID, KindParticipantLeft, map[string]any{"user_id": c.userID})
	// Keep the room entry so the replay buffer survives brief drops;
	// the room is GC'd on FlushRoom + Close or on service shutdown.
	// STUB: room-close sweeper that flushes buffers to MinIO after N
	// minutes of emptiness. For MVP we flush only on /replay.
}

// Broadcast sends a frame to every client in the room. Op and cursor
// frames are also pushed into the replay buffer.
func (h *Hub) Broadcast(roomID uuid.UUID, kind string, data any) {
	var raw json.RawMessage
	if data != nil {
		b, err := json.Marshal(data)
		if err != nil {
			if h.Log != nil {
				h.Log.Error("editor.ws.Broadcast: marshal", slog.Any("err", err))
			}
			return
		}
		raw = b
	}
	env, err := json.Marshal(Envelope{Kind: kind, Data: raw})
	if err != nil {
		return
	}
	h.mu.RLock()
	rh := h.rooms[roomID]
	h.mu.RUnlock()
	if rh == nil {
		return
	}
	rh.mu.RLock()
	targets := make([]*wsConn, 0, len(rh.clients))
	for c := range rh.clients {
		targets = append(targets, c)
	}
	rh.mu.RUnlock()
	for _, c := range targets {
		c.enqueue(env)
	}
}

// BroadcastFreeze satisfies app.FreezeNotifier — fan out a freeze toggle.
func (h *Hub) BroadcastFreeze(roomID uuid.UUID, frozen bool, actor uuid.UUID) {
	h.Broadcast(roomID, KindFreeze, map[string]any{
		"frozen":   frozen,
		"actor_id": actor,
	})
}

// BroadcastRoleChange surfaces a role_change event.
func (h *Hub) BroadcastRoleChange(roomID, userID uuid.UUID, role enums.EditorRole) {
	if !role.IsValid() {
		return
	}
	h.Broadcast(roomID, KindRoleChange, map[string]any{
		"user_id": userID,
		"role":    string(role),
	})
}

// ─────────────────────────────────────────────────────────────────────────
// Replay buffer
// ─────────────────────────────────────────────────────────────────────────

func (h *Hub) nextSeq(roomID uuid.UUID) int64 {
	v, _ := h.seqCounters.LoadOrStore(roomID, new(atomic.Int64))
	return v.(*atomic.Int64).Add(1)
}

func (rh *roomHub) pushEntry(e bufferedEntry) {
	rh.mu.Lock()
	defer rh.mu.Unlock()
	rh.buffer[rh.bufHead] = e
	rh.bufHead = (rh.bufHead + 1) % replayBufferCap
	if rh.bufLen < replayBufferCap {
		rh.bufLen++
	}
}

// FlushRoom serialises the current buffer (oldest → newest) as a JSONL blob.
// Safe to call concurrently with writers.
func (h *Hub) FlushRoom(roomID uuid.UUID) []byte {
	h.mu.RLock()
	rh := h.rooms[roomID]
	h.mu.RUnlock()
	if rh == nil {
		return nil
	}
	rh.mu.RLock()
	defer rh.mu.RUnlock()
	if rh.bufLen == 0 {
		return nil
	}
	start := (rh.bufHead - rh.bufLen + replayBufferCap) % replayBufferCap
	var out []byte
	for i := 0; i < rh.bufLen; i++ {
		idx := (start + i) % replayBufferCap
		line, err := json.Marshal(rh.buffer[idx])
		if err != nil {
			continue
		}
		out = append(out, line...)
		out = append(out, '\n')
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────────────────

// wsConn wraps a single gorilla connection with an outbound buffer and a
// per-second token bucket.
type wsConn struct {
	ws     *websocket.Conn
	roomID uuid.UUID
	userID uuid.UUID
	role   atomic.Value // enums.EditorRole
	out    chan []byte
	done   chan struct{}
	log    *slog.Logger

	rlMu    sync.Mutex
	rlStart time.Time
	rlCount int
}

func newWSConn(ws *websocket.Conn, roomID, userID uuid.UUID, role enums.EditorRole, log *slog.Logger) *wsConn {
	c := &wsConn{
		ws:      ws,
		roomID:  roomID,
		userID:  userID,
		out:     make(chan []byte, 128),
		done:    make(chan struct{}),
		log:     log,
		rlStart: time.Now(),
	}
	c.role.Store(role)
	return c
}

func (c *wsConn) currentRole() enums.EditorRole {
	v := c.role.Load()
	if v == nil {
		return enums.EditorRoleViewer
	}
	return v.(enums.EditorRole)
}

func (c *wsConn) enqueue(msg []byte) {
	select {
	case c.out <- msg:
	default:
		// Slow consumer — drop and log.
		if c.log != nil {
			c.log.Warn("editor.ws: slow client, frame dropped",
				slog.String("user", c.userID.String()),
				slog.String("room", c.roomID.String()))
		}
	}
}

// rateOk returns false once the connection has exceeded wsRateLimit msg/sec.
func (c *wsConn) rateOk() bool {
	c.rlMu.Lock()
	defer c.rlMu.Unlock()
	now := time.Now()
	if now.Sub(c.rlStart) >= time.Second {
		c.rlStart = now
		c.rlCount = 0
	}
	c.rlCount++
	return c.rlCount <= wsRateLimit
}

func (c *wsConn) writeLoop() {
	pinger := time.NewTicker(wsPingInterval)
	defer pinger.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-pinger.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case msg, ok := <-c.out:
			_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.ws.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}
}

// readLoop reads inbound frames, applies role + freeze gates, and
// dispatches to broadcast/replay.
func (h *Hub) readLoop(ctx context.Context, c *wsConn) {
	defer func() {
		h.unregister(c.roomID, c)
		close(c.done)
		_ = c.ws.Close()
	}()
	c.ws.SetReadLimit(256 * 1024)
	_ = c.ws.SetReadDeadline(time.Now().Add(wsReadDeadline))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(wsReadDeadline))
	})
	for {
		if ctx.Err() != nil {
			return
		}
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		if !c.rateOk() {
			if h.Log != nil {
				h.Log.Warn("editor.ws: rate limit",
					slog.String("user", c.userID.String()))
			}
			continue
		}
		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			continue
		}
		switch env.Kind {
		case InPing:
			c.enqueue(mustEnvelope(KindPong, nil))

		case InOp:
			// Role gate: viewer connections never write ops.
			role := c.currentRole()
			if !role.CanEdit() {
				if h.Log != nil {
					h.Log.Debug("editor.ws: drop op (viewer)",
						slog.String("user", c.userID.String()))
				}
				continue
			}
			// Freeze gate: when room is frozen, only owner + interviewer write.
			if h.RoomResolver != nil {
				room, rerr := h.RoomResolver(ctx, c.roomID)
				if rerr == nil && !domain.CanEdit(role, room.IsFrozen) {
					if h.Log != nil {
						h.Log.Debug("editor.ws: drop op (frozen)",
							slog.String("user", c.userID.String()),
							slog.String("role", string(role)))
					}
					continue
				}
			}
			var p opPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			seq := h.nextSeq(c.roomID)
			entry := bufferedEntry{
				Kind:      KindOp,
				Seq:       seq,
				UserID:    c.userID,
				Payload:   p.Payload,
				CreatedAt: time.Now().UTC(),
			}
			h.room(c.roomID).pushEntry(entry)
			h.Broadcast(c.roomID, KindOp, map[string]any{
				"seq":     seq,
				"user_id": c.userID,
				"payload": p.Payload,
			})

		case InCursor:
			var p cursorPayload
			if err := json.Unmarshal(env.Data, &p); err != nil {
				continue
			}
			entry := bufferedEntry{
				Kind:      KindCursor,
				UserID:    c.userID,
				Line:      p.Line,
				Column:    p.Column,
				CreatedAt: time.Now().UTC(),
			}
			h.room(c.roomID).pushEntry(entry)
			h.Broadcast(c.roomID, KindCursor, map[string]any{
				"user_id": c.userID,
				"line":    p.Line,
				"column":  p.Column,
			})

		case InPresence:
			// Forward presence heartbeats to other peers (typing indicators etc.).
			h.Broadcast(c.roomID, InPresence, map[string]any{
				"user_id": c.userID,
				"data":    env.Data,
			})

		default:
			// Unknown kinds are ignored — forward-compat.
		}
	}
}

func mustEnvelope(kind string, data any) []byte {
	var raw json.RawMessage
	if data != nil {
		b, _ := json.Marshal(data)
		raw = b
	}
	out, _ := json.Marshal(Envelope{Kind: kind, Data: raw})
	return out
}

// CloseAll closes every client in every room. Called at service shutdown.
func (h *Hub) CloseAll() {
	h.mu.RLock()
	rooms := make([]*roomHub, 0, len(h.rooms))
	for _, rh := range h.rooms {
		rooms = append(rooms, rh)
	}
	h.mu.RUnlock()
	for _, rh := range rooms {
		rh.mu.RLock()
		for c := range rh.clients {
			_ = c.ws.Close()
		}
		rh.mu.RUnlock()
	}
}
