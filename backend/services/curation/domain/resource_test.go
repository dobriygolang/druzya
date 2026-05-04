package domain

import (
	"errors"
	"strings"
	"testing"
)

func validResource() Resource {
	return Resource{
		URL:      "https://mlcourse.ai/book/topic03/topic03_decision_trees.html",
		Title:    "Topic 3 · Decision Trees",
		Author:   "ods.ai",
		Kind:     KindCourse,
		Minutes:  45,
		Level:    LevelB,
		Priority: PriorityCore,
		Why:      "best intuition for impurity-based splitting without code",
	}
}

func TestResourceValidate_OK(t *testing.T) {
	if err := validResource().Validate(); err != nil {
		t.Fatalf("expected nil, got %v", err)
	}
}

func TestResourceValidate_BadFields(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*Resource)
	}{
		{"empty title", func(r *Resource) { r.Title = "  " }},
		{"empty why", func(r *Resource) { r.Why = "" }},
		{"relative url", func(r *Resource) { r.URL = "/local/path" }},
		{"non-http scheme", func(r *Resource) { r.URL = "ftp://example.com" }},
		{"bad kind", func(r *Resource) { r.Kind = "lecture" }},
		{"bad level", func(r *Resource) { r.Level = "X" }},
		{"bad priority", func(r *Resource) { r.Priority = "must" }},
		{"negative minutes", func(r *Resource) { r.Minutes = -5 }},
		{"bad depth", func(r *Resource) { r.Depth = "skim" }},
		{"blank topic", func(r *Resource) { r.TopicsCovered = []string{"ml_classical", " "} }},
		{"blank prereq", func(r *Resource) { r.Prereqs = []string{""} }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := validResource()
			tc.mut(&r)
			err := r.Validate()
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !errors.Is(err, ErrInvalidResource) {
				t.Fatalf("expected ErrInvalidResource, got %v", err)
			}
		})
	}
}

func TestResourceList_DuplicateURL(t *testing.T) {
	a := validResource()
	b := validResource()
	b.Title = "Different title same URL"
	err := ResourceList{a, b}.Validate()
	if !errors.Is(err, ErrInvalidResource) {
		t.Fatalf("expected ErrInvalidResource on duplicate URL, got %v", err)
	}
}

func TestResourceList_MarshalEmpty(t *testing.T) {
	var l ResourceList
	got, err := l.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "[]" {
		t.Fatalf("want []; got %s", got)
	}
}

func TestUnmarshal_NullAndEmpty(t *testing.T) {
	for _, in := range [][]byte{nil, []byte("null"), {}} {
		l, err := Unmarshal(in)
		if err != nil {
			t.Fatalf("input=%q: %v", in, err)
		}
		if l != nil {
			t.Fatalf("input=%q: expected nil, got %+v", in, l)
		}
	}
}

func TestRoundTrip(t *testing.T) {
	in := ResourceList{validResource()}
	raw, err := in.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	out, err := Unmarshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].URL != in[0].URL {
		t.Fatalf("roundtrip mismatch: %+v", out)
	}
	if err := out.Validate(); err != nil {
		t.Fatalf("roundtrip validate: %v", err)
	}
}

func TestExtendedFields_RoundTrip(t *testing.T) {
	r := validResource()
	r.TopicsCovered = []string{"ml_classical", "ml_evaluation"}
	r.Prereqs = []string{"ml_data_intuition"}
	r.Summary = "Decision trees and ensembles intuition. Skips formal information-theoretic derivation."
	r.Depth = DepthIntuition
	r.FormatNotes = "interactive"
	r.ReflectionPrompt = "Какой признак solver использует для split-выбора и почему?"

	if err := r.Validate(); err != nil {
		t.Fatalf("extended fields must validate: %v", err)
	}
	raw, err := ResourceList{r}.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"topics_covered"`) {
		t.Fatalf("expected topics_covered in JSON, got %s", raw)
	}
	if !strings.Contains(string(raw), `"depth":"intuition"`) {
		t.Fatalf("expected depth in JSON, got %s", raw)
	}
	out, err := Unmarshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	if out[0].Depth != DepthIntuition || len(out[0].TopicsCovered) != 2 {
		t.Fatalf("roundtrip extended fields lost: %+v", out[0])
	}
}

func TestOmitEmpty_KeepsBaseShape(t *testing.T) {
	// Base resource без extended fields — JSON не содержит лишних ключей.
	raw, err := ResourceList{validResource()}.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"topics_covered", "prereqs", "summary", "depth", "format_notes", "reflection_prompt"} {
		if strings.Contains(string(raw), `"`+k+`"`) {
			t.Fatalf("unexpected %q in minimal-resource JSON: %s", k, raw)
		}
	}
}
