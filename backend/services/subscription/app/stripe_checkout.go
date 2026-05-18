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

// CreateCheckoutSession запускает Stripe Checkout flow:
//  1. lazy-create stripe_customer_id под user'а;
//  2. POST /v1/checkout/sessions через StripeClient;
//  3. return session_id + checkout_url для window.location redirect'а.
//
// DB write делается только для customer mapping; subscription row создаётся
// webhook'ом после реальной оплаты.
//
// Multi-currency: PriceIDs хранит per-ISO 4217 мапу; PriceID — fallback на
// default валюту. Caller передаёт ISO code в .Currency; UC резолвит price.
type CreateCheckoutSession struct {
	Repo    domain.StripeRepo
	Client  domain.StripeClient
	PriceID string // fallback price_id если PriceIDs не сматчился
	// PriceIDs — currency → stripe price_id. Bootstrap заполняет из env
	// STRIPE_PRICE_ID_PRO_RUB/_USD/_EUR; пустые значения исключаются.
	PriceIDs map[string]string
	// DefaultCurrency — fallback когда caller передал пустой .Currency.
	DefaultCurrency string
	Log             *slog.Logger
	// DefaultTrialDays — trial period для first-time subscribers если caller
	// не передал explicit value. 0 = no trial.
	DefaultTrialDays int
}

// defaultTrialDays — длительность trial Pro для first-time subscribers, если
// caller не передал explicit override.
const defaultTrialDays = 7

// defaultCheckoutCurrency — ISO 4217 currency code по умолчанию.
const defaultCheckoutCurrency = "RUB"

// NewCreateCheckoutSession — конструктор. priceID работает как fallback если
// per-currency price не сматчился; пустой priceID + пустые PriceIDs → Do
// возвращает ErrStripeNotConfigured.
func NewCreateCheckoutSession(repo domain.StripeRepo, client domain.StripeClient, priceID string, log *slog.Logger) *CreateCheckoutSession {
	if log == nil {
		panic("subscription.NewCreateCheckoutSession: logger is required")
	}
	return &CreateCheckoutSession{
		Repo:             repo,
		Client:           client,
		PriceID:          priceID,
		PriceIDs:         map[string]string{},
		DefaultCurrency:  defaultCheckoutCurrency,
		Log:              log,
		DefaultTrialDays: defaultTrialDays,
	}
}

// CreateCheckoutSessionInput — payload.
type CreateCheckoutSessionInput struct {
	UserID     uuid.UUID
	Email      string // optional, нужен Stripe только для receipt-mailing
	SuccessURL string
	CancelURL  string
	// PriceID перекрывает дефолт UC (для нестандартных tier'ов). Пусто = UC
	// сам резолвит через PriceIDs[Currency] → PriceID.
	PriceID string
	// TrialDays: >0 — принудительный trial; 0 — use UC default только для
	// first-time subscribers; <0 — принудительно без trial (re-subscribe).
	TrialDays int
	// Currency — ISO 4217 ("RUB"|"USD"|"EUR"). Пусто = UC.DefaultCurrency.
	// Если PriceID override задан — Currency игнорируется.
	Currency string
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
	priceID, currency := uc.resolvePrice(in)
	if priceID == "" {
		return CreateCheckoutSessionOutput{}, domain.ErrStripeNotConfigured
	}
	if strings.TrimSpace(in.SuccessURL) == "" || strings.TrimSpace(in.CancelURL) == "" {
		return CreateCheckoutSessionOutput{}, fmt.Errorf("subscription.CreateCheckoutSession: success_url and cancel_url required")
	}
	customer, err := uc.resolveCustomer(ctx, in.UserID, in.Email)
	if err != nil {
		return CreateCheckoutSessionOutput{}, err
	}
	trialDays := uc.resolveTrialDays(ctx, in)

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
		slog.Int("trial_days", trialDays),
		slog.String("currency", currency),
		slog.String("price_id", priceID))
	return CreateCheckoutSessionOutput{
		SessionID:   sess.SessionID,
		CheckoutURL: sess.CheckoutURL,
	}, nil
}

// resolvePrice — explicit PriceID > PriceIDs[currency] > UC.PriceID fallback.
func (uc *CreateCheckoutSession) resolvePrice(in CreateCheckoutSessionInput) (priceID, currency string) {
	priceID = strings.TrimSpace(in.PriceID)
	currency = strings.ToUpper(strings.TrimSpace(in.Currency))
	if priceID == "" {
		if currency == "" {
			currency = strings.ToUpper(strings.TrimSpace(uc.DefaultCurrency))
		}
		if currency != "" && len(uc.PriceIDs) > 0 {
			if p, ok := uc.PriceIDs[currency]; ok && strings.TrimSpace(p) != "" {
				priceID = strings.TrimSpace(p)
			}
		}
	}
	if priceID == "" {
		priceID = strings.TrimSpace(uc.PriceID)
	}
	return priceID, currency
}

// resolveCustomer — lookup customer, lazy-create через Stripe при ErrNotFound.
func (uc *CreateCheckoutSession) resolveCustomer(ctx context.Context, userID uuid.UUID, email string) (domain.StripeCustomer, error) {
	customer, cerr := uc.Repo.GetCustomer(ctx, userID)
	if cerr == nil {
		return customer, nil
	}
	if !errors.Is(cerr, domain.ErrNotFound) {
		return domain.StripeCustomer{}, fmt.Errorf("subscription.CreateCheckoutSession: get_customer: %w", cerr)
	}
	stripeCustomerID, err := uc.Client.CreateCustomer(ctx, userID, email)
	if err != nil {
		return domain.StripeCustomer{}, fmt.Errorf("subscription.CreateCheckoutSession: create_customer: %w", err)
	}
	customer = domain.StripeCustomer{UserID: userID, StripeCustomerID: stripeCustomerID}
	if err := uc.Repo.UpsertCustomer(ctx, customer); err != nil {
		return domain.StripeCustomer{}, fmt.Errorf("subscription.CreateCheckoutSession: upsert_customer: %w", err)
	}
	uc.Log.InfoContext(ctx, "subscription.stripe.customer_created",
		slog.String("user_id", userID.String()),
		slog.String("stripe_customer_id", stripeCustomerID))
	return customer, nil
}

// resolveTrialDays — explicit override > first-time default > 0. HasAnySubscription
// защищает от повторного «free N days» через cancel/re-subscribe abuse.
func (uc *CreateCheckoutSession) resolveTrialDays(ctx context.Context, in CreateCheckoutSessionInput) int {
	switch {
	case in.TrialDays < 0:
		return 0
	case in.TrialDays > 0:
		return in.TrialDays
	case uc.DefaultTrialDays > 0:
		had, herr := uc.Repo.HasAnySubscription(ctx, in.UserID)
		if herr != nil {
			uc.Log.WarnContext(ctx, "subscription.stripe.has_any_sub failed (skipping trial)",
				slog.String("user_id", in.UserID.String()),
				slog.Any("err", herr))
			return 0
		}
		if !had {
			return uc.DefaultTrialDays
		}
	}
	return 0
}
