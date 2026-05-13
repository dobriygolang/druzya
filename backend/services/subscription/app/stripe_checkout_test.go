package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"druz9/subscription/domain"
	submocks "druz9/subscription/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// ── stripeRepoStore + wireMockStripeRepo ─────────────────────────────────
//
// Закрытая state-машина для domain.StripeRepo. Поддерживает:
//   • lazy-customer (UpsertCustomer создаёт row на 1-м checkout)
//   • subscription mirror (UpsertSubscription / Get*)
//   • idempotent dedup (MarkWebhookSeen возвращает (true, nil) на 1-й вызов).

type stripeRepoStore struct {
	mu        sync.Mutex
	customers map[uuid.UUID]domain.StripeCustomer
	subs      map[uuid.UUID]domain.StripeSubscription // последняя активная per-user
	hadSub    map[uuid.UUID]bool                      // для HasAnySubscription
	seenIDs   map[string]bool                         // dedup для MarkWebhookSeen
}

func newStripeRepoStore() *stripeRepoStore {
	return &stripeRepoStore{
		customers: map[uuid.UUID]domain.StripeCustomer{},
		subs:      map[uuid.UUID]domain.StripeSubscription{},
		hadSub:    map[uuid.UUID]bool{},
		seenIDs:   map[string]bool{},
	}
}

func wireMockStripeRepo(ctrl *gomock.Controller, s *stripeRepoStore) *submocks.MockStripeRepo {
	m := submocks.NewMockStripeRepo(ctrl)
	m.EXPECT().GetCustomer(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) (domain.StripeCustomer, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if c, ok := s.customers[userID]; ok {
				return c, nil
			}
			return domain.StripeCustomer{}, domain.ErrNotFound
		},
	).AnyTimes()
	m.EXPECT().UpsertCustomer(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, c domain.StripeCustomer) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.customers[c.UserID] = c
			return nil
		},
	).AnyTimes()
	m.EXPECT().UpsertSubscription(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, sub domain.StripeSubscription) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.subs[sub.UserID] = sub
			s.hadSub[sub.UserID] = true
			return nil
		},
	).AnyTimes()
	m.EXPECT().HasAnySubscription(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) (bool, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.hadSub[userID], nil
		},
	).AnyTimes()
	m.EXPECT().MarkWebhookSeen(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, eventID, _ string) (bool, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.seenIDs[eventID] {
				return false, nil
			}
			s.seenIDs[eventID] = true
			return true, nil
		},
	).AnyTimes()
	m.EXPECT().GetActiveSubscriptionByUser(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID uuid.UUID) (domain.StripeSubscription, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if sub, ok := s.subs[userID]; ok && (sub.Status == "active" || sub.Status == "trialing") {
				return sub, nil
			}
			return domain.StripeSubscription{}, domain.ErrNotFound
		},
	).AnyTimes()
	m.EXPECT().GetSubscriptionByStripeID(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, stripeSubID string) (domain.StripeSubscription, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			for _, sub := range s.subs {
				if sub.StripeSubscriptionID == stripeSubID {
					return sub, nil
				}
			}
			return domain.StripeSubscription{}, domain.ErrNotFound
		},
	).AnyTimes()
	return m
}

// stripeClientCalls — фиксирует вызовы Stripe API для assertion'ов.
type stripeClientCalls struct {
	mu            sync.Mutex
	calls         []string
	lastInput     domain.CreateCheckoutSessionInput
	lastCustomer  string
	lastCancelSub string
}

func (c *stripeClientCalls) record(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls = append(c.calls, name)
}

func (c *stripeClientCalls) snapshotCalls() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, len(c.calls))
	copy(out, c.calls)
	return out
}

// wireMockStripeClient — управляемый StripeClient с захватом вызовов.
// createSessErr / createCustErr / updateErr / verifyErr — инжектируемые
// фейлы для конкретных endpoint'ов.
type stripeClientErrs struct {
	createSessErr error
	createCustErr error
	updateErr     error
	verifyErr     error
}

