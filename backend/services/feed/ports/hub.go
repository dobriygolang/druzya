// Package ports exposes the public WebSocket feed hub.
// No authentication — the hub only emits anonymized events.
package ports

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	feeddomain "druz9/feed/domain"

	"github.com/gorilla/websocket"
)

const (
	// how many recent events a newly-connected client receives on join
	replayBufferSize = 25
	// max in-flight send queue per connection before we drop the client
	perClientBuffer = 64
)

// Hub broadcasts feed events to every live WebSocket connection.
type Hub struct {
	log *slog.Logger
	up  websocket.Upgrader

	mu      sync.RWMutex
	clients map[*client]struct{}
	recent  []feeddomain.FeedEvent // ring buffer replayed on connect
}

type client struct {
	conn *websocket.Conn
	send chan feeddomain.FeedEvent
}

// NewHub constructs a hub. CheckOrigin is permissive on purpose — the feed is
// public; configure origin restrictions in nginx if needed.
func NewHub(log *slog.Logger) *Hub {
	return &Hub{
		log:     log,
		clients: make(map[*client]struct{}),
		up: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
}

// Broadcast pushes an event to every connected client and updates the replay
// buffer. Slow clients are dropped — the feed is lossy by design.
func (h *Hub) Broadcast(e feeddomain.FeedEvent) {
	h.mu.Lock()
	h.recent = append(h.recent, e)
	if len(h.recent) > replayBufferSize {
		h.recent = h.recent[len(h.recent)-replayBufferSize:]
	}
	var drops []*client
	for c := range h.clients {
		select {
		case c.send <- e:
		default:
			drops = append(drops, c)
		}
	}
	for _, c := range drops {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
}

// Handle upgrades an HTTP request to WebSocket and streams events until the
// peer disconnects. Mounted at GET /ws/feed — no auth.
func (h *Hub) Handle(w http.ResponseWriter, r *http.Request) {
	ws, err := h.up.Upgrade(w, r, nil)
	if err != nil {
		h.log.Warn("feed.ws upgrade", "err", err)
		return
	}
	c := &client{conn: ws, send: make(chan feeddomain.FeedEvent, perClientBuffer)}

	h.mu.Lock()
	replay := append([]feeddomain.FeedEvent(nil), h.recent...)
	h.clients[c] = struct{}{}
	h.mu.Unlock()

	// Write pump.
	go h.writeLoop(c)
	for _, e := range replay {
		select {
		case c.send <- e:
		default:
		}
	}

	// Read pump — we don't accept any messages, just keep the conn alive
	// and drop on error / peer close.
	_ = ws.SetReadDeadline(time.Now().Add(120 * time.Second))
	ws.SetPongHandler(func(string) error {
		return ws.SetReadDeadline(time.Now().Add(120 * time.Second))
	})
	for {
		if _, _, err := ws.NextReader(); err != nil {
			break
		}
	}

	h.mu.Lock()
	delete(h.clients, c)
	close(c.send)
	h.mu.Unlock()
	_ = ws.Close()
}

func (h *Hub) writeLoop(c *client) {
	pingTicker := time.NewTicker(30 * time.Second)
	defer pingTicker.Stop()
	for {
		select {
		case e, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			buf, err := json.Marshal(e)
			if err != nil {
				continue
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, buf); err != nil {
				return
			}
		case <-pingTicker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
