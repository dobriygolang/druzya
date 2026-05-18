// handle_refund.go — Stripe charge.refunded handler. Отличие от subscription
// .deleted: refund flip'ает tier в Free немедленно (не ждёт period_end), и
// local stripe_subscriptions row помечается status='refunded' чтобы reporting
// видел отличие от обычного cancel'а.
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

// resolveUserID находит user_id привязанный к refund'у. Источники:
//  1. metadata["user_id"] — мы set'аем при checkout.
//  2. reverse lookup stripe_customer_id → user_id через optional interface.
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
	// Reverse lookup через extension interface — этот метод нужен только
	// здесь, не выносим в StripeRepo чтобы не плодить mock-методы для callers,
	// которым он не нужен.
	finder, ok := uc.Repo.(stripeCustomerByIDFinder)
	if !ok {
		return uuid.Nil, errors.New("user not found by customer_id")
	}
	userID, err := finder.GetCustomerByStripeID(ctx, ch.Customer)
	if err == nil {
		return userID, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return uuid.Nil, fmt.Errorf("lookup customer: %w", err)
	}
	return uuid.Nil, errors.New("user not found by customer_id")
}

// stripeCustomerByIDFinder — extension interface для reverse lookup'а.
// Реализовано в infra/stripe_repo.go.
type stripeCustomerByIDFinder interface {
	GetCustomerByStripeID(ctx context.Context, stripeCustomerID string) (uuid.UUID, error)
}
