package infra

import (
	"testing"
	"time"
)

// Keyset-cursor round-trip: JSON encode → base64 → decode → equal.
// Покрывает две инварианта:
//   - пустая строка декодируется в нулевой cursor (first page);
//   - невалидный base64 / не-JSON — явный error, не тихий zero-value.
func TestNotesCursor_RoundTrip(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 4, 24, 12, 34, 56, 789e6, time.UTC)
	want := notesListCursor{UpdatedAt: ts, ID: "9e7b02ef-1234-4aaa-bbbb-000000000042"}

	enc := encodeNotesCursor(want)
	if enc == "" {
		t.Fatalf("encodeNotesCursor returned empty")
	}

	got, err := decodeNotesCursor(enc)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !got.UpdatedAt.Equal(want.UpdatedAt) {
		t.Errorf("UpdatedAt: got %v, want %v", got.UpdatedAt, want.UpdatedAt)
	}
	if got.ID != want.ID {
		t.Errorf("ID: got %q, want %q", got.ID, want.ID)
	}
}

func TestNotesCursor_EmptyDecodesToZero(t *testing.T) {
	t.Parallel()
	c, err := decodeNotesCursor("")
	if err != nil {
		t.Fatalf("decode empty: %v", err)
	}
	if !c.UpdatedAt.IsZero() || c.ID != "" {
		t.Errorf("expected zero cursor, got %+v", c)
	}
}

func TestNotesCursor_InvalidReturnsError(t *testing.T) {
	t.Parallel()
	if _, err := decodeNotesCursor("!!!not-base64!!!"); err == nil {
		t.Errorf("expected decode error for garbage cursor")
	}
	// valid base64 but not JSON → unmarshal error
	if _, err := decodeNotesCursor("YWJj"); err == nil { // "abc"
		t.Errorf("expected unmarshal error for non-json cursor")
	}
}
