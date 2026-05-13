package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/copilot/domain"
	"druz9/copilot/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// TestCheckBlock_BlockedSurfacesReason pins the wire contract: when the gate
// reports a live strict-mode mock-session, CheckBlock returns blocked=true
// + the canonical reason tag the desktop client filters on.
func TestCheckBlock_BlockedSurfacesReason(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	until := time.Now().UTC().Add(15 * time.Minute)
	gate := mocks.NewMockMockSessionGate(ctrl)
	gate.EXPECT().HasActiveBlockingSession(gomock.Any(), gomock.Any()).Return(true, until, nil)
	uc := &CheckBlock{Gate: gate}

	out, err := uc.Do(context.Background(), CheckBlockInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if !out.Blocked {
		t.Fatal("blocked = false, want true")
	}
	if out.Reason != "mock_no_assist" {
		t.Fatalf("reason = %q, want mock_no_assist", out.Reason)
	}
	if !out.Until.Equal(until) {
		t.Fatalf("until = %v, want %v", out.Until, until)
	}
}

// TestCheckBlock_NotBlocked covers the happy path — no live mock-session.
func TestCheckBlock_NotBlocked(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	gate := mocks.NewMockMockSessionGate(ctrl)
	gate.EXPECT().HasActiveBlockingSession(gomock.Any(), gomock.Any()).Return(false, time.Time{}, nil)
	uc := &CheckBlock{Gate: gate}

	out, err := uc.Do(context.Background(), CheckBlockInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if out.Blocked || out.Reason != "" {
		t.Fatalf("unexpected non-zero result: %+v", out)
	}
}

// TestCheckBlock_NilGate ensures a CheckBlock UC without a wired gate (test
// or partial bring-up) reports "not blocked" instead of panicking.
func TestCheckBlock_NilGate(t *testing.T) {
	t.Parallel()
	uc := &CheckBlock{}
	out, err := uc.Do(context.Background(), CheckBlockInput{UserID: uuid.New()})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if out.Blocked {
		t.Fatal("blocked with nil gate")
	}
}

// TestAnalyze_AIAssistBlocked_RefusesBeforeLLM proves the defense-in-depth
// path: when the gate reports a live strict mock-session, Analyze.Do must
// reject with ErrAIAssistBlocked WITHOUT touching the LLM provider.
//
// Wave 13: fakes_test.go теперь mockgen-backed (newAnalyzeUC возвращает
// harness обёрнутый над wire-helpers). Этот тест дополнительно injects
// MockMockSessionGate в analyzer.MockGate чтобы проверить short-circuit.
func TestAnalyze_AIAssistBlocked_RefusesBeforeLLM(t *testing.T) {
	ctrl := gomock.NewController(t)
	h := newAnalyzeUC(t, 10, &llmScript{Model: "openai/gpt-4o-mini"})
	gate := mocks.NewMockMockSessionGate(ctrl)
	gate.EXPECT().HasActiveBlockingSession(gomock.Any(), gomock.Any()).Return(true, time.Time{}, nil)
	h.uc.MockGate = gate

	_, err := h.uc.Do(context.Background(), AnalyzeInput{
		UserID:     uuid.New(),
		PromptText: "should be refused",
	})
	if err == nil {
		t.Fatal("Do: expected error, got nil")
	}
	if !errors.Is(err, domain.ErrAIAssistBlocked) {
		t.Fatalf("err = %v, want ErrAIAssistBlocked", err)
	}
}
