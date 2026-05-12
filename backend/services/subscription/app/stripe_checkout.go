package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// CreateCheckoutSession — use-case для запуска Stripe Checkout flow.
// Pipeline:
//  1) resolve/create stripe_customer_id для юзера (lazy);
//  2) call StripeClient.CreateCheckoutSession с success/cancel URL'ами;
//  3) return session_id + checkout_url — фронт делает window.location =
//     checkout_url.
//
// При любом failure'е — error; фронт показывает toast «не удалось создать
// сессию». DB write делается ТОЛЬКО для customer mapping; subscription row
// создаётся webhook'ом после реальной оплаты.
type CreateCheckoutSession struct {
	Repo    domain.StripeRepo
	Client  domain.StripeClient
	PriceID string // env STRIPE_PRICE_ID_PRO_MONTHLY
	Log     *slog.Logger
	// DefaultTrialDays — fallback trial period for first-time subscribers
	// when caller doesn't pass an explicit value. 0 = no trial.
	// Поставлен Sergey'ем (2026-05-12) launch-polish: 7 дней.
	DefaultTrialDays int
}

// NewCreateCheckoutSession — конструктор. Все поля обязательны;
// если priceID пуст, UC возвращает ErrStripeNotConfigured на каждом Do.
func NewCreateCheckoutSession(repo domain.StripeRepo, client domain.StripeClient, priceID string, log *slog.Logger) *CreateCheckoutSession {
	if log == nil {
		panic("subscription.NewCreateCheckoutSession: logger is required")
	}
	return &CreateCheckoutSession{Repo: repo, Client: client, PriceID: priceID, Log: log, DefaultTrialDays: 7}
}

// CreateCheckoutSessionInput — payload.
type CreateCheckoutSessionInput struct {
	UserID     uuid.UUID
	Email      string // optional — Stripe принимает пустую строку, но email удобен для receipt'ов
	SuccessURL string
	CancelURL  string
	// PriceID опционально перекрывает default из UC (для Max tier в будущем).
	// Пусто = используется UC.PriceID.
	PriceID string
	// TrialDays — explicit per-request override. >0 = принудительный trial;
	// 0 = use UC default (только для first-time subscribers); <0 = принудительно
	// БЕЗ trial (используется для re-subscribe flow в будущем).
	TrialDays int
}

// CreateCheckoutSessionOutput — возврат UC.
type CreateCheckoutSessionOutput struct {
	SessionID   string
	CheckoutURL string
}

// Do — основной flow.
func (uc *CreateCheckoutSession) Do(ctx context.Context, in CreateCheckoutSessionInput) (CreateCheckoutSessionOutput, error) {
	if uc.Client == nil {
		return CreateCheckoutSessionOutput{}, domain.ErrStripeNotConfigured
	}
	priceID := strings.TrimSpace(in.PriceID)
	if priceID == "" {
		priceID = uc.PriceID
	}
	if priceID == "" {
		return CreateCheckoutSessionOutput{}, domain.ErrStripeNotConfigured
	}
	if strings.TrimSpace(in.SuccessURL) == "" || strings.TrimSpace(in.CancelURL) == "" {
		return CreateCheckoutSessionOutput{}, fmt.Errorf("subscription.CreateCheckoutSession: success_url and cancel_url required")
	}

	// 1) Resolve customer.
	customer, cerr := uc.Repo.GetCustomer(ctx, in.UserID)
	if cerr != nil && !errors.Is(cerr, domain.ErrNotFound) {
		return CreateCheckoutSessionOutput{}, fmt.Errorf("subscription.CreateCheckoutSession: get_customer: %w", cerr)
	}
	if errors.Is(cerr, domain.ErrNotFound) {
		stripeCustomerID, err := uc.Client.CreateCustomer(ctx, in.UserID, in.Email)
		if err != nil {
			return CreateCheckoutSessionOutput{}, fmt.Errorf("subscription.CreateCheckoutSession: create_customer: %w", err)
		}
		customer = domain.StripeCustomer{UserID: in.UserID, StripeCustomerID: stripeCustomerID}
		if err := uc.Repo.UpsertCustomer(ctx, customer); err != nil {
			return CreateCheckoutSessionOutput{}, fmt.Errorf("subscription.CreateCheckoutSession: upsert_customer: %w", err)
		}
		uc.Log.InfoContext(ctx, "subscription.stripe.customer_created",
			slog.String("user_id", in.UserID.String()),
			slog.String("stripe_customer_id", stripeCustomerID))
	}

	// 2) Resolve trial period. Priority: explicit caller override → default
	//    for first-time subscribers → 0. Negative override = no trial.
	trialDays := 0
	switch {
	case in.TrialDays < 0:
		// Caller явно отключает trial — re-subscribe / promo path.
		trialDays = 0
	case in.TrialDays > 0:
		// Caller pin'нул конкретный trial (e.g. promo код «14 дней»).
		trialDays = in.TrialDays
	case uc.DefaultTrialDays > 0:
		// First-time subscribers получают UC.DefaultTrialDays (7 by default).
		// HasAnySubscription пропустит trial если юзер раньше уже подписывался
		// (и возможно отменил) — чтобы избежать abuse повторного «free 7 days».
		had, herr := uc.Repo.HasAnySubscription(ctx, in.UserID)
		if herr != nil {
			uc.Log.WarnContext(ctx, "subscription.stripe.has_any_sub failed (skipping trial)",
				slog.String("user_id", in.UserID.String()),
				slog.Any("err", herr))
		} else if !had {
			trialDays = uc.DefaultTrialDays
		}
	}

	// 3) Create Checkout Session.
	sess, err := uc.Client.CreateCheckoutSession(ctx, domain.CreateCheckoutSessionInput{
		CustomerID: customer.StripeCustomerID,
		PriceID:    priceID,
		SuccessURL: in.SuccessURL,
		CancelURL:  in.CancelURL,
		UserID:     in.UserID,
		TrialDays:  trialDays,
	})
	if err != nil {
		return CreateCheckoutSessionOutput{}, fmt.Errorf("subscription.CreateCheckoutSession: stripe: %w", err)
	}
	uc.Log.InfoContext(ctx, "subscription.stripe.checkout_session_created",
		slog.String("user_id", in.UserID.String()),
		slog.String("session_id", sess.SessionID),
		slog.Int("trial_days", trialDays))
	return CreateCheckoutSessionOutput{
		SessionID:   sess.SessionID,
		CheckoutURL: sess.CheckoutURL,
	}, nil
}
