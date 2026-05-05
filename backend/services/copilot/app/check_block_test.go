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
// NOTE: uses shared fakes_test.go fixtures (newFakeConversations / newFakeMessages
// / newFakeQuotas / newAnalyzeUC / fakeLLM) — those are deferred in R8 as a
// separate refactor; only the gate is mockgen-backed here.
func TestAnalyze_AIAssistBlocked_RefusesBeforeLLM(t *testing.T) {
	ctrl := gomock.NewController(t)
	convs := newFakeConversations()
	msgs := newFakeMessages(convs)
	quotas := newFakeQuotas(10)
	// Scripted LLM with NO deltas — if Analyze reaches Stream(), the
	// downstream code asserts on token counts and would surface a
	// different failure. Easier to just ensure we never get there:
	// the gate must short-circuit.
	llm := &fakeLLM{Model: "openai/gpt-4o-mini"}
	uc := newAnalyzeUC(t, convs, msgs, quotas, llm)
	gate := mocks.NewMockMockSessionGate(ctrl)
	gate.EXPECT().HasActiveBlockingSession(gomock.Any(), gomock.Any()).Return(true, time.Time{}, nil)
	uc.MockGate = gate

	_, err := uc.Do(context.Background(), AnalyzeInput{
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
