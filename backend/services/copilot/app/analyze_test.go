package app

import (
	"context"
	"errors"
	"testing"

	"druz9/copilot/domain"

	"github.com/google/uuid"
)

// newAnalyzeUC assembles an Analyze use case with default knobs and a
// scripted LLM that emits the given delta sequence.
func newAnalyzeUC(t *testing.T, convs *fakeConversations, msgs *fakeMessages, quotas *fakeQuotas, llm domain.LLMProvider) *Analyze {
	t.Helper()
	return &Analyze{
		Conversations: convs,
		Messages:      msgs,
		Quotas:        quotas,
		LLM:           llm,
		Config:        newFakeConfig("openai/gpt-4o-mini"),
	}
}

func TestAnalyze_NewConversation_StreamsAndPersists(t *testing.T) {
	convs := newFakeConversations()
	msgs := newFakeMessages(convs)
	quotas := newFakeQuotas(10)
	llm := &fakeLLM{
		Deltas:    []string{"Hello", ", ", "world!"},
		TokensIn:  15,
		TokensOut: 3,
		Model:     "openai/gpt-4o-mini",
	}
	uc := newAnalyzeUC(t, convs, msgs, quotas, llm)
	userID := uuid.New()

	ch, err := uc.Do(context.Background(), AnalyzeInput{
		UserID:     userID,
		PromptText: "Hi there",
		Attachments: []domain.AttachmentInput{{
			Kind: domain.AttachmentKindScreenshot, Data: []byte{0x89, 0x50, 0x4E, 0x47}, MimeType: "image/png",
		}},
	})
	if err != nil {
		t.Fatalf("Do returned err: %v", err)
	}
	frames := drainFrames(ch)
	if err := firstErr(frames); err != nil {
		t.Fatalf("stream error: %v", err)
	}
	if got, want := assembledText(frames), "Hello, world!"; got != want {
		t.Fatalf("assembled = %q, want %q", got, want)
	}
	done := lastDone(frames)
	if done == nil {
		t.Fatal("no Done frame emitted")
	}
	if done.TokensIn != 15 || done.TokensOut != 3 {
		t.Fatalf("tokens = (%d,%d), want (15,3)", done.TokensIn, done.TokensOut)
	}
	if done.Quota.RequestsUsed != 1 {
		t.Fatalf("quota.RequestsUsed = %d, want 1", done.Quota.RequestsUsed)
	}

	// Verify persistence: one conversation, two messages (user + assistant),
	// assistant content matches, user message flagged has_screenshot.
	if len(convs.rows) != 1 {
		t.Fatalf("conversations persisted = %d, want 1", len(convs.rows))
	}
	if len(msgs.rows) != 2 {
		t.Fatalf("messages persisted = %d, want 2", len(msgs.rows))
	}
	sawHasScreenshot := false
	sawAssistantFinal := false
	for _, m := range msgs.rows {
		if m.HasScreenshot {
			sawHasScreenshot = true
		}
		if m.Content == "Hello, world!" {
			sawAssistantFinal = true
		}
	}
	if !sawHasScreenshot {
		t.Error("no message recorded has_screenshot=true")
	}
	if !sawAssistantFinal {
		t.Error("assistant message final content not committed")
	}
}

func TestAnalyze_QuotaExceeded(t *testing.T) {
	convs := newFakeConversations()
	msgs := newFakeMessages(convs)
	quotas := newFakeQuotas(0) // cap=0 → immediately out of budget
	llm := &fakeLLM{}
	uc := newAnalyzeUC(t, convs, msgs, quotas, llm)

	_, err := uc.Do(context.Background(), AnalyzeInput{
		UserID:     uuid.New(),
		PromptText: "anything",
	})
	if !errors.Is(err, domain.ErrQuotaExceeded) {
		t.Fatalf("err = %v, want ErrQuotaExceeded", err)
	}
}

func TestAnalyze_ModelNotAllowed(t *testing.T) {
	convs := newFakeConversations()
	msgs := newFakeMessages(convs)
	quotas := newFakeQuotas(10) // default allows only openai/gpt-4o-mini
	llm := &fakeLLM{}
	uc := newAnalyzeUC(t, convs, msgs, quotas, llm)

	_, err := uc.Do(context.Background(), AnalyzeInput{
		UserID:     uuid.New(),
		PromptText: "anything",
		Model:      "anthropic/claude-opus-4",
	})
	if !errors.Is(err, domain.ErrModelNotAllowed) {
		t.Fatalf("err = %v, want ErrModelNotAllowed", err)
	}
}

func TestAnalyze_EmptyInput(t *testing.T) {
	convs := newFakeConversations()
	msgs := newFakeMessages(convs)
	quotas := newFakeQuotas(10)
	uc := newAnalyzeUC(t, convs, msgs, quotas, &fakeLLM{})

	_, err := uc.Do(context.Background(), AnalyzeInput{UserID: uuid.New()})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("err = %v, want ErrInvalidInput", err)
	}
}

func TestAnalyze_ProviderErrorMidStream_StillCommits(t *testing.T) {
	convs := newFakeConversations()
	msgs := newFakeMessages(convs)
	quotas := newFakeQuotas(10)
	llm := &fakeLLM{
		Deltas: []string{"partial ", "rest"},
		// SendErrOnIx is 1-indexed and fires BEFORE emitting that delta.
		// With Deltas[0]="partial " sent, SendErrOnIx=2 aborts before "rest",
		// so assembled = "partial " when the error arrives.
		SendErrOnIx: 2,
		ErrValue:    errors.New("upstream EOF"),
	}
	uc := newAnalyzeUC(t, convs, msgs, quotas, llm)

	ch, err := uc.Do(context.Background(), AnalyzeInput{
		UserID:     uuid.New(),
		PromptText: "Hi",
	})
	if err != nil {
		t.Fatalf("Do returned err: %v", err)
	}
	frames := drainFrames(ch)
	if firstErr(frames) == nil {
		t.Fatal("expected Err frame, got none")
	}
	// Assistant message should still have been committed with whatever text
	// was assembled before the error so history does not show an empty turn.
	sawAssembled := false
	for _, m := range msgs.rows {
		if m.Content == "partial " {
			sawAssembled = true
		}
	}
	if !sawAssembled {
		t.Error("assistant message was not committed after mid-stream error")
	}
}

func TestChat_RequiresConversationID(t *testing.T) {
	convs := newFakeConversations()
	msgs := newFakeMessages(convs)
	quotas := newFakeQuotas(10)
	uc := &Chat{Inner: newAnalyzeUC(t, convs, msgs, quotas, &fakeLLM{})}

	_, err := uc.Do(context.Background(), ChatInput{
		UserID:     uuid.New(),
		PromptText: "follow up",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("err = %v, want ErrInvalidInput", err)
	}
}
