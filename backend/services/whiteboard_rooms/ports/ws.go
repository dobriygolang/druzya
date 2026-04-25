// Package ports — WebSocket relay for shared whiteboards.
//
// Protocol (kinds on the envelope):
//   - "update"    — Yjs state update, opaque bytes (base64 on the wire);
//     fan-out to every other client and — on debounce — persist as the
//     room snapshot.
//   - "awareness" — presence frame (cursor, selection). Not persisted.
//   - "ping"/"pong" — keepalive.
//   - "snapshot"  — server → client only, emitted once on handshake to
//     hydrate the client's Y.Doc before it starts streaming updates.
//
// Simplifications vs. editor/ports/ws.go: no role / freeze gates, no
// MinIO replay upload, no op-sequence numbers. Snapshots live in Postgres
// and are the only persistence tier.
package ports

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"druz9/whiteboard_rooms/domain"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	// wsRateLimit — per-connection inbound msg/sec. Excalidraw на активном
	// drawing'е emit'ит 60-120+ events/sec (mouse-move на каждый pixel).
	// Старый лимит 40 → silent-drop'ались real-time updates → host видит
	// guest'а, guest НЕ видит host'а (или наоборот) + после refresh всё
	// пропадает (snapshot не успел persist'нуться). Поднимаем до 200 с
	// запасом — нагрузка всё равно ограничена per-conn (одна вкладка).
	wsRateLimit       = 200
	wsPingInterval    = 30 * time.Second
	wsReadDeadline    = 120 * time.Second
	wsMaxMessageBytes = 1 << 20 // 1 MiB — Excalidraw diffs are small, full snapshots fit.
	snapshotDebounce  = 30 * time.Second
)

// SnapshotPersister is the narrow seam into app/handlers.PersistSnapshot so
// the ws package has no direct infra dep.
type SnapshotPersister interface {
	PersistSnapshot(ctx context.Context, roomID uuid.UUID, snapshot []byte) error
}

// RoomResolver loads a room's current snapshot — served to the new client
// on connect so the late joiner's Y.Doc catches up before live updates.
type RoomResolver interface {
	Get(ctx context.Context, id uuid.UUID) (domain.Room, error)
}

// Envelope is the wire message shape.
type Envelope struct {
	Kind string          `json:"kind"`
	Data json.RawMessage `json:"data,omitempty"`
}

// snapshotPayload carries a Yjs update blob base64-encoded on the wire
// (JSON safety; raw []byte would need a transport-binary frame).
type snapshotPayload struct {
	Update string `json:"update"`
}

// Hub fans out updates across every connection in a room.
type Hub struct {
	Log       *slog.Logger
	Rooms     RoomResolver
	Persister SnapshotPersister

	mu    sync.RWMutex
	rooms map[uuid.UUID]*roomHub
}

// NewHub builds an empty hub.
func NewHub(log *slog.Logger, rooms RoomResolver, persister SnapshotPersister) *Hub {
	return &Hub{Log: log, Rooms: rooms, Persister: persister, rooms: make(map[uuid.UUID]*roomHub)}
}

type roomHub struct {
	mu      sync.RWMutex
	clients map[*wsConn]struct{}
	// lastFullSnapshot is the most recent full-state blob seen on the wire;
	// used to hydrate newcomers before Postgres debounce-flushes it.
	lastFullSnapshot []byte
	// pendingFlush is the debounce timer. Reset on every 'update' / 'snapshot'
	// and fires once 30 s of quiet — at which point we call PersistSnapshot.
	pendingFlush *time.Timer
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
	rh = &roomHub{clients: make(map[*wsConn]struct{})}
	h.rooms[roomID] = rh
	return rh
}

func (h *Hub) register(roomID uuid.UUID, c *wsConn) {
	rh := h.room(roomID)
	rh.mu.Lock()
	rh.clients[c] = struct{}{}
	rh.mu.Unlock()
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
	empty := len(rh.clients) == 0
	rh.mu.Unlock()
	// When the last participant leaves, flush immediately so we don't lose
	// edits that happened within the debounce window.
	if empty {
		h.flushRoom(context.Background(), roomID)
	}
}

