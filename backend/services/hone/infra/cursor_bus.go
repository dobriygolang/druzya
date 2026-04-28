// cursor_bus.go — in-process per-user fan-out for AI cursor events.
//
// Single-process by design: works inside the monolith, falls back to
// "no streaming" cleanly when scaled (the review-worker would publish
// via Redis Pub/Sub instead — left as a Phase J upgrade).
package infra

import (
	"context"
	"sync"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// InProcessCursorBus implements domain.CursorEventBus over in-process
// channels. Subscribers are keyed by user_id; each Publish fans out to
// every channel for that user (multi-tab support).
type InProcessCursorBus struct {
	mu   sync.RWMutex
	subs map[uuid.UUID]map[chan domain.CursorEvent]struct{}
}

// NewInProcessCursorBus wires the bus.
func NewInProcessCursorBus() *InProcessCursorBus {
	return &InProcessCursorBus{
		subs: make(map[uuid.UUID]map[chan domain.CursorEvent]struct{}),
	}
}

// Subscribe — returns a buffered channel and an unsubscribe func.
// The buffer (16) is enough for a typical AI sequence (~6 events) with
// headroom; an SSE client lagging beyond that drops the oldest event.
func (b *InProcessCursorBus) Subscribe(userID uuid.UUID) (<-chan domain.CursorEvent, func()) {
	ch := make(chan domain.CursorEvent, 16)
	b.mu.Lock()
	if b.subs[userID] == nil {
		b.subs[userID] = make(map[chan domain.CursorEvent]struct{})
	}
	b.subs[userID][ch] = struct{}{}
	b.mu.Unlock()
	unsub := func() {
		b.mu.Lock()
		if set, ok := b.subs[userID]; ok {
			delete(set, ch)
			if len(set) == 0 {
				delete(b.subs, userID)
			}
		}
		close(ch)
		b.mu.Unlock()
	}
	return ch, unsub
}

// Publish broadcasts to all subscribers for the user. Non-blocking:
// a full channel drops the oldest queued event so the worker never
// stalls on a slow client.
func (b *InProcessCursorBus) Publish(_ context.Context, e domain.CursorEvent) {
	b.mu.RLock()
	subs := b.subs[e.UserID]
	channels := make([]chan domain.CursorEvent, 0, len(subs))
	for ch := range subs {
		channels = append(channels, ch)
	}
	b.mu.RUnlock()

	for _, ch := range channels {
		select {
		case ch <- e:
		default:
			// Drop-oldest: pop one, push new. Best-effort, no lock contention.
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- e:
			default:
			}
		}
	}
}

// Compile-time guard.
var _ domain.CursorEventBus = (*InProcessCursorBus)(nil)
