package infra

import (
	"context"
	"fmt"

	"druz9/quiz/domain"
	sharedDomain "druz9/shared/domain"
)

// BusPublisher adapts a sharedDomain.Bus to domain.Bus, encoding the
// quiz Result as a sharedDomain.QuizSessionCompleted event.
type BusPublisher struct {
	bus sharedDomain.Bus
}

// NewBusPublisher wires the publisher.
func NewBusPublisher(bus sharedDomain.Bus) *BusPublisher {
	return &BusPublisher{bus: bus}
}

// PublishSessionCompleted emits a single QuizSessionCompleted event so
// hone.coach_listener can settle the matching kind=quiz task.
func (p *BusPublisher) PublishSessionCompleted(ctx context.Context, r domain.Result) error {
	if p.bus == nil {
		return nil
	}
	ev := sharedDomain.QuizSessionCompleted{
		UserID:    r.UserID,
		SessionID: r.SessionID,
		Source:    string(r.Source),
		Total:     r.Total,
		Correct:   r.Correct,
	}
	if err := p.bus.Publish(ctx, ev); err != nil {
		return fmt.Errorf("quiz.BusPublisher.PublishSessionCompleted: %w", err)
	}
	return nil
}

// Compile-time guard.
var _ domain.Bus = (*BusPublisher)(nil)