func wireMockStripeClient(ctrl *gomock.Controller, errs stripeClientErrs, calls *stripeClientCalls) *submocks.MockStripeClient {
	m := submocks.NewMockStripeClient(ctrl)
	m.EXPECT().CreateCheckoutSession(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in domain.CreateCheckoutSessionInput) (domain.CheckoutSession, error) {
			calls.record("CreateCheckoutSession")
			calls.mu.Lock()
			calls.lastInput = in
			calls.mu.Unlock()
			if errs.createSessErr != nil {
				return domain.CheckoutSession{}, errs.createSessErr
			}
			return domain.CheckoutSession{
				SessionID:   "cs_test_123",
				CheckoutURL: "https://checkout.stripe.com/c/cs_test_123",
			}, nil
		},
	).AnyTimes()
	m.EXPECT().CreateCustomer(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID, _ string) (string, error) {
			calls.record("CreateCustomer")
			if errs.createCustErr != nil {
				return "", errs.createCustErr
			}
			calls.mu.Lock()
			calls.lastCustomer = "cus_test_abc"
			calls.mu.Unlock()
			return "cus_test_abc", nil
		},
	).AnyTimes()
	m.EXPECT().UpdateSubscriptionCancelAtPeriodEnd(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, subID string, _ bool) error {
			calls.record("UpdateSubscriptionCancelAtPeriodEnd")
			calls.mu.Lock()
			calls.lastCancelSub = subID
			calls.mu.Unlock()
			return errs.updateErr
		},
	).AnyTimes()
	m.EXPECT().VerifyWebhookSignature(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ []byte, _ string) error {
			calls.record("VerifyWebhookSignature")
			return errs.verifyErr
		},
	).AnyTimes()
	m.EXPECT().RetrieveCheckoutSession(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, sessionID string) (domain.CheckoutSessionDetails, error) {
			calls.record("RetrieveCheckoutSession")
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
		},
	).AnyTimes()
	return m
}

func TestCreateCheckoutSession_LazyCustomer_AndSession(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := newStripeRepoStore()
	calls := &stripeClientCalls{}
	client := wireMockStripeClient(ctrl, stripeClientErrs{}, calls)
	uc := NewCreateCheckoutSession(wireMockStripeRepo(ctrl, repo), client, "price_pro_monthly", discardLogger())

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
	repo.mu.Lock()
	_, ok := repo.customers[uid]
	repo.mu.Unlock()
	if !ok {
		t.Fatal("expected customer to be persisted")
	}
	// Stripe вызван дважды: CreateCustomer + CreateCheckoutSession.
	got := calls.snapshotCalls()
	if len(got) != 2 || got[0] != "CreateCustomer" || got[1] != "CreateCheckoutSession" {
		t.Fatalf("unexpected stripe calls: %v", got)
	}
	if calls.lastInput.PriceID != "price_pro_monthly" {
		t.Fatalf("expected price_id from UC config, got %q", calls.lastInput.PriceID)
	}
}

