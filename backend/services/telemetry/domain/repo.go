package domain

import (
	"context"

	"github.com/google/uuid"
)

// EventRepo — write-side port. Read-side (admin queries, aggregations)
// доступен через прямой SQL роли — нет необходимости в repo interface для
// write hot path.
type EventRepo interface {
	// InsertBatch persists список events одной транзакцией. Returns count
	// инсертированных rows (всегда == len(events) в текущей impl, но контракт
	// допускает partial когда добавится batch validation на уровне DB).
	InsertBatch(ctx context.Context, events []Event) (int, error)

	// ListByUser возвращает все events пользователя (optional surface
	// filter). Используется ExportEvents (GDPR data download).
	ListByUser(ctx context.Context, userID uuid.UUID, surface Surface) ([]Event, error)

	// DeleteByUser удаляет все events пользователя (optional surface
	// filter). Returns deleted count. Используется DeleteEvents
	// (GDPR data delete).
	DeleteByUser(ctx context.Context, userID uuid.UUID, surface Surface) (int, error)
}

// ConsentRepo — port для opt-in choice store. Mirror'ом не маемся —
// telemetry_consent table маленькая (< 1 row per user per surface),
// прямой read на каждый event ok. Если станет hot path — добавим
// Redis cache (deferred).
type ConsentRepo interface {
	// Get возвращает Consent для пары (user, surface). Возвращает (Consent{},
	// false, nil) когда row не существует (default semantics).
	Get(ctx context.Context, userID uuid.UUID, surface Surface) (Consent, bool, error)
	// Upsert сохраняет согласие.
	Upsert(ctx context.Context, c Consent) error
}

// AnalyticsSink — fanout-port для зеркалирования events в external
// product-analytics provider (PostHog free tier). NoopSink реализован
// в infra и используется когда POSTHOG_API_KEY="".
//
// Anti-fallback: errors не суммируем в RecordEventsUC return — sink — это
// best-effort secondary path, primary это local INSERT. Errors логируются
// для discovery, не пробрасываются клиенту.
type AnalyticsSink interface {
	// Track зеркалит batch events. Реализация должна быть non-blocking
	// (буфер + background flush) или fast enough чтобы не блокировать
	// hot path RecordEvents. PostHog SDK уже buffer'ит — мы просто
	// EnqueueEvent'ом отдаём batch.
	Track(ctx context.Context, events []Event) error
	// DeleteUser — best-effort GDPR pass-through. Когда юзер жмёт
	// «Удалить мои события» мы вызываем это чтобы remote vendor тоже
	// чистил copy. Returns nil даже если provider не поддерживает delete
	// (некоторые free-tier'ы — read-only из API).
	DeleteUser(ctx context.Context, anonymizedID string) error
}

// IDAnonymizer обернёт raw uuid в стабильный hash для PostHog distinct_id.
// HMAC-SHA256 с deploy-specific salt — без знания соли PostHog не может
// сопоставить distinct_id с DB user.id. Implementation в infra/anon.go.
type IDAnonymizer interface {
	Anonymize(userID uuid.UUID) string
}
