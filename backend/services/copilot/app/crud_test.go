package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/copilot/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestGetConversation_OwnerEnforced(t *testing.T) {
	ctrl := gomock.NewController(t)
	convs := newConvStore()
	msgs := newMsgStore(convs)
	convRepo := wireMockConvRepo(ctrl, convs)
	msgRepo := wireMockMsgRepo(ctrl, msgs)
	owner := uuid.New()
	intruder := uuid.New()
	conv, _ := convRepo.Create(context.Background(), owner, "t", "m")
	uc := &GetConversation{Conversations: convRepo, Messages: msgRepo}

	_, err := uc.Do(context.Background(), GetConversationInput{UserID: intruder, ConversationID: conv.ID})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("intruder: err = %v, want ErrNotFound", err)
	}
	out, err := uc.Do(context.Background(), GetConversationInput{UserID: owner, ConversationID: conv.ID})
	if err != nil {
		t.Fatalf("owner: unexpected err: %v", err)
	}
	if out.Conversation.ID != conv.ID {
		t.Fatalf("got %v, want %v", out.Conversation.ID, conv.ID)
	}
}

func TestDeleteConversation_OwnerOnly(t *testing.T) {
	ctrl := gomock.NewController(t)
	convs := newConvStore()
	convRepo := wireMockConvRepo(ctrl, convs)
	owner := uuid.New()
	intruder := uuid.New()
	conv, _ := convRepo.Create(context.Background(), owner, "t", "m")
	uc := &DeleteConversation{Conversations: convRepo}

	if err := uc.Do(context.Background(), DeleteConversationInput{UserID: intruder, ConversationID: conv.ID}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("intruder: err = %v, want ErrNotFound", err)
	}
	convs.mu.Lock()
	_, ok := convs.rows[conv.ID]
	convs.mu.Unlock()
	if !ok {
		t.Fatal("intruder deletion removed the row")
	}
	if err := uc.Do(context.Background(), DeleteConversationInput{UserID: owner, ConversationID: conv.ID}); err != nil {
		t.Fatalf("owner: unexpected err: %v", err)
	}
	convs.mu.Lock()
	_, ok = convs.rows[conv.ID]
	convs.mu.Unlock()
	if ok {
		t.Fatal("owner deletion failed to remove the row")
	}
}

func TestRateMessage_OwnerOnly_ValidRange(t *testing.T) {
	ctrl := gomock.NewController(t)
	convs := newConvStore()
	msgs := newMsgStore(convs)
	convRepo := wireMockConvRepo(ctrl, convs)
	msgRepo := wireMockMsgRepo(ctrl, msgs)
	owner := uuid.New()
	intruder := uuid.New()
	conv, _ := convRepo.Create(context.Background(), owner, "t", "m")
	m, _ := msgRepo.Insert(context.Background(), domain.Message{
		ConversationID: conv.ID, Role: enums.MessageRoleAssistant,
	})
	uc := &RateMessage{Messages: msgRepo}

	// Out-of-range.
	if err := uc.Do(context.Background(), RateMessageInput{UserID: owner, MessageID: m.ID, Rating: 2}); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("out-of-range: err = %v, want ErrInvalidInput", err)
	}
	// Wrong owner masquerades as not-found.
	if err := uc.Do(context.Background(), RateMessageInput{UserID: intruder, MessageID: m.ID, Rating: 1}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("intruder: err = %v, want ErrNotFound", err)
	}
	// Happy path.
	if err := uc.Do(context.Background(), RateMessageInput{UserID: owner, MessageID: m.ID, Rating: 1}); err != nil {
		t.Fatalf("owner: err = %v", err)
	}
	msgs.mu.Lock()
	defer msgs.mu.Unlock()
	if got := msgs.rows[m.ID].Rating; got == nil || *got != 1 {
		t.Fatalf("rating not persisted: %v", got)
	}
}

func TestListProviders_AnnotatesAvailability(t *testing.T) {
	ctrl := gomock.NewController(t)
	quotas := newQuotaStore(10)
	cfg := newConfigState("druz9/turbo")
	uc := &ListProviders{
		Config: wireMockConfigProvider(ctrl, cfg),
		Quotas: wireMockQuotaRepo(ctrl, quotas),
	}
	out, err := uc.Do(context.Background(), ListProvidersInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(out.Models) != 3 {
		t.Fatalf("got %d models, want 3", len(out.Models))
	}
	byID := map[string]domain.ProviderModel{}
	for _, m := range out.Models {
		byID[m.ID] = m
	}
	if !byID["druz9/turbo"].AvailableOnCurrentPlan {
		t.Error("druz9/turbo should be available")
	}
	if byID["openai/gpt-4o-mini"].AvailableOnCurrentPlan {
		t.Error("gpt-4o-mini should NOT be available on free quota")
	}
	if byID["openai/gpt-4o"].AvailableOnCurrentPlan {
		t.Error("gpt-4o should NOT be available on default quota")
	}
}

func TestGetQuota_RotatesDueWindow(t *testing.T) {
	ctrl := gomock.NewController(t)
	quotas := newQuotaStore(10)
	quotaRepo := wireMockQuotaRepo(ctrl, quotas)
	userID := uuid.New()
	// Preload a row whose reset time is in the past.
	q, _ := quotaRepo.GetOrInit(context.Background(), userID)
	q.RequestsUsed = 9
	q.ResetsAt = time.Now().Add(-time.Minute)
	quotas.mu.Lock()
	quotas.rows[userID] = q
	quotas.mu.Unlock()

	uc := &GetQuota{Quotas: quotaRepo, Now: time.Now}
	out, err := uc.Do(context.Background(), GetQuotaInput{UserID: userID})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if out.RequestsUsed != 0 {
		t.Fatalf("expected rotation: requests_used = %d, want 0", out.RequestsUsed)
	}
	if !out.ResetsAt.After(time.Now()) {
		t.Error("resets_at not shifted into future")
	}
}

func TestGetDesktopConfig_RevShortCircuit(t *testing.T) {
	ctrl := gomock.NewController(t)
	cfg := newConfigState("openai/gpt-4o-mini")
	uc := &GetDesktopConfig{Config: wireMockConfigProvider(ctrl, cfg)}
	// Rev matches → payload should be empty-except-rev.
	out, err := uc.Do(context.Background(), GetDesktopConfigInput{KnownRev: cfg.cfg.Rev})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if out.Rev != cfg.cfg.Rev {
		t.Fatalf("rev = %d, want %d", out.Rev, cfg.cfg.Rev)
	}
	if len(out.Models) != 0 {
		t.Errorf("expected short-circuit payload to have no models, got %d", len(out.Models))
	}
	// Rev stale → full payload.
	out, err = uc.Do(context.Background(), GetDesktopConfigInput{KnownRev: 0})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(out.Models) == 0 {
		t.Error("expected full payload on stale rev")
	}
}

// errIs is re-declared here to silence the unused-helper warning if tests
// in this file drop it later — keeps the shared helpers neutral.
var _ = errIs
