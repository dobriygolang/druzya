package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// HandleWebhookEvent — use-case для обработки Stripe webhook'ов. Pipeline:
//  1) VerifyWebhookSignature (Stripe-Signature header) — отклоняем без правильной HMAC;
//  2) parse event.type → один из supported types;
//  3) sync local stripe_subscriptions row;
//  4) call SetTier hook (paid Pro / Free).
//
// Поддерживаем event'ы:
//   - checkout.session.completed — первый успешный checkout. Создаём
//     stripe_subscriptions row + SetTier(Pro).
//   - customer.subscription.updated — изменение status / period_end /
//     cancel_at_period_end. Sync local row; SetTier(Pro) если active,
//     иначе ignore (deletion обрабатываем отдельно).
//   - customer.subscription.deleted — подписка полностью прекращена
//     (после period_end). SetTier(Free).
//   - charge.refunded — деньги вернули → flip немедленно в Free, не
//     дожидаясь period end. Delegate'ится в HandleRefund UC.
//
// Прочие event'ы (invoice.paid и т.п.) silently ignored — Stripe сам
// retry'ит если 5xx, поэтому мы возвращаем 200 для unsupported types.
type HandleWebhookEvent struct {
	Repo      domain.StripeRepo
	Client    domain.StripeClient
	SetTierUC *SetTier
	// RefundUC — optional. Обрабатывает charge.refunded. Nil-safe:
	// при отсутствии event silently игнорируется.
	RefundUC *HandleRefund
	Log      *slog.Logger
}

// NewHandleWebhookEvent — конструктор. SetTierUC обязателен; без него
// webhook'и нет смысла обрабатывать (нечем выдать tier).
func NewHandleWebhookEvent(repo domain.StripeRepo, client domain.StripeClient, setTier *SetTier, log *slog.Logger) *HandleWebhookEvent {
	if log == nil {
		panic("subscription.NewHandleWebhookEvent: logger is required")
	}
	return &HandleWebhookEvent{Repo: repo, Client: client, SetTierUC: setTier, Log: log}
}

