package domain

import "context"

// Handler обрабатывает событие. Возврат ошибки активирует error-стратегию шины
// (log + continue для in-process; DLQ для NATS/Kafka в проде).
type Handler func(ctx context.Context, e Event) error

// Bus — абстракция шины событий. В MVP это in-process (channels);
// при масштабировании заменяется на NATS/Kafka без изменения сигнатур обработчиков.
type Bus interface {
	Publish(ctx context.Context, e Event) error
	Subscribe(topic string, h Handler)
}
