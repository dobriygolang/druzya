// stripe_client.go — pure-stdlib HTTP-клиент к Stripe API. Без stripe-go
// dependency — нам нужно три endpoint'а (POST /v1/customers, POST /v1/checkout/
// sessions, POST /v1/subscriptions/:id) + webhook signature verification.
package infra

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// StripeClient — HTTP-клиент к https://api.stripe.com.
type StripeClient struct {
	SecretKey     string
	WebhookSecret string
	HTTP          *http.Client
	BaseURL       string // override для тестов; пуст = "https://api.stripe.com"
}

// NewStripeClient — конструктор. Timeout 10s — Stripe обычно отвечает <1s,
// но для cold endpoint'ов даём запас.
func NewStripeClient(secretKey, webhookSecret string) *StripeClient {
	return &StripeClient{
		SecretKey:     secretKey,
		WebhookSecret: webhookSecret,
		HTTP:          &http.Client{Timeout: 10 * time.Second},
		BaseURL:       "https://api.stripe.com",
	}
}

// Compile-time check.
var _ domain.StripeClient = (*StripeClient)(nil)

// CreateCustomer — POST /v1/customers с email + metadata[user_id].
func (c *StripeClient) CreateCustomer(ctx context.Context, userID uuid.UUID, email string) (string, error) {
	form := url.Values{}
	form.Set("metadata[user_id]", userID.String())
	if email != "" {
		form.Set("email", email)
	}
	var resp struct {
		ID string `json:"id"`
	}
	if err := c.postForm(ctx, "/v1/customers", form, &resp); err != nil {
		return "", err
	}
	if resp.ID == "" {
		return "", fmt.Errorf("%w: empty customer id", domain.ErrStripeAPI)
	}
	return resp.ID, nil
}

// CreateCheckoutSession — POST /v1/checkout/sessions с mode=subscription.
// client_reference_id = user_id (UUID) — стрим echo'нёт это в webhook,
// чтобы мы могли резолвить user_id без отдельного lookup'а.
func (c *StripeClient) CreateCheckoutSession(ctx context.Context, in domain.CreateCheckoutSessionInput) (domain.CheckoutSession, error) {
	form := url.Values{}
	form.Set("mode", "subscription")
	form.Set("customer", in.CustomerID)
	form.Set("success_url", in.SuccessURL)
	form.Set("cancel_url", in.CancelURL)
	form.Set("line_items[0][price]", in.PriceID)
	form.Set("line_items[0][quantity]", "1")
	if in.UserID != uuid.Nil {
		form.Set("client_reference_id", in.UserID.String())
		form.Set("metadata[user_id]", in.UserID.String())
		// Зеркало в subscription_data.metadata — Stripe прокинет в subscription
		// object metadata, что мы прочитаем в webhook handler'е.
		form.Set("subscription_data[metadata][user_id]", in.UserID.String())
	}
	// Trial period — Stripe принимает 1..730 дней. >0 = trial, status
	// 'trialing' до конца trial'а; CPE = trial_end.
	if in.TrialDays > 0 {
		form.Set("subscription_data[trial_period_days]", strconv.Itoa(in.TrialDays))
	}
	var resp struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := c.postForm(ctx, "/v1/checkout/sessions", form, &resp); err != nil {
		return domain.CheckoutSession{}, err
	}
	if resp.ID == "" || resp.URL == "" {
		return domain.CheckoutSession{}, fmt.Errorf("%w: missing session id or url", domain.ErrStripeAPI)
	}
	return domain.CheckoutSession{SessionID: resp.ID, CheckoutURL: resp.URL}, nil
}

// RetrieveCheckoutSession — GET /v1/checkout/sessions/:id. Используется
// /billing/welcome verify endpoint'ом: подтверждает оплату на момент когда
// webhook checkout.session.completed ещё мог не долететь (Stripe иногда
// шлёт его через 1-2с после redirect'а). Не валит на 404 — клиент
// маппит ErrNotFound в Unavailable («Subscription is processing...»).
func (c *StripeClient) RetrieveCheckoutSession(ctx context.Context, sessionID string) (domain.CheckoutSessionDetails, error) {
	if sessionID == "" {
		return domain.CheckoutSessionDetails{}, fmt.Errorf("%w: empty session id", domain.ErrStripeAPI)
	}
	var resp struct {
		ID                string `json:"id"`
		PaymentStatus     string `json:"payment_status"`
		Status            string `json:"status"`
		AmountTotal       int64  `json:"amount_total"`
		Currency          string `json:"currency"`
		CustomerEmail     string `json:"customer_email"`
		CustomerDetails   struct {
			Email string `json:"email"`
		} `json:"customer_details"`
		Subscription      string `json:"subscription"`
		ClientReferenceID string `json:"client_reference_id"`
	}
	if err := c.getJSON(ctx, "/v1/checkout/sessions/"+url.PathEscape(sessionID), &resp); err != nil {
		return domain.CheckoutSessionDetails{}, err
	}
	if resp.ID == "" {
		return domain.CheckoutSessionDetails{}, domain.ErrNotFound
	}
	email := resp.CustomerEmail
	if email == "" {
		email = resp.CustomerDetails.Email
	}
	return domain.CheckoutSessionDetails{
		SessionID:         resp.ID,
		PaymentStatus:     resp.PaymentStatus,
		Status:            resp.Status,
		AmountTotal:       resp.AmountTotal,
		Currency:          resp.Currency,
		CustomerEmail:     email,
		SubscriptionID:    resp.Subscription,
		ClientReferenceID: resp.ClientReferenceID,
	}, nil
}

