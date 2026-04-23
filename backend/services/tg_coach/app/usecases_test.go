package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"druz9/tg_coach/domain"

	"github.com/google/uuid"
)

func nopLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestParseCommand(t *testing.T) {
	cases := []struct {
		in    string
		ok    bool
		name  string
		nargs int
	}{
		{"/start", true, "start", 0},
		{"/start abc123", true, "start", 1},
		{"/today", true, "today", 0},
		{"/streak@druz9_bot", true, "streak", 0},
		{"hello", false, "", 0},
		{"", false, "", 0},
		{"/", false, "", 0},
		{"  /today  ", true, "today", 0},
	}
	for _, c := range cases {
		got, ok := ParseCommand(c.in)
		if ok != c.ok {
			t.Errorf("ParseCommand(%q) ok=%v want %v", c.in, ok, c.ok)
			continue
		}
		if !ok {
			continue
		}
		if got.Name != c.name {
			t.Errorf("ParseCommand(%q) name=%q want %q", c.in, got.Name, c.name)
		}
		if len(got.Args) != c.nargs {
			t.Errorf("ParseCommand(%q) nargs=%d want %d", c.in, len(got.Args), c.nargs)
		}
	}
}

func TestUseCases_NotImplemented(t *testing.T) {
	if _, err := NewIssueLinkToken(nil, nopLogger()).Do(context.Background(), uuid.New()); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("IssueLinkToken: %v", err)
	}
	if err := NewLinkAccount(nil, nopLogger()).Do(context.Background(), "tok", 42, "alice"); !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("LinkAccount: %v", err)
	}
	_, err := NewHandleCommand(nil, nopLogger()).Do(context.Background(), 42, domain.Command{Name: "today"})
	if !errors.Is(err, domain.ErrNotImplemented) {
		t.Fatalf("HandleCommand: %v", err)
	}
}

func TestNilLogger_Panics(t *testing.T) {
	cases := map[string]func(){
		"IssueLinkToken": func() { NewIssueLinkToken(nil, nil) },
		"LinkAccount":    func() { NewLinkAccount(nil, nil) },
		"HandleCommand":  func() { NewHandleCommand(nil, nil) },
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
