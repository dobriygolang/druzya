package app

import (
	"context"
	"errors"
	"testing"

	"druz9/copilot/domain"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// analyzeHarness — собирает Analyze UC из mock-wired components +
// expose store-структуры для assertion'ов после прогона.
type analyzeHarness struct {
	uc     *Analyze
	chat   *Chat
	convs  *convStore
	msgs   *msgStore
	quotas *quotaStore
}

func newAnalyzeUC(t *testing.T, cap int, script *llmScript) *analyzeHarness {
	t.Helper()
	ctrl := gomock.NewController(t)
	convs := newConvStore()
	msgs := newMsgStore(convs)
	quotas := newQuotaStore(cap)
	uc := &Analyze{
		Conversations: wireMockConvRepo(ctrl, convs),
		Messages:      wireMockMsgRepo(ctrl, msgs),
		Quotas:        wireMockQuotaRepo(ctrl, quotas),
		LLM:           wireMockLLMProvider(ctrl, script),
		Config:        wireMockConfigProvider(ctrl, newConfigState("druz9/turbo")),
	}
	return &analyzeHarness{
		uc:     uc,
		chat:   &Chat{Inner: uc},
		convs:  convs,
		msgs:   msgs,
		quotas: quotas,
	}
}

func TestAnalyze_NewConversation_StreamsAndPersists(t *testing.T) {
	h := newAnalyzeUC(t, 10, &llmScript{
		Deltas:    []string{"Hello", ", ", "world!"},
		TokensIn:  15,
		TokensOut: 3,
		Model:     "druz9/turbo",
	})
	userID := uuid.New()

	ch, err := h.uc.Do(context.Background(), AnalyzeInput{
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

	h.convs.mu.Lock()
	convCount := len(h.convs.rows)
	h.convs.mu.Unlock()
	if convCount != 1 {
		t.Fatalf("conversations persisted = %d, want 1", convCount)
	}
	h.msgs.mu.Lock()
	defer h.msgs.mu.Unlock()
	if len(h.msgs.rows) != 2 {
		t.Fatalf("messages persisted = %d, want 2", len(h.msgs.rows))
	}
	sawHasScreenshot := false
	sawAssistantFinal := false
	for _, m := range h.msgs.rows {
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
	h := newAnalyzeUC(t, 0, &llmScript{}) // cap=0 → immediately out of budget

	_, err := h.uc.Do(context.Background(), AnalyzeInput{
		UserID:     uuid.New(),
		PromptText: "anything",
	})
	if !errors.Is(err, domain.ErrQuotaExceeded) {
		t.Fatalf("err = %v, want ErrQuotaExceeded", err)
	}
}

func TestAnalyze_ModelNotAllowed(t *testing.T) {
	h := newAnalyzeUC(t, 10, &llmScript{}) // default allows only druz9/turbo

	_, err := h.uc.Do(context.Background(), AnalyzeInput{
		UserID:     uuid.New(),
		PromptText: "anything",
		Model:      "anthropic/claude-opus-4",
	})
	if !errors.Is(err, domain.ErrModelNotAllowed) {
		t.Fatalf("err = %v, want ErrModelNotAllowed", err)
	}
}

func TestAnalyze_EmptyInput(t *testing.T) {
	h := newAnalyzeUC(t, 10, &llmScript{})

	_, err := h.uc.Do(context.Background(), AnalyzeInput{UserID: uuid.New()})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("err = %v, want ErrInvalidInput", err)
	}
}

func TestAnalyze_ProviderErrorMidStream_StillCommits(t *testing.T) {
	h := newAnalyzeUC(t, 10, &llmScript{
		Deltas: []string{"partial ", "rest"},
		// SendErrOnIx is 1-indexed and fires BEFORE emitting that delta.
		// With Deltas[0]="partial " sent, SendErrOnIx=2 aborts before "rest",
		// so assembled = "partial " when the error arrives.
		SendErrOnIx: 2,
		ErrValue:    errors.New("upstream EOF"),
	})

	ch, err := h.uc.Do(context.Background(), AnalyzeInput{
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
	h.msgs.mu.Lock()
	defer h.msgs.mu.Unlock()
	sawAssembled := false
	for _, m := range h.msgs.rows {
		if m.Content == "partial " {
			sawAssembled = true
		}
	}
	if !sawAssembled {
		t.Error("assistant message was not committed after mid-stream error")
	}
}

func TestChat_RequiresConversationID(t *testing.T) {
	h := newAnalyzeUC(t, 10, &llmScript{})

	_, err := h.chat.Do(context.Background(), ChatInput{
		UserID:     uuid.New(),
		PromptText: "follow up",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("err = %v, want ErrInvalidInput", err)
	}
}
