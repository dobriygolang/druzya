package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// fakeStripeRepo — in-memory реализация domain.StripeRepo.
type fakeStripeRepo struct {
	customers map[uuid.UUID]domain.StripeCustomer
	subs      map[uuid.UUID]domain.StripeSubscription // последняя активная per-user
	hadSub    map[uuid.UUID]bool                      // для HasAnySubscription
	seenIDs   map[string]bool                         // dedup для MarkWebhookSeen
}

func newFakeStripeRepo() *fakeStripeRepo {
	return &fakeStripeRepo{
		customers: map[uuid.UUID]domain.StripeCustomer{},
		subs:      map[uuid.UUID]domain.StripeSubscription{},
		hadSub:    map[uuid.UUID]bool{},
		seenIDs:   map[string]bool{},
	}
}

func (r *fakeStripeRepo) GetCustomer(_ context.Context, userID uuid.UUID) (domain.StripeCustomer, error) {
	if c, ok := r.customers[userID]; ok {
		return c, nil
	}
	return domain.StripeCustomer{}, domain.ErrNotFound
}

func (r *fakeStripeRepo) UpsertCustomer(_ context.Context, c domain.StripeCustomer) error {
	r.customers[c.UserID] = c
	return nil
}

func (r *fakeStripeRepo) UpsertSubscription(_ context.Context, s domain.StripeSubscription) error {
	r.subs[s.UserID] = s
	r.hadSub[s.UserID] = true
	return nil
}

func (r *fakeStripeRepo) HasAnySubscription(_ context.Context, userID uuid.UUID) (bool, error) {
	return r.hadSub[userID], nil
}

func (r *fakeStripeRepo) MarkWebhookSeen(_ context.Context, eventID, _ string) (bool, error) {
	if r.seenIDs[eventID] {
		return false, nil
	}
	r.seenIDs[eventID] = true
	return true, nil
}

func (r *fakeStripeRepo) GetActiveSubscriptionByUser(_ context.Context, userID uuid.UUID) (domain.StripeSubscription, error) {
	if s, ok := r.subs[userID]; ok && (s.Status == "active" || s.Status == "trialing") {
		return s, nil
	}
	return domain.StripeSubscription{}, domain.ErrNotFound
}

func (r *fakeStripeRepo) GetSubscriptionByStripeID(_ context.Context, stripeSubID string) (domain.StripeSubscription, error) {
	for _, s := range r.subs {
		if s.StripeSubscriptionID == stripeSubID {
			return s, nil
		}
	}
	return domain.StripeSubscription{}, domain.ErrNotFound
}

// fakeStripeClient — canned-response StripeClient.
type fakeStripeClient struct {
	createSessErr error
	createCustErr error
	updateErr     error
	verifyErr     error
	calls         []string
	lastInput     domain.CreateCheckoutSessionInput
	lastCustomer  string
	lastCancelSub string
}

func (c *fakeStripeClient) CreateCheckoutSession(_ context.Context, in domain.CreateCheckoutSessionInput) (domain.CheckoutSession, error) {
	c.calls = append(c.calls, "CreateCheckoutSession")
	c.lastInput = in
	if c.createSessErr != nil {
		return domain.CheckoutSession{}, c.createSessErr
	}
	return domain.CheckoutSession{
		SessionID:   "cs_test_123",
		CheckoutURL: "https://checkout.stripe.com/c/cs_test_123",
	}, nil
}

func (c *fakeStripeClient) CreateCustomer(_ context.Context, _ uuid.UUID, _ string) (string, error) {
	c.calls = append(c.calls, "CreateCustomer")
	if c.createCustErr != nil {
		return "", c.createCustErr
	}
	c.lastCustomer = "cus_test_abc"
	return c.lastCustomer, nil
}

func (c *fakeStripeClient) UpdateSubscriptionCancelAtPeriodEnd(_ context.Context, subID string, _ bool) error {
	c.calls = append(c.calls, "UpdateSubscriptionCancelAtPeriodEnd")
	c.lastCancelSub = subID
	return c.updateErr
}

func (c *fakeStripeClient) VerifyWebhookSignature(_ []byte, _ string) error {
	c.calls = append(c.calls, "VerifyWebhookSignature")
	return c.verifyErr
}

