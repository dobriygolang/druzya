package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

func TestSyncMemory_OwnerConversationSucceeds(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	convs := newFakeConversations()
	conv, err := convs.Create(ctx, userID, "title", "openai/gpt-4o-mini")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	sink := &fakeMemorySink{}
	uc := &SyncMemory{Conversations: convs, Memory: sink}

	memory := validConversationMemory()
	if err := uc.Do(ctx, SyncMemoryInput{UserID: userID, ConversationID: conv.ID, Memory: memory}); err != nil {
		t.Fatalf("Do: %v", err)
	}
	if sink.calls != 1 {
		t.Fatalf("sink calls=%d, want 1", sink.calls)
	}
	if sink.userID != userID || sink.conversationID != conv.ID {
		t.Fatalf("sink ids user=%s conversation=%s", sink.userID, sink.conversationID)
	}
	if sink.memory.RollingSummary != memory.RollingSummary {
		t.Fatalf("rolling summary=%q, want %q", sink.memory.RollingSummary, memory.RollingSummary)
	}
}

func TestSyncMemory_OtherUserReturnsNotFound(t *testing.T) {
	ctx := context.Background()
	convs := newFakeConversations()
	conv, err := convs.Create(ctx, uuid.New(), "title", "openai/gpt-4o-mini")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	sink := &fakeMemorySink{}
	uc := &SyncMemory{Conversations: convs, Memory: sink}

	err = uc.Do(ctx, SyncMemoryInput{
		UserID:         uuid.New(),
		ConversationID: conv.ID,
		Memory:         validConversationMemory(),
	})
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err=%v, want ErrNotFound", err)
	}
	if sink.calls != 0 {
		t.Fatalf("sink calls=%d, want 0", sink.calls)
	}
}

func TestSyncMemory_RejectsEmptyMemory(t *testing.T) {
	ctx := context.Background()
	userID := uuid.New()
	convs := newFakeConversations()
	conv, err := convs.Create(ctx, userID, "title", "openai/gpt-4o-mini")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	uc := &SyncMemory{Conversations: convs, Memory: &fakeMemorySink{}}

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
	userID := uuid.New()
	convs := newFakeConversations()
	conv, err := convs.Create(ctx, userID, "title", "openai/gpt-4o-mini")
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}
	uc := &SyncMemory{Conversations: convs, Memory: &fakeMemorySink{}}

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

type fakeMemorySink struct {
	calls          int
	userID         uuid.UUID
	conversationID uuid.UUID
	memory         domain.ConversationMemory
	err            error
}

func (f *fakeMemorySink) AppendConversationMemory(_ context.Context, userID, conversationID uuid.UUID, memory domain.ConversationMemory) error {
	f.calls++
	f.userID = userID
	f.conversationID = conversationID
	f.memory = memory
	return f.err
}