// UpdateSubscriptionCancelAtPeriodEnd — POST /v1/subscriptions/:id с
// cancel_at_period_end. Stripe принимает POST (не PATCH) для update'ов.
func (c *StripeClient) UpdateSubscriptionCancelAtPeriodEnd(ctx context.Context, subID string, cancel bool) error {
	if subID == "" {
		return fmt.Errorf("%w: empty subscription id", domain.ErrStripeAPI)
	}
	form := url.Values{}
	form.Set("cancel_at_period_end", strconv.FormatBool(cancel))
	var resp struct {
		ID string `json:"id"`
	}
	if err := c.postForm(ctx, "/v1/subscriptions/"+url.PathEscape(subID), form, &resp); err != nil {
		return err
	}
	return nil
}

// VerifyWebhookSignature — реализация Stripe webhook signature scheme.
// Header формат: t=<timestamp>,v1=<hex(hmac-sha256(t.payload, secret))>.
// См. https://stripe.com/docs/webhooks/signatures.
//
// Tolerance: 5 минут — стандарт Stripe. Старые/будущие timestamp'ы отвергаем
// чтобы replay-атака не работала вне окна.
func (c *StripeClient) VerifyWebhookSignature(payload []byte, sigHeader string) error {
	if c.WebhookSecret == "" {
		return fmt.Errorf("%w: webhook secret not configured", domain.ErrInvalidWebhookSignature)
	}
	if sigHeader == "" {
		return domain.ErrInvalidWebhookSignature
	}
	var (
		timestamp string
		sigs      []string
	)
	for _, part := range strings.Split(sigHeader, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "t":
			timestamp = kv[1]
		case "v1":
			sigs = append(sigs, kv[1])
		}
	}
	if timestamp == "" || len(sigs) == 0 {
		return domain.ErrInvalidWebhookSignature
	}
	tsUnix, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return domain.ErrInvalidWebhookSignature
	}
	if delta := time.Since(time.Unix(tsUnix, 0)); delta > 5*time.Minute || delta < -5*time.Minute {
		return fmt.Errorf("%w: timestamp out of tolerance", domain.ErrInvalidWebhookSignature)
	}
	signedPayload := timestamp + "." + string(payload)
	mac := hmac.New(sha256.New, []byte(c.WebhookSecret))
	_, _ = mac.Write([]byte(signedPayload))
	expected := hex.EncodeToString(mac.Sum(nil))
	for _, sig := range sigs {
		if subtle.ConstantTimeCompare([]byte(sig), []byte(expected)) == 1 {
			return nil
		}
	}
	return domain.ErrInvalidWebhookSignature
}

// getJSON — внутренний helper для GET запросов к Stripe. Аналог postForm,
// но без body. Stripe возвращает JSON, парсим в out.
func (c *StripeClient) getJSON(ctx context.Context, path string, out any) error {
	if c.SecretKey == "" {
		return fmt.Errorf("%w: secret key not configured", domain.ErrStripeAPI)
	}
	base := c.BaseURL
	if base == "" {
		base = "https://api.stripe.com"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if err != nil {
		return fmt.Errorf("%w: build req: %v", domain.ErrStripeAPI, err)
	}
	req.Header.Set("authorization", "Bearer "+c.SecretKey)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("%w: http: %v", domain.ErrStripeAPI, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		return domain.ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errResp struct {
			Error struct {
				Message string `json:"message"`
				Type    string `json:"type"`
				Code    string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &errResp)
		return fmt.Errorf("%w: %d %s (%s)", domain.ErrStripeAPI, resp.StatusCode, errResp.Error.Message, errResp.Error.Code)
	}
	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("%w: parse: %v", domain.ErrStripeAPI, err)
		}
	}
	return nil
}

// postForm — внутренний helper для POST x-www-form-urlencoded запросов
// (Stripe API не принимает JSON, только form-encoded).
func (c *StripeClient) postForm(ctx context.Context, path string, form url.Values, out any) error {
	if c.SecretKey == "" {
		return fmt.Errorf("%w: secret key not configured", domain.ErrStripeAPI)
	}
	base := c.BaseURL
	if base == "" {
		base = "https://api.stripe.com"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+path, bytes.NewBufferString(form.Encode()))
	if err != nil {
		return fmt.Errorf("%w: build req: %v", domain.ErrStripeAPI, err)
	}
	req.Header.Set("authorization", "Bearer "+c.SecretKey)
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("%w: http: %v", domain.ErrStripeAPI, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Парсим Stripe error для лога / debug'а.
		var errResp struct {
			Error struct {
				Message string `json:"message"`
				Type    string `json:"type"`
				Code    string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &errResp)
		return fmt.Errorf("%w: %d %s (%s)", domain.ErrStripeAPI, resp.StatusCode, errResp.Error.Message, errResp.Error.Code)
	}
	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("%w: parse: %v", domain.ErrStripeAPI, err)
		}
	}
	return nil
}