// RetrieveCheckoutSession — added для verify endpoint. Fake возвращает
// canned-state'ы по session_id: пусто = ErrNotFound, иначе - paid stub.
func (c *fakeStripeClient) RetrieveCheckoutSession(_ context.Context, sessionID string) (domain.CheckoutSessionDetails, error) {
	c.calls = append(c.calls, "RetrieveCheckoutSession")
	if sessionID == "" {
		return domain.CheckoutSessionDetails{}, domain.ErrNotFound
	}
	return domain.CheckoutSessionDetails{
		SessionID:     sessionID,
		PaymentStatus: "paid",
		Status:        "complete",
		AmountTotal:   99000,
		Currency:      "rub",
		CustomerEmail: "test@druz9.app",
	}, nil
}

func TestCreateCheckoutSession_LazyCustomer_AndSession(t *testing.T) {
	repo := newFakeStripeRepo()
	client := &fakeStripeClient{}
	uc := NewCreateCheckoutSession(repo, client, "price_pro_monthly", discardLogger())

	uid := uuid.New()
	out, err := uc.Do(context.Background(), CreateCheckoutSessionInput{
		UserID:     uid,
		Email:      "user@example.com",
		SuccessURL: "https://druz9.online/checkout/success",
		CancelURL:  "https://druz9.online/checkout/failure",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if out.SessionID == "" || out.CheckoutURL == "" {
		t.Fatalf("expected non-empty session, got %+v", out)
	}
	// Customer создан + сохранён.
	if _, ok := repo.customers[uid]; !ok {
		t.Fatal("expected customer to be persisted")
	}
	// Stripe вызван дважды: CreateCustomer + CreateCheckoutSession.
	if len(client.calls) != 2 || client.calls[0] != "CreateCustomer" || client.calls[1] != "CreateCheckoutSession" {
		t.Fatalf("unexpected stripe calls: %v", client.calls)
	}
	if client.lastInput.PriceID != "price_pro_monthly" {
		t.Fatalf("expected price_id from UC config, got %q", client.lastInput.PriceID)
	}
}

func TestCreateCheckoutSession_ExistingCustomer_SkipsCreate(t *testing.T) {
	repo := newFakeStripeRepo()
	client := &fakeStripeClient{}
	uid := uuid.New()
	repo.customers[uid] = domain.StripeCustomer{
		UserID:           uid,
		StripeCustomerID: "cus_existing",
	}
	uc := NewCreateCheckoutSession(repo, client, "price_pro_monthly", discardLogger())
	_, err := uc.Do(context.Background(), CreateCheckoutSessionInput{
		UserID:     uid,
		SuccessURL: "https://druz9.online/s",
		CancelURL:  "https://druz9.online/f",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(client.calls) != 1 || client.calls[0] != "CreateCheckoutSession" {
		t.Fatalf("CreateCustomer должен быть пропущен, got %v", client.calls)
	}
	if client.lastInput.CustomerID != "cus_existing" {
		t.Fatalf("expected existing customer, got %q", client.lastInput.CustomerID)
	}
}

func TestCreateCheckoutSession_PriceIDRequired(t *testing.T) {
	uc := NewCreateCheckoutSession(newFakeStripeRepo(), &fakeStripeClient{}, "", discardLogger())
	_, err := uc.Do(context.Background(), CreateCheckoutSessionInput{
		UserID:     uuid.New(),
		SuccessURL: "https://x", CancelURL: "https://y",
	})
	if !errors.Is(err, domain.ErrStripeNotConfigured) {
		t.Fatalf("want ErrStripeNotConfigured, got %v", err)
	}
}

func TestCreateCheckoutSession_URLsRequired(t *testing.T) {
	uc := NewCreateCheckoutSession(newFakeStripeRepo(), &fakeStripeClient{}, "price_x", discardLogger())
	_, err := uc.Do(context.Background(), CreateCheckoutSessionInput{UserID: uuid.New()})
	if err == nil {
		t.Fatal("expected error on missing URLs")
	}
}

func TestCancelSubscription_NoActiveSub_Noop(t *testing.T) {
	repo := newFakeStripeRepo()
	client := &fakeStripeClient{}
	uc := NewCancelSubscription(repo, client, discardLogger())
	if err := uc.Do(context.Background(), uuid.New()); err != nil {
		t.Fatalf("expected idempotent ok, got %v", err)
	}
	if len(client.calls) != 0 {
		t.Fatalf("Stripe не должен быть вызван без active sub: %v", client.calls)
	}
}

func TestCancelSubscription_ActiveSub_MarkedCanceled(t *testing.T) {
	repo := newFakeStripeRepo()
	uid := uuid.New()
	repo.subs[uid] = domain.StripeSubscription{
		UserID:               uid,
		StripeSubscriptionID: "sub_test_123",
		Status:               "active",
	}
	client := &fakeStripeClient{}
	uc := NewCancelSubscription(repo, client, discardLogger())
	if err := uc.Do(context.Background(), uid); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if client.lastCancelSub != "sub_test_123" {
		t.Fatalf("Stripe не вызван правильным id: %q", client.lastCancelSub)
	}
	if !repo.subs[uid].CancelAtPeriodEnd {
		t.Fatal("expected local mirror to set cancel_at_period_end=true")
	}
}

func TestHandleWebhookEvent_InvalidSignature_Rejected(t *testing.T) {
	client := &fakeStripeClient{verifyErr: domain.ErrInvalidWebhookSignature}
	uc := NewHandleWebhookEvent(newFakeStripeRepo(), client, nil, discardLogger())
	err := uc.Do(context.Background(), []byte(`{"id":"evt_x","type":"checkout.session.completed"}`), "bogus")
	if !errors.Is(err, domain.ErrInvalidWebhookSignature) {
		t.Fatalf("want ErrInvalidWebhookSignature, got %v", err)
	}
}

func TestHandleWebhookEvent_CheckoutCompleted_SetsProTier(t *testing.T) {
	repo := newFakeStripeRepo()
	subRepo := &fakeRepo{}
	setTier := NewSetTier(subRepo, fakeClock{now: time.Now()}, discardLogger())
	uc := NewHandleWebhookEvent(repo, &fakeStripeClient{}, setTier, discardLogger())
	uid := uuid.New()
	payload := []byte(`{
		"id": "evt_1",
		"type": "checkout.session.completed",
		"data": {
			"object": {
				"id": "cs_test_1",
				"customer": "cus_test_1",
				"subscription": "sub_test_1",
				"client_reference_id": "` + uid.String() + `"
			}
		}
	}`)
	if err := uc.Do(context.Background(), payload, "sig"); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if subRepo.sub == nil || subRepo.sub.Tier != domain.TierPro {
		t.Fatalf("expected paid Pro after checkout, got %+v", subRepo.sub)
	}
	if subRepo.sub.Provider != domain.ProviderStripe {
		t.Fatalf("expected stripe provider, got %q", subRepo.sub.Provider)
	}
}

func TestHandleWebhookEvent_SubscriptionDeleted_DropsTier(t *testing.T) {
	repo := newFakeStripeRepo()
	subRepo := &fakeRepo{}
	setTier := NewSetTier(subRepo, fakeClock{now: time.Now()}, discardLogger())
	uc := NewHandleWebhookEvent(repo, &fakeStripeClient{}, setTier, discardLogger())
	uid := uuid.New()
	payload := []byte(`{
		"id": "evt_2",
		"type": "customer.subscription.deleted",
		"data": {
			"object": {
				"id": "sub_test_1",
				"customer": "cus_test_1",
				"status": "canceled",
				"metadata": {"user_id": "` + uid.String() + `"}
			}
		}
	}`)
	if err := uc.Do(context.Background(), payload, "sig"); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if subRepo.sub == nil || subRepo.sub.Tier != domain.TierFree {
		t.Fatalf("expected free after delete event, got %+v", subRepo.sub)
	}
}

func TestHandleWebhookEvent_UnknownType_NoOp(t *testing.T) {
	uc := NewHandleWebhookEvent(newFakeStripeRepo(), &fakeStripeClient{}, nil, discardLogger())
	payload := []byte(`{"id":"evt_x","type":"invoice.upcoming","data":{"object":{}}}`)
	if err := uc.Do(context.Background(), payload, "sig"); err != nil {
		t.Fatalf("unknown types must be silently acked, got %v", err)
	}
}
