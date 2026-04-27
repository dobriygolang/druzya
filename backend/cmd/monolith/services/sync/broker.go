// broker.go — in-process pubsub broker for realtime sync push (Phase C-6.2).
//
// Lives in the sync package (microservice-extraction friendly). Externally
// observed only via the narrow services.SyncBroker interface (Publish*) so
// neither services.Deps nor any consumer pulls in the broker concrete type.
package sync

import (
	"encoding/json"
	"log/slog"
	"net/http"
	stdSync "sync"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/google/uuid"
)

// sseHeartbeatInterval — periodic comment frame keeping idle SSE
// connections alive past nginx / corp-firewall timeouts (default 25s).
const sseHeartbeatInterval = 25 * time.Second

// SubscriberBuffer — per-subscriber channel capacity.
const SubscriberBuffer = 32

// Event — payload отправляемый в SSE. Минимальный: клиент при получении
// триггерит свой обычный pull (для LWW-таблиц) или yjs fetch-updates (для
// notes/whiteboards). Тяжёлые rows через text-stream не шлём.
type Event struct {
	Kind           string `json:"kind"`
	Table          string `json:"table,omitempty"`
	EntityKind     string `json:"entityKind,omitempty"`
	ParentID       string `json:"parentId,omitempty"`
	OriginDeviceID string `json:"originDeviceId,omitempty"`
}

// Subscriber — internal record per open SSE connection.
type Subscriber struct {
	Ch       chan Event
	DeviceID uuid.UUID
}

// Broker — fan-out per-user. Каждый Subscribe возвращает канал ёмкостью
// SubscriberBuffer; если subscriber медленный — publisher НЕ блокируется
// (drop event). Clients fall back на 30s polling.
type Broker struct {
	Mu          stdSync.RWMutex
	Subscribers map[uuid.UUID][]*Subscriber
	Log         *slog.Logger
}

// Compile-time check: *Broker satisfies services.SyncBroker (the narrow
// interface Deps exposes to consumers).
var _ monolithServices.SyncBroker = (*Broker)(nil)

// NewBroker constructs an empty broker.
func NewBroker(log *slog.Logger) *Broker {
	return &Broker{
		Subscribers: make(map[uuid.UUID][]*Subscriber),
		Log:         log,
	}
}

// Subscribe — register new SSE listener для (userID, deviceID). Returns
// receive channel + unsubscribe func.
func (b *Broker) Subscribe(userID, deviceID uuid.UUID) (<-chan Event, func()) {
	s := &Subscriber{Ch: make(chan Event, SubscriberBuffer), DeviceID: deviceID}
	b.Mu.Lock()
	b.Subscribers[userID] = append(b.Subscribers[userID], s)
	b.Mu.Unlock()

	unsub := func() {
		b.Mu.Lock()
		defer b.Mu.Unlock()
		subs := b.Subscribers[userID]
		for i, x := range subs {
			if x == s {
				b.Subscribers[userID] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		if len(b.Subscribers[userID]) == 0 {
			delete(b.Subscribers, userID)
		}
		close(s.Ch)
	}
	return s.Ch, unsub
}

// Publish — non-blocking fan-out. Origin device gets filtered out. Slow
// subscribers' channels skip the event (drop, not block).
func (b *Broker) Publish(userID uuid.UUID, ev Event) {
	originDID, _ := uuid.Parse(ev.OriginDeviceID)
	b.Mu.RLock()
	subs := append([]*Subscriber(nil), b.Subscribers[userID]...)
	b.Mu.RUnlock()
	for _, s := range subs {
		if originDID != uuid.Nil && s.DeviceID == originDID {
			continue // skip echo to origin
		}
		select {
		case s.Ch <- ev:
		default:
			// drop — не блокируем publisher на медленном subscriber'е.
		}
	}
}

// PublishYjsAppend — convenience хелпер. Type-safe сахар над Publish.
func (b *Broker) PublishYjsAppend(userID uuid.UUID, entityKind, parentID string, originDeviceID uuid.UUID) {
	b.Publish(userID, Event{
		Kind:           "yjs_append",
		EntityKind:     entityKind,
		ParentID:       parentID,
		OriginDeviceID: nilUUIDToEmpty(originDeviceID),
	})
}

// PublishSyncChange — generic LWW table mutated.
func (b *Broker) PublishSyncChange(userID uuid.UUID, table string, originDeviceID uuid.UUID) {
	b.Publish(userID, Event{
		Kind:           "sync_change",
		Table:          table,
		OriginDeviceID: nilUUIDToEmpty(originDeviceID),
	})
}

// SSEHandler — text/event-stream endpoint. Mounted by NewSyncEvents at
// GET /sync/events. Holds the connection until ctx закрывается; каждый
// Event сериализуется в `data: <json>\n\n`. Heartbeat-comments каждые 25s
// чтобы прокси не дропали idle connection.
func (b *Broker) SSEHandler(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	deviceID := sharedMw.DeviceIDFromContext(r.Context())

	flusher, ok := w.(http.Flusher)
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusInternalServerError, "no_flusher", "")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	if _, err := w.Write([]byte(": ok\n\n")); err != nil {
		return
	}
	flusher.Flush()

	ch, unsub := b.Subscribe(uid, deviceID)
	defer unsub()

	heartbeat := time.NewTicker(sseHeartbeatInterval)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			flusher.Flush()
		case ev, open := <-ch:
			if !open {
				return
			}
			payload, err := json.Marshal(ev)
			if err != nil {
				b.Log.WarnContext(r.Context(), "sync.sse: marshal failed", slog.Any("err", err))
				continue
			}
			line := append([]byte("data: "), payload...)
			line = append(line, '\n', '\n')
			if _, err := w.Write(line); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func nilUUIDToEmpty(id uuid.UUID) string {
	if id == uuid.Nil {
		return ""
	}
	return id.String()
}
