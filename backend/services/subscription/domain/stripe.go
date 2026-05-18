//go:generate mockgen -package mocks -destination mocks/stripe_mock.go -source stripe.go
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// StripeCustomer — проекция строки stripe_customers. Хранится один-к-одному
// с user_id; stripe_customer_id создаётся lazy на первом checkout.
type StripeCustomer struct {
	UserID           uuid.UUID
	StripeCustomerID string
	CreatedAt        time.Time
}

// StripeSubscription — проекция строки stripe_subscriptions. Хранит local
// snapshot стрипового state'а: webhook'и обновляют status / cancel_at_period_end
// / current_period_end. Это НЕ subscriptions table (canonical tier) — это
// зеркало стрипа для cancel-flow + idempotency webhook'ов.
type StripeSubscription struct {
	ID                   uuid.UUID
	UserID               uuid.UUID
	StripeSubscriptionID string
	StripePriceID        string
	Status               string // 'active'|'trialing'|'past_due'|'canceled'|'incomplete'
	CurrentPeriodEnd     *time.Time
	CancelAtPeriodEnd    bool
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// StripeRepo — persistence port для Stripe state. Postgres adapter в
// infra/stripe_repo.go.
type StripeRepo interface {
	// GetCustomer возвращает stripe_customer_id для юзера или ErrNotFound.
	GetCustomer(ctx context.Context, userID uuid.UUID) (StripeCustomer, error)

	// UpsertCustomer — идемпотентная запись по user_id. Lazy-create на первом
	// checkout. Stripe customer_id уникален; дубликаты падают на unique constraint.
	UpsertCustomer(ctx context.Context, c StripeCustomer) error

	// UpsertSubscription — идемпотентная запись по stripe_subscription_id.
	// Webhook'и обновляют status/period_end через этот метод.
	UpsertSubscription(ctx context.Context, s StripeSubscription) error

	// GetActiveSubscriptionByUser — последняя active/trialing подписка юзера.
	// ErrNotFound если у юзера нет подписок.
	GetActiveSubscriptionByUser(ctx context.Context, userID uuid.UUID) (StripeSubscription, error)

	// GetSubscriptionByStripeID — lookup по stripe_subscription_id для refund/
	// audit flow'ов. ErrNotFound если webhook прилетел до того как мы записали row.
	GetSubscriptionByStripeID(ctx context.Context, stripeSubID string) (StripeSubscription, error)

	// HasAnySubscription — true если у юзера когда-либо была подписка (включая
	// canceled). Гейтит «first-time trial» от cancel/re-subscribe abuse'а.
	HasAnySubscription(ctx context.Context, userID uuid.UUID) (bool, error)

	// MarkWebhookSeen — idempotency guard. (true, nil) — первый раз; (false, nil)
	// — event уже видели (silent skip).
	MarkWebhookSeen(ctx context.Context, eventID, eventType string) (bool, error)
}

// StripeClient — клиент к Stripe API. Реализация в infra/stripe_client.go
// (pure-stdlib HTTP — не тянем stripe-go в зависимости). Все методы
// принимают context и возвращают типизированные результаты.
type StripeClient interface {
	// CreateCheckoutSession создаёт новый Checkout Session в Stripe.
	// Возвращает session_id + checkout_url (куда редиректить юзера).
	CreateCheckoutSession(ctx context.Context, in CreateCheckoutSessionInput) (CheckoutSession, error)

	// CreateCustomer регистрирует юзера в Stripe (для customer.id). Email
	// опционален — Stripe принимает пустую строку. Возвращает stripe customer_id.
	CreateCustomer(ctx context.Context, userID uuid.UUID, email string) (string, error)

	// UpdateSubscription — для cancel-at-period-end flow'а (PATCH /v1/subscriptions/:id
	// с cancel_at_period_end=true).
	UpdateSubscriptionCancelAtPeriodEnd(ctx context.Context, subID string, cancel bool) error

	// VerifyWebhookSignature проверяет HMAC-SHA256 signature header'а
	// Stripe-Signature против тела запроса + STRIPE_WEBHOOK_SECRET.
	// Возвращает nil если подпись валидна; иначе ErrInvalidWebhookSignature.
	VerifyWebhookSignature(payload []byte, sigHeader string) error

	// RetrieveCheckoutSession — GET /v1/checkout/sessions/{id}. Используется
	// /billing/welcome verify-endpoint'ом чтобы подтвердить факт оплаты
	// клиенту, не дожидаясь webhook'а. Возвращает ErrNotFound если session
	// не существует.
	RetrieveCheckoutSession(ctx context.Context, sessionID string) (CheckoutSessionDetails, error)
}

// CreateCheckoutSessionInput — payload для StripeClient.CreateCheckoutSession.
type CreateCheckoutSessionInput struct {
	CustomerID string // stripe_customer_id (предварительно созданный)
	PriceID    string // stripe price id (env STRIPE_PRICE_ID_PRO_MONTHLY)
	SuccessURL string // absolute URL — куда Stripe редиректит после оплаты
	CancelURL  string // absolute URL — куда после cancel/back
	UserID     uuid.UUID
	// TrialDays — если >0, передаётся в Stripe как subscription_data
	// .trial_period_days. Юзер не платит до конца trial'а; webhook
	// customer.subscription.updated отметит status='trialing' который
	// flip'нет tier в Pro как обычно.
	TrialDays int
}

// CheckoutSession — ответ от Stripe POST /v1/checkout/sessions.
type CheckoutSession struct {
	SessionID   string
	CheckoutURL string
}

// CheckoutSessionDetails — projection Stripe Checkout Session для verify-
// endpoint'а /billing/welcome. Поля сужены до того, что нужно frontend'у —
// не expose'им весь Stripe payload зря.
type CheckoutSessionDetails struct {
	SessionID string
	// PaymentStatus — Stripe-канонический: "paid"|"unpaid"|"no_payment_required".
	PaymentStatus string
	// Status — overall session status: "open"|"complete"|"expired".
	Status string
	// AmountTotal — total in minor units (копейки/центы).
	AmountTotal int64
	// Currency — ISO-3 lowercase ("rub"/"usd"/"eur").
	Currency string
	// CustomerEmail — введённый юзером email на странице Stripe. Может быть
	// пустым если customer был передан pre-authenticated без email'а.
	CustomerEmail string
	// SubscriptionID — Stripe subscription id (если session subscription-mode).
	// Используется для резолва period_end если webhook уже синкнул row.
	SubscriptionID string
	// ClientReferenceID — наш user_id, который мы передавали при create'е.
	ClientReferenceID string
}
