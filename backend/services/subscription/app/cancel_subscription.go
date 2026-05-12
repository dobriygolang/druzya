package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// CancelSubscription — use-case для прекращения автопродления подписки.
// Stripe не отменяет немедленно — выставляет cancel_at_period_end=true.
// До CurrentPeriodEnd юзер сохраняет Pro доступ; после — webhook
// customer.subscription.deleted прилетит и SetTier откатит в Free.
//
// Idempotent: повторный вызов после cancel'а тоже не error (Stripe вернёт
// успешно для уже отменённой подписки).
type CancelSubscription struct {
	Repo   domain.StripeRepo
	Client domain.StripeClient
	Log    *slog.Logger
}

// NewCancelSubscription — конструктор.
func NewCancelSubscription(repo domain.StripeRepo, client domain.StripeClient, log *slog.Logger) *CancelSubscription {
	if log == nil {
		panic("subscription.NewCancelSubscription: logger is required")
	}
	return &CancelSubscription{Repo: repo, Client: client, Log: log}
}

// Do — основной flow.
//   - находит последнюю active/trialing подписку юзера;
//   - вызывает Stripe API PATCH /v1/subscriptions/:id { cancel_at_period_end: true };
//   - mirror'ит cancel_at_period_end в local row (webhook позже подтвердит).
//
// Если active подписки нет (ErrNotFound) — возвращает success (no-op).
// Это покрывает кейс «юзер уже отменил» / «юзер на admin grant Pro».
func (uc *CancelSubscription) Do(ctx context.Context, userID uuid.UUID) error {
	if uc.Client == nil {
		return domain.ErrStripeNotConfigured
	}
	sub, err := uc.Repo.GetActiveSubscriptionByUser(ctx, userID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			// No active Stripe sub — nothing to cancel. Idempotent ok.
			uc.Log.InfoContext(ctx, "subscription.stripe.cancel_noop",
				slog.String("user_id", userID.String()))
			return nil
		}
		return fmt.Errorf("subscription.CancelSubscription: get_active: %w", err)
	}
	if err := uc.Client.UpdateSubscriptionCancelAtPeriodEnd(ctx, sub.StripeSubscriptionID, true); err != nil {
		return fmt.Errorf("subscription.CancelSubscription: stripe: %w", err)
	}
	sub.CancelAtPeriodEnd = true
	if err := uc.Repo.UpsertSubscription(ctx, sub); err != nil {
		// Stripe уже принял cancel — log warn, не откатываем UX.
		uc.Log.WarnContext(ctx, "subscription.stripe.cancel: local mirror failed",
			slog.String("user_id", userID.String()),
			slog.String("stripe_subscription_id", sub.StripeSubscriptionID),
			slog.Any("err", err))
	}
	uc.Log.InfoContext(ctx, "subscription.stripe.cancel_at_period_end",
		slog.String("user_id", userID.String()),
		slog.String("stripe_subscription_id", sub.StripeSubscriptionID))
	return nil
}
