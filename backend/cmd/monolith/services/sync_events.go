// Package services — Phase C-6.2 server-sent events для realtime sync push.
//
// Зачем: C-4 даёт 30s polling cycle. Multi-device юзер с двумя ноутбуками
// видит изменение второго через 30 секунд. SSE channel снижает это до
// «как только write commit'нулся» (≤ 1s).
//
// Architecture:
//
//	SyncEventBroker — in-process per-user fan-out. На write-path (yjs
//	append, vault encrypt/decrypt, sync push delete) handler делает
//	broker.Publish(userID, evt). Broker рассылает в открытые SSE
//	subscriptions того же user_id.
//
//	Это НЕ pubsub через Redis. Один monolith-процесс (текущая
//	архитектура), нет нужды в cross-process broker'е. Когда пойдём
//	на multiple replicas, заменим InProcess на Redis Streams (тот же
//	API).
//
// SSE vs Connect server-streaming:
//   - SSE: std HTTP, browser EventSource API auto-reconnects, простое
//     wire-протокол `event: name\ndata: {...}\n\n`.
//   - Connect-streaming: Connect-Web stream API, proto regen (тяжёлый
//     touch generated/pb), один протокол с остальными RPC.
//   - Выбор: SSE. Reason — мы УЖЕ имеем плоский REST для sync (C-4),
//     SSE органично сюда ложится. Reconnect/auth handling в EventSource
//     решается одной line'ой клиентского кода. Connect-streaming
//     дал бы те же гарантии, но за proto-regen + туземные особенности
//     headers в Connect-Web stream — overhead не оправдан.
package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// SyncEvent — payload отправляемый в SSE. Намеренно minimalistic:
// клиент при получении просто триггерит свой обычный pull (для
// LWW-таблиц) или yjs fetch-updates (для notes/whiteboards). Не шлём
// сами данные через SSE — иначе пришлось бы сериализовывать тяжёлые
// rows в text-stream.
type SyncEvent struct {
	// Kind: "sync_change" (LWW таблица изменилась), "yjs_append"
	// (new yjs update для notes/whiteboards). UI решает что делать.
	Kind string `json:"kind"`
	// Table — для sync_change. "hone_notes" / "hone_whiteboards" / etc.
	Table string `json:"table,omitempty"`
	// EntityKind — для yjs_append. "notes" / "whiteboards".
	EntityKind string `json:"entityKind,omitempty"`
	// ParentID — для yjs_append (note_id или whiteboard_id).
	ParentID string `json:"parentId,omitempty"`
	// OriginDeviceID — устройство-источник изменения. Frontend
	// фильтрует чтобы не self-trigger pull на собственный write.
	OriginDeviceID string `json:"originDeviceId,omitempty"`
}

// ─── Broker ───────────────────────────────────────────────────────────────

type subscriber struct {
	ch chan SyncEvent
	// device — фильтр на стороне сервера: не шлём событие от device A
	// тому же device A. Без этого client получал бы echo своих write'ов
	// и триггерил pull который ничего нового не приносит.
	deviceID uuid.UUID
}

// SyncEventBroker — fan-out per-user. Каждый Subscribe возвращает
// канал ёмкостью N (см. subscriberBuffer); если subscriber медленный —
// publisher НЕ блокируется (drop event). UX impact: при slow client
// несколько событий могут быть пропущены, но clients fall back на 30s
// polling (C-4) — пропущенные в SSE придут через polling.
type SyncEventBroker struct {
	mu          sync.RWMutex
	subscribers map[uuid.UUID][]*subscriber // user_id → subs
	log         *slog.Logger
}

const subscriberBuffer = 32

func NewSyncEventBroker(log *slog.Logger) *SyncEventBroker {
	return &SyncEventBroker{
		subscribers: make(map[uuid.UUID][]*subscriber),
		log:         log,
	}
}

