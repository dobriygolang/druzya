package app

import (
	"strings"
	"testing"
)

func TestParseCategorise_OK(t *testing.T) {
	raw := `{"column":"todo","tags":["streaming","urgent"],"estimated_minutes":45}`
	out, err := parseCategorise(raw)
	if err != nil {
		t.Fatal(err)
	}
	if out.Column != "todo" || len(out.Tags) != 2 || out.EstimatedMinutes != 45 {
		t.Fatalf("bad parse: %+v", out)
	}
}

func TestParseCategorise_DefaultsColumn(t *testing.T) {
	raw := `{"tags":["x"],"estimated_minutes":10}`
	out, err := parseCategorise(raw)
	if err != nil {
		t.Fatal(err)
	}
	if out.Column != "todo" {
		t.Fatalf("default column not applied: %+v", out)
	}
}

func TestParseCategorise_RejectsBadColumn(t *testing.T) {
	raw := `{"column":"icebox","tags":[],"estimated_minutes":0}`
	if _, err := parseCategorise(raw); err == nil || !strings.Contains(err.Error(), "invalid column") {
		t.Fatalf("expected invalid column error, got %v", err)
	}
}

func TestParseCategorise_TrimsTags(t *testing.T) {
	raw := `{"column":"todo","tags":["A","this-is-too-long-tag","b","c","d"],"estimated_minutes":0}`
	out, _ := parseCategorise(raw)
	if len(out.Tags) != 3 {
		t.Fatalf("expected 3 tags after cap, got %d: %+v", len(out.Tags), out.Tags)
	}
	if out.Tags[1] != "this-is-too-" {
		t.Fatalf("expected truncated tag, got %q", out.Tags[1])
	}
}

func TestParseCategorise_BadEstimated(t *testing.T) {
	raw := `{"column":"todo","tags":[],"estimated_minutes":600}`
	if _, err := parseCategorise(raw); err == nil {
		t.Fatal("expected estimated out of range error")
	}
}
