package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"druz9/copilot/domain"
	mocks "druz9/copilot/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// memorySinkTap — closure-state для MockMemorySink, ловит последний вызов.
type memorySinkTap struct {
	mu             sync.Mutex
	calls          int
	userID         uuid.UUID
	conversationID uuid.UUID
	memory         domain.ConversationMemory
	err            error
}

func wireMockMemorySink(ctrl *gomock.Controller, tap *memorySinkTap) *mocks.MockMemorySink {
	m := mocks.NewMockMemorySink(ctrl)
	m.EXPECT().AppendConversationMemory(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID, conversationID uuid.UUID, memory domain.ConversationMemory) error {
			tap.mu.Lock()
			defer tap.mu.Unlock()
			tap.calls++
			tap.userID = userID
			tap.conversationID = conversationID
			tap.memory = memory
			return tap.err
		},
	).AnyTimes()
	return m
}

func TestSyncMemory_OwnerConversationSucceeds(t *testing.T) {
	ctx := context.Background()
	ctrl := gomock.NewController(t)
	userID := uuid.New()
	convs := newConvStore()
	convRepo := wireMockConvRepo(ctrl, convs)
	conv, err := convRepo.Create(ctx, userID, "title", "openai/gpt-4o-mini")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	tap := &memorySinkTap{}
	uc := &SyncMemory{Conversations: convRepo, Memory: wireMockMemorySink(ctrl, tap)}

	memory := validConversationMemory()
	if err := uc.Do(ctx, SyncMemoryInput{UserID: userID, ConversationID: conv.ID, Memory: memory}); err != nil {
		t.Fatalf("Do: %v", err)
	}
	tap.mu.Lock()
	defer tap.mu.Unlock()
	if tap.calls != 1 {
		t.Fatalf("sink calls=%d, want 1", tap.calls)
	}
	if tap.userID != userID || tap.conversationID != conv.ID {
		t.Fatalf("sink ids user=%s conversation=%s", tap.userID, tap.conversationID)
	}
	if tap.memory.RollingSummary != memory.RollingSummary {
		t.Fatalf("rolling summary=%q, want %q", tap.memory.RollingSummary, memory.RollingSummary)
	}
}

func TestSyncMemory_OtherUserReturnsNotFound(t *testing.T) {
	ctx := context.Background()
	ctrl := gomock.NewController(t)
	convs := newConvStore()
	convRepo := wireMockConvRepo(ctrl, convs)
	conv, err := convRepo.Create(ctx, uuid.New(), "title", "openai/gpt-4o-mini")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	tap := &memorySinkTap{}
	uc := &SyncMemory{Conversations: convRepo, Memory: wireMockMemorySink(ctrl, tap)}

	err = uc.Do(ctx, SyncMemoryInput{
		UserID:         uuid.New(),
		ConversationID: conv.ID,
		Memory:         validConversationMemory(),
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err=%v, want ErrNotFound", err)
	}
	tap.mu.Lock()
	defer tap.mu.Unlock()
	if tap.calls != 0 {
		t.Fatalf("sink calls=%d, want 0", tap.calls)
	}
}

func TestSyncMemory_RejectsEmptyMemory(t *testing.T) {
	ctx := context.Background()
	ctrl := gomock.NewController(t)
	userID := uuid.New()
	convs := newConvStore()
	convRepo := wireMockConvRepo(ctrl, convs)
	conv, err := convRepo.Create(ctx, userID, "title", "openai/gpt-4o-mini")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	uc := &SyncMemory{Conversations: convRepo, Memory: wireMockMemorySink(ctrl, &memorySinkTap{})}

	err = uc.Do(ctx, SyncMemoryInput{
		UserID:         userID,
		ConversationID: conv.ID,
		Memory: domain.ConversationMemory{
			Outcome: domain.MemoryOutcomeAnswered,
		},
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("err=%v, want ErrInvalidInput", err)
	}
}

func TestSyncMemory_RejectsInvalidOutcome(t *testing.T) {
	ctx := context.Background()
	ctrl := gomock.NewController(t)
	userID := uuid.New()
	convs := newConvStore()
	convRepo := wireMockConvRepo(ctrl, convs)
	conv, err := convRepo.Create(ctx, userID, "title", "openai/gpt-4o-mini")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	uc := &SyncMemory{Conversations: convRepo, Memory: wireMockMemorySink(ctrl, &memorySinkTap{})}

	err = uc.Do(ctx, SyncMemoryInput{
		UserID:         userID,
		ConversationID: conv.ID,
		Memory: domain.ConversationMemory{
			Turns:   []domain.MemoryTurn{{Question: "q", Answer: "a"}},
			Outcome: domain.MemoryOutcome("done"),
		},
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("err=%v, want ErrInvalidInput", err)
	}
}

func validConversationMemory() domain.ConversationMemory {
	return domain.ConversationMemory{
		Turns: []domain.MemoryTurn{{
			Question:      "How do I scale Redis?",
			Answer:        "Use sharding and clear ownership of hot keys.",
			HasScreenshot: true,
			Timestamp:     time.Date(2026, 4, 27, 1, 23, 0, 0, time.UTC),
			Model:         "openai/gpt-4o-mini",
		}},
		ScreenshotSummary: "1 screenshot turn; raw image bytes are not stored.",
		Topics:            []string{"system design", "backend"},
		Outcome:           domain.MemoryOutcomeAnswered,
		RollingSummary:    "User practiced Redis scaling.",
		Embeddings:        []domain.MemoryEmbedding{{Term: "redis", Weight: 2}},
	}
}
