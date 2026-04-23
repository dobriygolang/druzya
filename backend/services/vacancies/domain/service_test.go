package domain

import (
	"reflect"
	"testing"
)

func TestNormalizeSkills_DedupesAndCollapsesSynonyms(t *testing.T) {
	t.Parallel()
	in := []string{"Go", "go", " GOLANG ", "PostgreSQL", "postgres", "Kubernetes", "k8s", ""}
	want := []string{"go", "kubernetes", "postgresql"}
	got := NormalizeSkills(in)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("want %v got %v", want, got)
	}
}

func TestComputeSkillGap(t *testing.T) {
	t.Parallel()
	gap := ComputeSkillGap(
		[]string{"go", "postgresql", "kubernetes"},
		[]string{"go", "redis"},
	)
	if !reflect.DeepEqual(gap.Required, []string{"go", "kubernetes", "postgresql"}) {
		t.Errorf("required: %v", gap.Required)
	}
	if !reflect.DeepEqual(gap.Matched, []string{"go"}) {
		t.Errorf("matched: %v", gap.Matched)
	}
	if !reflect.DeepEqual(gap.Missing, []string{"kubernetes", "postgresql"}) {
		t.Errorf("missing: %v", gap.Missing)
	}
	if !reflect.DeepEqual(gap.Extra, []string{"redis"}) {
		t.Errorf("extra: %v", gap.Extra)
	}
}

func TestComputeSkillGap_EmptyUserKnownNothing(t *testing.T) {
	t.Parallel()
	gap := ComputeSkillGap([]string{"go"}, nil)
	if len(gap.Matched) != 0 {
		t.Errorf("matched should be empty: %v", gap.Matched)
	}
	if !reflect.DeepEqual(gap.Missing, []string{"go"}) {
		t.Errorf("missing: %v", gap.Missing)
	}
}

func TestIsValidSourceAndStatus(t *testing.T) {
	t.Parallel()
	if !IsValidSource(SourceHH) {
		t.Error("hh should be valid")
	}
	if IsValidSource("nope") {
		t.Error("nope should not be valid")
	}
	if !IsValidStatus(StatusSaved) || !IsValidStatus(StatusOffer) {
		t.Error("saved/offer should be valid")
	}
	if IsValidStatus("nope") {
		t.Error("nope status should be invalid")
	}
}