// stripeEventEnvelope — общая обёртка для всех Stripe event'ов. Стрим парсит
// data.object потом отдельно по event.type.
type stripeEventEnvelope struct {
	ID   string `json:"id"`
	Type string `json:"type"`
	Data struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// stripeCheckoutSession — shape Stripe Checkout Session object (subset).
type stripeCheckoutSession struct {
	ID         string `json:"id"`
	Customer   string `json:"customer"`        // stripe customer_id
	Subscription string `json:"subscription"` // stripe sub_id (если mode=subscription)
	ClientReferenceID string `json:"client_reference_id"` // user_id (мы передаём)
	Metadata   map[string]string `json:"metadata"`
}

// stripeSubscription — shape Stripe Subscription object (subset).
type stripeSubscription struct {
	ID                string `json:"id"`
	Customer          string `json:"customer"`
	Status            string `json:"status"`
	CurrentPeriodEnd  int64  `json:"current_period_end"`  // unix
	CancelAtPeriodEnd bool   `json:"cancel_at_period_end"`
	Items             struct {
		Data []struct {
			Price struct {
				ID string `json:"id"`
			} `json:"price"`
		} `json:"data"`
	} `json:"items"`
	Metadata map[string]string `json:"metadata"`
}

// Do — точка входа из chi-handler. payload — raw body; sigHeader — Stripe-Signature
// header. Возвращает nil = 200; ErrInvalidWebhookSignature → 400; иное → 500.
func (uc *HandleWebhookEvent) Do(ctx context.Context, payload []byte, sigHeader string) error {
	if uc.Client == nil {
		return domain.ErrStripeNotConfigured
	}
	if err := uc.Client.VerifyWebhookSignature(payload, sigHeader); err != nil {
		return fmt.Errorf("subscription.HandleWebhookEvent: %w", err)
	}
	var env stripeEventEnvelope
	if err := json.Unmarshal(payload, &env); err != nil {
		return fmt.Errorf("subscription.HandleWebhookEvent: parse: %w", err)
	}
	uc.Log.InfoContext(ctx, "subscription.stripe.webhook",
		slog.String("event_id", env.ID),
		slog.String("event_type", env.Type))

	// Idempotency guard. Stripe retries 5xx ответ до 3-х суток; без dedup
	// table мы рискуем дважды зачислить tier на одну оплату. MarkWebhookSeen
	// INSERT'ит row в stripe_webhook_events; on conflict → (false, nil) →
	// мы возвращаем ack без side-effect'ов. Errors из MarkWebhookSeen
	// fall-through на handle pipeline (хуже дважды обработать чем потерять).
	if uc.Repo != nil && env.ID != "" {
		first, err := uc.Repo.MarkWebhookSeen(ctx, env.ID, env.Type)
		if err != nil {
			uc.Log.WarnContext(ctx, "subscription.stripe.webhook: dedup check failed",
				slog.String("event_id", env.ID),
				slog.Any("err", err))
		} else if !first {
			uc.Log.InfoContext(ctx, "subscription.stripe.webhook: duplicate, silent ack",
				slog.String("event_id", env.ID),
				slog.String("event_type", env.Type))
			return nil
		}
	}

	switch env.Type {
	case "checkout.session.completed":
		return uc.handleCheckoutCompleted(ctx, env.Data.Object)
	case "customer.subscription.updated", "customer.subscription.created":
		return uc.handleSubscriptionUpdated(ctx, env.Data.Object)
	case "customer.subscription.deleted":
		return uc.handleSubscriptionDeleted(ctx, env.Data.Object)
	case "charge.refunded":
		if uc.RefundUC == nil {
			uc.Log.WarnContext(ctx, "subscription.stripe.webhook: charge.refunded received but RefundUC is nil — silent ack")
			return nil
		}
		return uc.RefundUC.Do(ctx, env.Data.Object)
	default:
		// Unsupported event — silently ack to avoid Stripe retries.
		return nil
	}
}

// handleCheckoutCompleted — первое успешное создание подписки. Stripe
// присылает session object; subscription id уже там, но нам нужно его
// dereference чтобы получить price_id + status.
func (uc *HandleWebhookEvent) handleCheckoutCompleted(ctx context.Context, raw json.RawMessage) error {
	var sess stripeCheckoutSession
	if err := json.Unmarshal(raw, &sess); err != nil {
		return fmt.Errorf("subscription.handleCheckoutCompleted: parse: %w", err)
	}
	if sess.Subscription == "" {
		// One-off payment без subscription mode — для MVP не поддерживаем.
		uc.Log.WarnContext(ctx, "subscription.stripe.checkout: no subscription on session",
			slog.String("session_id", sess.ID))
		return nil
	}
	userID, err := resolveUserID(sess.ClientReferenceID, sess.Metadata)
	if err != nil {
		return fmt.Errorf("subscription.handleCheckoutCompleted: user_id: %w", err)
	}
	// Чем грузить /v1/subscriptions/:id отдельным запросом, ждём
	// customer.subscription.created/updated который Stripe прилетит
	// сразу следом и принесёт полный status + period_end. Здесь же
	// upsert'им только тонкую строку с known данными.
	now := time.Now().UTC()
	sub := domain.StripeSubscription{
		ID:                   uuid.New(),
		UserID:               userID,
		StripeSubscriptionID: sess.Subscription,
		StripePriceID:        "", // Will be filled by subsequent customer.subscription.updated event.
		Status:               "active",
		CreatedAt:            now,
		UpdatedAt:            now,
	}
	if err := uc.Repo.UpsertSubscription(ctx, sub); err != nil {
		return fmt.Errorf("subscription.handleCheckoutCompleted: upsert: %w", err)
	}
	// Кикнем SetTier(Pro) сразу — не ждём отдельного event'а.
	if uc.SetTierUC != nil {
		if err := uc.SetTierUC.Do(ctx, SetTierInput{
			UserID:        userID,
			Tier:          domain.TierPro,
			Provider:      domain.ProviderStripe,
			ProviderSubID: sess.Subscription,
			Reason:        "stripe checkout.session.completed",
		}); err != nil {
			uc.Log.WarnContext(ctx, "subscription.stripe.set_tier on checkout failed",
				slog.String("user_id", userID.String()),
				slog.Any("err", err))
		}
	}
	return nil
}

// handleSubscriptionUpdated — sync local row + flip Pro/Free based on status.
func (uc *HandleWebhookEvent) handleSubscriptionUpdated(ctx context.Context, raw json.RawMessage) error {
	var s stripeSubscription
	if err := json.Unmarshal(raw, &s); err != nil {
		return fmt.Errorf("subscription.handleSubscriptionUpdated: parse: %w", err)
	}
	userID, err := resolveUserID(s.Metadata["user_id"], s.Metadata)
	if err != nil {
		// Fallback: попробуем найти userID по stripe_customer_id через repo.
		// Если customer не найден, abort.
		uc.Log.WarnContext(ctx, "subscription.stripe.subscription_updated: no user_id in metadata",
			slog.String("stripe_subscription_id", s.ID))
		return nil
	}
	now := time.Now().UTC()
	var priceID string
	if len(s.Items.Data) > 0 {
		priceID = s.Items.Data[0].Price.ID
	}
	var cpe *time.Time
	if s.CurrentPeriodEnd > 0 {
		t := time.Unix(s.CurrentPeriodEnd, 0).UTC()
		cpe = &t
	}
	sub := domain.StripeSubscription{
		ID:                   uuid.New(),
		UserID:               userID,
		StripeSubscriptionID: s.ID,
		StripePriceID:        priceID,
		Status:               s.Status,
		CurrentPeriodEnd:     cpe,
		CancelAtPeriodEnd:    s.CancelAtPeriodEnd,
		UpdatedAt:            now,
	}
	if err := uc.Repo.UpsertSubscription(ctx, sub); err != nil {
		return fmt.Errorf("subscription.handleSubscriptionUpdated: upsert: %w", err)
	}
	// Active или trialing → Pro; иначе ничего не делаем (deletion обрабатывается отдельно).
	if uc.SetTierUC != nil && (s.Status == "active" || s.Status == "trialing") {
		if err := uc.SetTierUC.Do(ctx, SetTierInput{
			UserID:           userID,
			Tier:             domain.TierPro,
			Provider:         domain.ProviderStripe,
			ProviderSubID:    s.ID,
			CurrentPeriodEnd: cpe,
			Reason:           "stripe customer.subscription.updated",
		}); err != nil {
			uc.Log.WarnContext(ctx, "subscription.stripe.set_tier on update failed",
				slog.String("user_id", userID.String()),
				slog.Any("err", err))
		}
	}
	return nil
}

// handleSubscriptionDeleted — sub полностью прекращена. SetTier(Free).
func (uc *HandleWebhookEvent) handleSubscriptionDeleted(ctx context.Context, raw json.RawMessage) error {
	var s stripeSubscription
	if err := json.Unmarshal(raw, &s); err != nil {
		return fmt.Errorf("subscription.handleSubscriptionDeleted: parse: %w", err)
	}
	userID, err := resolveUserID(s.Metadata["user_id"], s.Metadata)
	if err != nil {
		uc.Log.WarnContext(ctx, "subscription.stripe.subscription_deleted: no user_id in metadata",
			slog.String("stripe_subscription_id", s.ID))
		return nil
	}
	now := time.Now().UTC()
	sub := domain.StripeSubscription{
		ID:                   uuid.New(),
		UserID:               userID,
		StripeSubscriptionID: s.ID,
		StripePriceID:        "",
		Status:               "canceled",
		UpdatedAt:            now,
	}
	if err := uc.Repo.UpsertSubscription(ctx, sub); err != nil {
		return fmt.Errorf("subscription.handleSubscriptionDeleted: upsert: %w", err)
	}
	if uc.SetTierUC != nil {
		if err := uc.SetTierUC.Do(ctx, SetTierInput{
			UserID:        userID,
			Tier:          domain.TierFree,
			Provider:      domain.ProviderStripe,
			ProviderSubID: s.ID,
			Reason:        "stripe customer.subscription.deleted",
		}); err != nil {
			uc.Log.WarnContext(ctx, "subscription.stripe.set_tier on delete failed",
				slog.String("user_id", userID.String()),
				slog.Any("err", err))
		}
	}
	return nil
}

// resolveUserID извлекает user_id из Stripe payload'а. Source priority:
//  1. clientReferenceID (Stripe Checkout Session field — мы передаём при create);
//  2. metadata["user_id"] (для customer.subscription.* events).
//
// Возвращает ErrNotFound если ни один источник не валиден.
func resolveUserID(clientRef string, metadata map[string]string) (uuid.UUID, error) {
	candidates := []string{clientRef}
	if metadata != nil {
		candidates = append(candidates, metadata["user_id"])
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if id, err := uuid.Parse(c); err == nil {
			return id, nil
		}
	}
	return uuid.Nil, errors.New("no valid user_id in webhook payload")
}
