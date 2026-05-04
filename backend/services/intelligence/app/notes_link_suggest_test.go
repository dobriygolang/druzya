package app

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestParseLinkSuggestions_FiltersHallucination(t *testing.T) {
	id1 := uuid.New()
	id2 := uuid.New()
	hallucinated := uuid.New()
	allowed := []NotesLinkCandidate{
		{NoteID: id1, Title: "a"},
		{NoteID: id2, Title: "b"},
	}
	raw := `[
		{"target_note_id":"` + id1.String() + `","score":0.9,"reason":"strong overlap"},
		{"target_note_id":"` + hallucinated.String() + `","score":0.7,"reason":"made up"},
		{"target_note_id":"` + id2.String() + `","score":0.4,"reason":"loose"}
	]`
	out, err := parseLinkSuggestions(raw, allowed)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 (hallucinated dropped), got %d", len(out))
	}
}

func TestParseLinkSuggestions_DropsBadScores(t *testing.T) {
	id := uuid.New()
	allowed := []NotesLinkCandidate{{NoteID: id, Title: "a"}}
	raw := `[
		{"target_note_id":"` + id.String() + `","score":1.5,"reason":"bad"}
	]`
	out, err := parseLinkSuggestions(raw, allowed)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 0 {
		t.Fatalf("want 0 (out-of-range), got %d", len(out))
	}
}

func TestCacheKey_Stable(t *testing.T) {
	tid := uuid.New()
	c1 := uuid.New()
	c2 := uuid.New()
	a := SuggestNoteLinksInput{TargetNoteID: tid, Candidates: []NotesLinkCandidate{{NoteID: c1}, {NoteID: c2}}}
	b := SuggestNoteLinksInput{TargetNoteID: tid, Candidates: []NotesLinkCandidate{{NoteID: c2}, {NoteID: c1}}}
	if a.CacheKey() != b.CacheKey() {
		t.Fatal("cache key must be order-independent")
	}
	if !strings.Contains(a.CacheKey(), b.CacheKey()) && a.CacheKey() != b.CacheKey() {
		t.Fatal("keys equal expected")
	}
}