func TestCreateCheckoutSession_ExistingCustomer_SkipsCreate(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := newStripeRepoStore()
	uid := uuid.New()
	repo.customers[uid] = domain.StripeCustomer{
		UserID:           uid,
		StripeCustomerID: "cus_existing",
	}
	calls := &stripeClientCalls{}
	client := wireMockStripeClient(ctrl, stripeClientErrs{}, calls)
	uc := NewCreateCheckoutSession(wireMockStripeRepo(ctrl, repo), client, "price_pro_monthly", discardLogger())
	_, err := uc.Do(context.Background(), CreateCheckoutSessionInput{
		UserID:     uid,
		SuccessURL: "https://druz9.online/s",
		CancelURL:  "https://druz9.online/f",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	got := calls.snapshotCalls()
	if len(got) != 1 || got[0] != "CreateCheckoutSession" {
		t.Fatalf("CreateCustomer должен быть пропущен, got %v", got)
	}
	if calls.lastInput.CustomerID != "cus_existing" {
		t.Fatalf("expected existing customer, got %q", calls.lastInput.CustomerID)
	}
}

func TestCreateCheckoutSession_PriceIDRequired(t *testing.T) {
	ctrl := gomock.NewController(t)
	calls := &stripeClientCalls{}
	uc := NewCreateCheckoutSession(
		wireMockStripeRepo(ctrl, newStripeRepoStore()),
		wireMockStripeClient(ctrl, stripeClientErrs{}, calls),
		"", discardLogger(),
	)
	_, err := uc.Do(context.Background(), CreateCheckoutSessionInput{
		UserID:     uuid.New(),
		SuccessURL: "https://x", CancelURL: "https://y",
	})
	if !errors.Is(err, domain.ErrStripeNotConfigured) {
		t.Fatalf("want ErrStripeNotConfigured, got %v", err)
	}
}

func TestCreateCheckoutSession_URLsRequired(t *testing.T) {
	ctrl := gomock.NewController(t)
	calls := &stripeClientCalls{}
	uc := NewCreateCheckoutSession(
		wireMockStripeRepo(ctrl, newStripeRepoStore()),
		wireMockStripeClient(ctrl, stripeClientErrs{}, calls),
		"price_x", discardLogger(),
	)
	_, err := uc.Do(context.Background(), CreateCheckoutSessionInput{UserID: uuid.New()})
	if err == nil {
		t.Fatal("expected error on missing URLs")
	}
}

func TestCancelSubscription_NoActiveSub_Noop(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := newStripeRepoStore()
	calls := &stripeClientCalls{}
	uc := NewCancelSubscription(wireMockStripeRepo(ctrl, repo), wireMockStripeClient(ctrl, stripeClientErrs{}, calls), discardLogger())
	if err := uc.Do(context.Background(), uuid.New()); err != nil {
		t.Fatalf("expected idempotent ok, got %v", err)
	}
	if len(calls.snapshotCalls()) != 0 {
		t.Fatalf("Stripe не должен быть вызван без active sub: %v", calls.snapshotCalls())
	}
}

func TestCancelSubscription_ActiveSub_MarkedCanceled(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := newStripeRepoStore()
	uid := uuid.New()
	repo.subs[uid] = domain.StripeSubscription{
		UserID:               uid,
		StripeSubscriptionID: "sub_test_123",
		Status:               "active",
	}
	repo.hadSub[uid] = true
	calls := &stripeClientCalls{}
	uc := NewCancelSubscription(wireMockStripeRepo(ctrl, repo), wireMockStripeClient(ctrl, stripeClientErrs{}, calls), discardLogger())
	if err := uc.Do(context.Background(), uid); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if calls.lastCancelSub != "sub_test_123" {
		t.Fatalf("Stripe не вызван правильным id: %q", calls.lastCancelSub)
	}
	repo.mu.Lock()
	cancelFlag := repo.subs[uid].CancelAtPeriodEnd
	repo.mu.Unlock()
	if !cancelFlag {
		t.Fatal("expected local mirror to set cancel_at_period_end=true")
	}
}

func TestHandleWebhookEvent_InvalidSignature_Rejected(t *testing.T) {
	ctrl := gomock.NewController(t)
	calls := &stripeClientCalls{}
	client := wireMockStripeClient(ctrl, stripeClientErrs{verifyErr: domain.ErrInvalidWebhookSignature}, calls)
	uc := NewHandleWebhookEvent(wireMockStripeRepo(ctrl, newStripeRepoStore()), client, nil, discardLogger())
	err := uc.Do(context.Background(), []byte(`{"id":"evt_x","type":"checkout.session.completed"}`), "bogus")
	if !errors.Is(err, domain.ErrInvalidWebhookSignature) {
		t.Fatalf("want ErrInvalidWebhookSignature, got %v", err)
	}
}

func TestHandleWebhookEvent_CheckoutCompleted_SetsProTier(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := newStripeRepoStore()
	subStore := newSubRepoStore()
	calls := &stripeClientCalls{}
	setTier := NewSetTier(wireMockSubRepo(ctrl, subStore), fakeClock{now: time.Now()}, discardLogger())
	uc := NewHandleWebhookEvent(
		wireMockStripeRepo(ctrl, repo),
		wireMockStripeClient(ctrl, stripeClientErrs{}, calls),
		setTier, discardLogger(),
	)
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
	subStore.mu.Lock()
	defer subStore.mu.Unlock()
	if subStore.sub == nil || subStore.sub.Tier != domain.TierPro {
		t.Fatalf("expected paid Pro after checkout, got %+v", subStore.sub)
	}
	if subStore.sub.Provider != domain.ProviderStripe {
		t.Fatalf("expected stripe provider, got %q", subStore.sub.Provider)
	}
}

func TestHandleWebhookEvent_SubscriptionDeleted_DropsTier(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := newStripeRepoStore()
	subStore := newSubRepoStore()
	calls := &stripeClientCalls{}
	setTier := NewSetTier(wireMockSubRepo(ctrl, subStore), fakeClock{now: time.Now()}, discardLogger())
	uc := NewHandleWebhookEvent(
		wireMockStripeRepo(ctrl, repo),
		wireMockStripeClient(ctrl, stripeClientErrs{}, calls),
		setTier, discardLogger(),
	)
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
	subStore.mu.Lock()
	defer subStore.mu.Unlock()
	if subStore.sub == nil || subStore.sub.Tier != domain.TierFree {
		t.Fatalf("expected free after delete event, got %+v", subStore.sub)
	}
}

func TestHandleWebhookEvent_UnknownType_NoOp(t *testing.T) {
	ctrl := gomock.NewController(t)
	calls := &stripeClientCalls{}
	uc := NewHandleWebhookEvent(
		wireMockStripeRepo(ctrl, newStripeRepoStore()),
		wireMockStripeClient(ctrl, stripeClientErrs{}, calls),
		nil, discardLogger(),
	)
	payload := []byte(`{"id":"evt_x","type":"invoice.upcoming","data":{"object":{}}}`)
	if err := uc.Do(context.Background(), payload, "sig"); err != nil {
		t.Fatalf("unknown types must be silently acked, got %v", err)
	}
}