// broadcast fans a raw envelope to every client except `skip`.
func (h *Hub) broadcast(roomID uuid.UUID, msg []byte, skip *wsConn) {
	h.mu.RLock()
	rh := h.rooms[roomID]
	h.mu.RUnlock()
	if rh == nil {
		return
	}
	rh.mu.RLock()
	targets := make([]*wsConn, 0, len(rh.clients))
	for c := range rh.clients {
		if c != skip {
			targets = append(targets, c)
		}
	}
	totalClients := len(rh.clients)
	rh.mu.RUnlock()
	for _, c := range targets {
		c.enqueue(msg)
	}
	// DEBUG → INFO temporarily: «отправили ли мы что-то peer'ам?». Если
	// totalClients > 1 но targets == 0 — кто-то застрял в hub'е под
	// другим roomID (race / wrong parse). После того как realtime устаканится,
	// можно вернуть на Debug. Грепай в проде: `wb.ws.broadcast`.
	if h.Log != nil && totalClients > 1 {
		h.Log.Info("wb.ws.broadcast",
			slog.String("room", roomID.String()),
			slog.Int("targets", len(targets)),
			slog.Int("total_clients", totalClients),
			slog.Int("msg_bytes", len(msg)))
	}
}

// scheduleFlush resets the room's debounce timer — last edit wins.
func (h *Hub) scheduleFlush(roomID uuid.UUID) {
	rh := h.room(roomID)
	rh.mu.Lock()
	if rh.pendingFlush != nil {
		rh.pendingFlush.Stop()
	}
	rh.pendingFlush = time.AfterFunc(snapshotDebounce, func() {
		h.flushRoom(context.Background(), roomID)
	})
	rh.mu.Unlock()
}

func (h *Hub) flushRoom(ctx context.Context, roomID uuid.UUID) {
	rh := h.room(roomID)
	rh.mu.Lock()
	snap := rh.lastFullSnapshot
	rh.mu.Unlock()
	if len(snap) == 0 || h.Persister == nil {
		return
	}
	if err := h.Persister.PersistSnapshot(ctx, roomID, snap); err != nil && h.Log != nil {
		h.Log.Warn("whiteboard_rooms.ws: PersistSnapshot failed",
			slog.String("room", roomID.String()),
			slog.Any("err", err))
	}
}

// CloseAll closes every client in every room (service shutdown).
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

// ─────────────────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────────────────

type wsConn struct {
	ws     *websocket.Conn
	roomID uuid.UUID
	userID uuid.UUID
	out    chan []byte
	done   chan struct{}
	log    *slog.Logger

	rlMu    sync.Mutex
	rlStart time.Time
	rlCount int
}

func newWSConn(ws *websocket.Conn, roomID, userID uuid.UUID, log *slog.Logger) *wsConn {
	return &wsConn{
		ws:      ws,
		roomID:  roomID,
		userID:  userID,
		out:     make(chan []byte, 128),
		done:    make(chan struct{}),
		log:     log,
		rlStart: time.Now(),
	}
}

func (c *wsConn) enqueue(msg []byte) {
	select {
	case c.out <- msg:
	default:
		if c.log != nil {
			c.log.Warn("whiteboard_rooms.ws: slow client, frame dropped",
				slog.String("user", c.userID.String()),
				slog.String("room", c.roomID.String()))
		}
	}
}

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

// readLoop dispatches inbound frames. Any 'update' or 'snapshot' resets
// the debounce timer + stores the blob for late joiners.
func (h *Hub) readLoop(ctx context.Context, c *wsConn) {
	defer func() {
		h.unregister(c.roomID, c)
		close(c.done)
		_ = c.ws.Close()
	}()
	c.ws.SetReadLimit(wsMaxMessageBytes)
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
				h.Log.Warn("whiteboard_rooms.ws: rate limit",
					slog.String("user", c.userID.String()))
			}
			continue
		}
		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			continue
		}
		switch env.Kind {
		case "ping":
			c.enqueue(mustEnvelope("pong", nil))
		case "awareness":
			// Forward presence as-is, never persist.
			h.broadcast(c.roomID, data, c)
		case "update", "snapshot":
			// Stash the blob for the next joiner + schedule DB flush.
			var p snapshotPayload
			if err := json.Unmarshal(env.Data, &p); err == nil && p.Update != "" {
				if blob, derr := base64.StdEncoding.DecodeString(p.Update); derr == nil {
					rh := h.room(c.roomID)
					rh.mu.Lock()
					rh.lastFullSnapshot = blob
					rh.mu.Unlock()
					h.scheduleFlush(c.roomID)
				}
			}
			h.broadcast(c.roomID, data, c)
		default:
			// forward-compat
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
