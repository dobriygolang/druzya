package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"druz9/orgs/domain"

	"github.com/google/uuid"
)

// nopLogger returns a discarding slog.Logger usable in tests.
func nopLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestCreateOrg_ReturnsNotImplemented(t *testing.T) {
	uc := NewCreateOrg(nil, nopLogger())
	_, err := uc.Do(context.Background(), "Acme", "acme", uuid.New())
	if !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("want ErrNotImplemented, got %v", err)
	}
}

func TestAssignSeat_ReturnsNotImplemented(t *testing.T) {
	uc := NewAssignSeat(nil, nopLogger())
	_, err := uc.Do(context.Background(), uuid.New(), "candidate@example.com")
	if !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("want ErrNotImplemented, got %v", err)
	}
}

func TestRevokeSeat_ReturnsNotImplemented(t *testing.T) {
	uc := NewRevokeSeat(nil, nopLogger())
	if err := uc.Do(context.Background(), uuid.New()); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("want ErrNotImplemented, got %v", err)
	}
}

func TestGetDashboard_ReturnsNotImplemented(t *testing.T) {
	uc := NewGetDashboard(nil, nopLogger())
	_, err := uc.Do(context.Background(), uuid.New(), "2026-W17")
	if !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("want ErrNotImplemented, got %v", err)
	}
}

func TestNilLogger_Panics(t *testing.T) {
	cases := map[string]func(){
		"CreateOrg":    func() { NewCreateOrg(nil, nil) },
		"AssignSeat":   func() { NewAssignSeat(nil, nil) },
		"RevokeSeat":   func() { NewRevokeSeat(nil, nil) },
		"GetDashboard": func() { NewGetDashboard(nil, nil) },
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
