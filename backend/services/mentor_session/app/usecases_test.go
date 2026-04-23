package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/mentor_session/domain"

	"github.com/google/uuid"
)

func nopLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestRequestSession_NotImplemented(t *testing.T) {
	uc := NewRequestSession(nil, nopLogger())
	_, err := uc.Do(context.Background(), uuid.New(), uuid.New(), time.Now(), 60)
	if !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("want ErrNotImplemented, got %v", err)
	}
}

func TestAcceptSession_NotImplemented(t *testing.T) {
	uc := NewAcceptSession(nil, nopLogger())
	if err := uc.Do(context.Background(), uuid.New()); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("got %v", err)
	}
}

func TestCompleteSession_NotImplemented(t *testing.T) {
	uc := NewCompleteSession(nil, nopLogger())
	if err := uc.Do(context.Background(), uuid.New()); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("got %v", err)
	}
}

func TestListMentors_NotImplemented(t *testing.T) {
	uc := NewListMentors(nil, nopLogger())
	_, err := uc.Do(context.Background(), "ru", 20)
	if !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("got %v", err)
	}
}

func TestEscrow_PanicsInPhase1(t *testing.T) {
	t.Run("Release", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("ReleaseEscrow must panic in Phase 1")
			}
		}()
		_ = ReleaseEscrow(context.Background(), uuid.New())
	})
	t.Run("Refund", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Fatal("RefundEscrow must panic in Phase 1")
			}
		}()
		_ = RefundEscrow(context.Background(), uuid.New())
	})
}

func TestNilLogger_Panics(t *testing.T) {
	cases := map[string]func(){
		"RequestSession":  func() { NewRequestSession(nil, nil) },
		"AcceptSession":   func() { NewAcceptSession(nil, nil) },
		"CompleteSession": func() { NewCompleteSession(nil, nil) },
		"ListMentors":     func() { NewListMentors(nil, nil) },
	}
	for name, f := range cases {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("%s: expected panic on nil logger", name)
				}
			}()
			f()
		})
	}
}
