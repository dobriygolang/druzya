package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/cohort/domain"

	"github.com/google/uuid"
)

func nopLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestUseCases_NotImplemented(t *testing.T) {
	if _, err := NewCreateCohort(nil, nopLogger()).Do(context.Background(), uuid.New(), "FAANG May", time.Now().Add(56*24*time.Hour)); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("CreateCohort: %v", err)
	}
	if _, err := NewJoinCohort(nil, nopLogger()).Do(context.Background(), uuid.New(), "tok"); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("JoinCohort: %v", err)
	}
	if _, err := NewGetLeaderboard(nil, nopLogger()).Do(context.Background(), uuid.New(), "2026-W17"); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("GetLeaderboard: %v", err)
	}
	if _, err := NewIssueInvite(nil, nopLogger()).Do(context.Background(), uuid.New(), uuid.New(), 5, time.Hour); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("IssueInvite: %v", err)
	}
}

func TestNilLogger_Panics(t *testing.T) {
	cases := map[string]func(){
		"CreateCohort":   func() { NewCreateCohort(nil, nil) },
		"JoinCohort":     func() { NewJoinCohort(nil, nil) },
		"GetLeaderboard": func() { NewGetLeaderboard(nil, nil) },
		"IssueInvite":    func() { NewIssueInvite(nil, nil) },
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
