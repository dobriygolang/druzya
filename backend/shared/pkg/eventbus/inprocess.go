// Package eventbus предоставляет in-process реализацию domain.Bus.
// При выделении домена в микросервис заменить на NATS/Kafka адаптер —
// сигнатуры обработчиков останутся идентичными.
package eventbus

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"druz9/shared/domain"
	"druz9/shared/pkg/metrics"
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
	topic := e.Topic()
	metrics.EventbusPublishedTotal.WithLabelValues(topic).Inc()

	b.mu.RLock()
	hs := append([]domain.Handler(nil), b.handlers[topic]...)
	b.mu.RUnlock()

	for _, h := range hs {
		start := time.Now()
		err := h(ctx, e)
		metrics.EventbusHandleDuration.WithLabelValues(topic).Observe(time.Since(start).Seconds())
		if err != nil {
			metrics.EventbusFailedTotal.WithLabelValues(topic).Inc()
			// Логируем и продолжаем — фейл одного хендлера не должен блокировать остальные.
			b.log.ErrorContext(ctx, "event handler failed",
				slog.String("topic", topic),
				slog.Any("err", err),
			)
			continue
		}
		metrics.EventbusHandledTotal.WithLabelValues(topic).Inc()
	}
	return nil
}

// MustPublish — удобный хелпер для мест, где сбой публикации не должен
// случаться никогда (in-process шина никогда не возвращает ошибку).
func MustPublish(ctx context.Context, b domain.Bus, e domain.Event) {
	if err := b.Publish(ctx, e); err != nil {
		panic(fmt.Errorf("eventbus: publish %s: %w", e.Topic(), err))
	}
}
