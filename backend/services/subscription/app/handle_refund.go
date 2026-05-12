// handle_refund.go — обработка charge.refunded Stripe webhook'а. Pivot
// vs handleSubscriptionDeleted: refund != cancellation.
//
//   - customer.subscription.deleted = «период закончился, Pro истёк» →
//     tier flip уже либо отработан cron'ом MarkExpired, либо webhook
//     handler сам flip'нет в Free at period_end (естественный конец).
//
//   - charge.refunded = «верните деньги» → flip немедленно в Free,
//     не дожидаясь period end. Деньги вернули — Pro доступ ушёл сразу.
//     Local row помечается status='refunded' чтобы reporting видел
//     отличие от cancel'а.
//
// Stripe payload (subset):
//
//	{
//	  "type": "charge.refunded",
//	  "data": { "object": {
//	    "id": "ch_...",                 // charge id
//	    "customer": "cus_...",          // stripe customer
//	    "invoice": "in_...",            // optional — связь с subscription
//	    "metadata": { "user_id": "..." }
//	  }}
//	}
//
// invoice ↔ subscription mapping не в payload'е — но мы храним user_id
// в stripe_customers (lazy-create на checkout), плюс metadata.user_id
// почти всегда есть (мы set'аем при create). Этого достаточно для
// резолва владельца refund'а без дополнительного API-call'а.
//
// Эффект на user-facing:
//   - subscriptions row: tier=free, status=expired, provider=stripe
//   - stripe_subscriptions row (если есть): status='refunded'
//   - audit log запись через SetTierUC.Reason

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// HandleRefund — UC для обработки charge.refunded.
type HandleRefund struct {
	Repo      domain.StripeRepo
	SetTierUC *SetTier
	Log       *slog.Logger
}

// NewHandleRefund — конструктор.
func NewHandleRefund(repo domain.StripeRepo, setTier *SetTier, log *slog.Logger) *HandleRefund {
	if log == nil {
		panic("subscription.NewHandleRefund: logger is required")
	}
	return &HandleRefund{Repo: repo, SetTierUC: setTier, Log: log}
}

// stripeCharge — shape Stripe Charge object (subset для refund handling).
type stripeCharge struct {
	ID                 string            `json:"id"`
	Customer           string            `json:"customer"`
	Invoice            string            `json:"invoice"`
	PaymentIntent      string            `json:"payment_intent"`
	Refunded           bool              `json:"refunded"`
	AmountRefunded     int64             `json:"amount_refunded"`
	Currency           string            `json:"currency"`
	Status             string            `json:"status"`
	Metadata           map[string]string `json:"metadata"`
	BillingDetails     struct {
		Email string `json:"email"`
	} `json:"billing_details"`
}