// Subscribe — register new SSE listener для (userID, deviceID).
// Returns receive channel + unsubscribe func.
func (b *SyncEventBroker) Subscribe(userID, deviceID uuid.UUID) (<-chan SyncEvent, func()) {
	s := &subscriber{
		ch:       make(chan SyncEvent, subscriberBuffer),
		deviceID: deviceID,
	}
	b.mu.Lock()
	b.subscribers[userID] = append(b.subscribers[userID], s)
	b.mu.Unlock()

	unsub := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		subs := b.subscribers[userID]
		for i, x := range subs {
			if x == s {
				b.subscribers[userID] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		if len(b.subscribers[userID]) == 0 {
			delete(b.subscribers, userID)
		}
		close(s.ch)
	}
	return s.ch, unsub
}

// Publish — non-blocking fan-out. Origin device gets filtered out.
// Slow subscribers' channels skip the event (drop, not block).
func (b *SyncEventBroker) Publish(userID uuid.UUID, ev SyncEvent) {
	originDID, _ := uuid.Parse(ev.OriginDeviceID)
	b.mu.RLock()
	subs := append([]*subscriber(nil), b.subscribers[userID]...)
	b.mu.RUnlock()
	for _, s := range subs {
		if originDID != uuid.Nil && s.deviceID == originDID {
			continue // skip echo to origin
		}
		select {
		case s.ch <- ev:
		default:
			// drop — не блокируем publisher на медленном subscriber'е.
			// Clients fall back на 30s polling.
		}
	}
}

// PublishYjsAppend — convenience хелпер для callers которые знают только
// (kind, parentID, originDeviceID). Type-safe сахар над Publish.
func (b *SyncEventBroker) PublishYjsAppend(userID uuid.UUID, entityKind, parentID string, originDeviceID uuid.UUID) {
	b.Publish(userID, SyncEvent{
		Kind:           "yjs_append",
		EntityKind:     entityKind,
		ParentID:       parentID,
		OriginDeviceID: nilUUIDToEmpty(originDeviceID),
	})
}

// PublishSyncChange — generic LWW table mutated.
func (b *SyncEventBroker) PublishSyncChange(userID uuid.UUID, table string, originDeviceID uuid.UUID) {
	b.Publish(userID, SyncEvent{
		Kind:           "sync_change",
		Table:          table,
		OriginDeviceID: nilUUIDToEmpty(originDeviceID),
	})
}

func nilUUIDToEmpty(id uuid.UUID) string {
	if id == uuid.Nil {
		return ""
	}
	return id.String()
}

// ─── HTTP handler ─────────────────────────────────────────────────────────

const (
	sseHeartbeatInterval = 25 * time.Second // < 30s nginx default proxy timeout
	sseEventBufferSize   = 16
)

// sseHandler выписывает text/event-stream и держит соединение пока не
// закроется ctx (либо клиент disconnect, либо server shutdown). Каждое
// SyncEvent сериализуется в SSE-формат `data: <json>\n\n`. Heartbeat-
// comments каждые 25s чтобы nginx и corp-firewall'ы не дропали idle
// connection.
func (b *SyncEventBroker) sseHandler(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	deviceID := sharedMw.DeviceIDFromContext(r.Context())

	flusher, ok := w.(http.Flusher)
	if !ok {
		// Без Flusher SSE невозможен (нужен incremental write). Это
		// indicator что middleware-цепочка где-то проглотила Flush —
		// мы уже добавили Flush passthrough во все наши middleware'ы
		// (otel/middleware/metrics) для Connect streaming, но проверим.
		writePubJSONError(w, http.StatusInternalServerError, "no_flusher", "")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	// X-Accel-Buffering: no — отключает nginx response buffering для этого
	// endpoint'а. Без него nginx копит chunks и SSE превращается в
	// «всё пришло разом через минуту».
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Initial comment line — даёт EventSource понять что соединение
	// установлено даже если первое событие придёт нескоро.
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
				b.log.WarnContext(r.Context(), "sync.sse: marshal failed", slog.Any("err", err))
				continue
			}
			// SSE формат: `data: <line>\n\n`. JSON может содержать \n,
			// но это безопасно потому что мы не используем `\n\n`
			// inside payload (json.Marshal escape'ит \n).
			line := append([]byte("data: "), payload...)
			line = append(line, '\n', '\n')
			if _, err := w.Write(line); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// ─── Module wiring ────────────────────────────────────────────────────────

// NewSyncEvents wires the SSE module. Returns Module + the broker (которое
// inject'ится в другие модули через Deps.SyncEventBroker для publish-side).
func NewSyncEvents(d Deps) (*Module, *SyncEventBroker) {
	broker := NewSyncEventBroker(d.Log)
	return &Module{
		MountREST: func(r chi.Router) {
			r.Get("/sync/events", broker.sseHandler)
		},
	}, broker
}

// Compile-time assertion: SyncEventBroker не должен случайно стать nil-able
// в caller-коде; явный check на nil в каждом publish-site проще.
var _ = func() {
	// suppress unused-imports if we drop publishing in some build
	_ = fmt.Sprintf
	_ = context.Canceled
}
