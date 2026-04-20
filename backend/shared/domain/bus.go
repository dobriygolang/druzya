package domain

import "context"

// Handler processes an event. Returning an error triggers the bus's error strategy
// (log + continue for in-process; DLQ for NATS/Kafka in production).
type Handler func(ctx context.Context, e Event) error

// Bus is the event bus abstraction. In MVP this is in-process (channels);
// at scale it's replaced by NATS/Kafka without changing handler signatures.
type Bus interface {
	Publish(ctx context.Context, e Event) error
	Subscribe(topic string, h Handler)
}