// Do — handles charge.refunded event. Pipeline:
//  1. Parse charge object.
//  2. Resolve user_id (metadata → invoice → customer lookup).
//  3. Find latest stripe subscription for user (если есть) → mark refunded.
//  4. SetTierUC flip → Free with reason='stripe charge.refunded'.
//
// Если user_id не удаётся резолвить — log warn, return nil (не блокируем
// retry-shower; Stripe не повторит, потому что MarkWebhookSeen уже
// отметил event как seen).
func (uc *HandleRefund) Do(ctx context.Context, raw json.RawMessage) error {
	var ch stripeCharge
	if err := json.Unmarshal(raw, &ch); err != nil {
		return fmt.Errorf("subscription.HandleRefund: parse: %w", err)
	}
	if !ch.Refunded && ch.AmountRefunded <= 0 {
		// Partial-refund event without flag set — Stripe в этом случае всё
		// равно может прислать charge.refunded. Если ничего не возвращено,
		// nothing to do.
		uc.Log.InfoContext(ctx, "subscription.stripe.refund: zero-amount, skip",
			slog.String("charge_id", ch.ID))
		return nil
	}
	userID, err := uc.resolveUserID(ctx, ch)
	if err != nil {
		uc.Log.WarnContext(ctx, "subscription.stripe.refund: cannot resolve user_id",
			slog.String("charge_id", ch.ID),
			slog.String("customer_id", ch.Customer),
			slog.Any("err", err))
		return nil
	}

	// Lookup активной Stripe subscription (best-effort — для refund'а мы
	// сначала flip'аем tier, потом обновляем зеркальную row).
	if sub, gErr := uc.Repo.GetActiveSubscriptionByUser(ctx, userID); gErr == nil {
		sub.Status = "refunded"
		sub.CancelAtPeriodEnd = true
		if err := uc.Repo.UpsertSubscription(ctx, sub); err != nil {
			uc.Log.WarnContext(ctx, "subscription.stripe.refund: local mirror failed",
				slog.String("user_id", userID.String()),
				slog.String("stripe_subscription_id", sub.StripeSubscriptionID),
				slog.Any("err", err))
		}
	} else if !errors.Is(gErr, domain.ErrNotFound) {
		uc.Log.WarnContext(ctx, "subscription.stripe.refund: lookup active sub failed",
			slog.String("user_id", userID.String()),
			slog.Any("err", gErr))
	}

	// Flip tier → Free немедленно. Refund = деньги вернули = доступ ушёл.
	if uc.SetTierUC != nil {
		if err := uc.SetTierUC.Do(ctx, SetTierInput{
			UserID:   userID,
			Tier:     domain.TierFree,
			Provider: domain.ProviderStripe,
			Reason:   fmt.Sprintf("stripe charge.refunded charge=%s amount=%d %s", ch.ID, ch.AmountRefunded, strings.ToUpper(ch.Currency)),
		}); err != nil {
			return fmt.Errorf("subscription.HandleRefund: set_tier: %w", err)
		}
	}
	uc.Log.InfoContext(ctx, "subscription.stripe.refunded",
		slog.String("user_id", userID.String()),
		slog.String("charge_id", ch.ID),
		slog.Int64("amount_refunded", ch.AmountRefunded),
		slog.String("currency", strings.ToUpper(ch.Currency)))
	return nil
}

// resolveUserID находит user_id, привязанный к refund'у. Source priority:
//  1. metadata["user_id"] — если мы set'нули при checkout.
//  2. customer lookup в stripe_customers — устойчивее всего.
func (uc *HandleRefund) resolveUserID(ctx context.Context, ch stripeCharge) (uuid.UUID, error) {
	if ch.Metadata != nil {
		if v := strings.TrimSpace(ch.Metadata["user_id"]); v != "" {
			if id, err := uuid.Parse(v); err == nil {
				return id, nil
			}
		}
	}
	if ch.Customer == "" {
		return uuid.Nil, errors.New("no stripe customer on charge")
	}
	// Reverse lookup: stripe_customers.stripe_customer_id → user_id.
	// Repo не expose'ит этот метод напрямую (lazy add); используем
	// GetActiveSubscriptionByUser нет — нам нужен customer-id reverse.
	// Поэтому добавляем тонкий обходной путь через стандартный SQL —
	// инжектим через StripeRepo. Pattern: если в будущем понадобится
	// шире — добавим GetCustomerByStripeID в port.
	if finder, ok := uc.Repo.(stripeCustomerByIDFinder); ok {
		userID, err := finder.GetCustomerByStripeID(ctx, ch.Customer)
		if err == nil {
			return userID, nil
		}
		if !errors.Is(err, domain.ErrNotFound) {
			return uuid.Nil, fmt.Errorf("lookup customer: %w", err)
		}
	}
	return uuid.Nil, errors.New("user not found by customer_id")
}

// stripeCustomerByIDFinder — narrow port для reverse-lookup'а. Implemented
// в infra/stripe_repo.go. Отдельный optional-interface чтобы не ломать
// signature StripeRepo для тех, кто не использует HandleRefund.
type stripeCustomerByIDFinder interface {
	GetCustomerByStripeID(ctx context.Context, stripeCustomerID string) (uuid.UUID, error)
}
