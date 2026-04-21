// Package eventbus provides an in-process implementation of domain.Bus.
// When a domain is extracted to a microservice, swap this for a NATS/Kafka
// adapter — handler signatures stay identical.
package eventbus

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"druz9/shared/domain"
)

type InProcess struct {
	mu       sync.RWMutex
	handlers map[string][]domain.Handler
	log      *slog.Logger
}

func NewInProcess(log *slog.Logger) *InProcess {
	return &InProcess{
		handlers: make(map[string][]domain.Handler),
		log:      log,
	}
}

func (b *InProcess) Subscribe(topic string, h domain.Handler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.handlers[topic] = append(b.handlers[topic], h)
}

func (b *InProcess) Publish(ctx context.Context, e domain.Event) error {
	b.mu.RLock()
	hs := append([]domain.Handler(nil), b.handlers[e.Topic()]...)
	b.mu.RUnlock()

	for _, h := range hs {
		if err := h(ctx, e); err != nil {
			// Log and continue — one handler failure must not block the others.
			b.log.ErrorContext(ctx, "event handler failed",
				slog.String("topic", e.Topic()),
				slog.Any("err", err),
			)
		}
	}
	return nil
}

// MustPublish is a convenience helper for call sites where a publish failure
// should never happen (in-process bus never returns an error).
func MustPublish(ctx context.Context, b domain.Bus, e domain.Event) {
	if err := b.Publish(ctx, e); err != nil {
		panic(fmt.Errorf("eventbus: publish %s: %w", e.Topic(), err))
	}
}
