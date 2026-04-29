package domain

import (
	"context"
	"time"
)

// BoostySource — порт для чтения подписчиков у Boosty. Мокабельный: в prod
// — реальный BoostyClient (infra), в тестах — fake.
//
// Lives in domain so the infra adapter can implement the port without
// importing app.
type BoostySource interface {
	ListSubscribers(ctx context.Context, limit int) ([]BoostySubscriberSnapshot, error)
}

// BoostySubscriberSnapshot — доменная проекция одной записи у Boosty.
// Независим от infra.BoostySubscriber чтобы app-слой не зависел от HTTP-layer'а.
type BoostySubscriberSnapshot struct {
	SubscriberID string
	Username     string
	TierName     string
	ExpiresAt    *time.Time
	IsActive     bool
}
