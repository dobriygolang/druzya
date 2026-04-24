package infra

import (
	"strings"
	"testing"

	"druz9/hone/domain"
)

// ─── parsePlanJSON ─────────────────────────────────────────────────────────

func TestParsePlanJSON_HappyPath(t *testing.T) {
	t.Parallel()
	raw := `{"items":[
	  {"id":"a1","kind":"solve","title":"BFS on trees","subtitle":"weak spot","target_ref":"dsa/bfs","deep_link":"druz9://task/dsa/bfs","estimated_min":25},
	  {"id":"a2","kind":"mock","title":"System design mock","subtitle":"prep","target_ref":"system-design","deep_link":"druz9://mock/start?section=system-design","estimated_min":45}
	]}`
	got, err := parsePlanJSON(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d items, want 2", len(got))
	}
	if got[0].Kind != domain.PlanItemSolve || got[1].Kind != domain.PlanItemMock {
		t.Errorf("kinds = %v / %v", got[0].Kind, got[1].Kind)
	}
	if got[0].EstimatedMin != 25 {
		t.Errorf("estimated_min = %d, want 25", got[0].EstimatedMin)
	}
}

func TestParsePlanJSON_RationaleAndSkillKey(t *testing.T) {
	t.Parallel()
	raw := `{"items":[
	  {"id":"a1","kind":"solve","title":"BFS on trees","subtitle":"weak spot",
	   "rationale":"Closes your Graph Algorithms gap (progress=24 — lowest in atlas).",
	   "skill_key":"algo.bfs",
	   "target_ref":"dsa/bfs","deep_link":"druz9://task/dsa/bfs","estimated_min":25}
	]}`
	got, err := parsePlanJSON(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d items, want 1", len(got))
	}
	if got[0].SkillKey != "algo.bfs" {
		t.Errorf("SkillKey = %q, want algo.bfs", got[0].SkillKey)
	}
	if !strings.Contains(got[0].Rationale, "Graph Algorithms") {
		t.Errorf("Rationale = %q", got[0].Rationale)
	}
}

func TestParsePlanJSON_StripsCodeFences(t *testing.T) {
	t.Parallel()
	raw := "```json\n" + `{"items":[{"id":"x","kind":"solve","title":"T","subtitle":"S","target_ref":"","deep_link":"","estimated_min":20}]}` + "\n```"
	got, err := parsePlanJSON(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d items, want 1", len(got))
	}
}

func TestParsePlanJSON_UnknownKindDowngradesToCustom(t *testing.T) {
	t.Parallel()
	// Anti-fallback: we don't fabricate plan structure, but we DO normalise a
	// mis-labelled kind to the neutral "custom" rather than dropping the row.
	// The title+subtitle from the model still carry signal for the user.
	raw := `{"items":[{"id":"x","kind":"invent-a-new-kind","title":"do thing","subtitle":"why","target_ref":"","deep_link":"","estimated_min":25}]}`
	got, err := parsePlanJSON(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Kind != domain.PlanItemCustom {
		t.Fatalf("expected single custom item, got %+v", got)
	}
}

func TestParsePlanJSON_DropsDegenerateRows(t *testing.T) {
	t.Parallel()
	// Empty title → the row is useless regardless of kind. Drop it rather
	// than render a blank card.
	raw := `{"items":[
	  {"id":"a","kind":"solve","title":"","subtitle":"s","target_ref":"","deep_link":"","estimated_min":25},
	  {"id":"b","kind":"solve","title":"good one","subtitle":"s","target_ref":"","deep_link":"","estimated_min":25}
	]}`
	got, err := parsePlanJSON(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Title != "good one" {
		t.Fatalf("degenerate row was not dropped: %+v", got)
	}
}

func TestParsePlanJSON_EmptyArray(t *testing.T) {
	t.Parallel()
	// Empty items array — anti-fallback says fail; GeneratePlan will retry,
	// second miss surfaces ErrLLMUnavailable to the client.
	if _, err := parsePlanJSON(`{"items":[]}`); err == nil {
		t.Fatal("expected error on empty items array")
	}
}

func TestParsePlanJSON_OutOfRangeEstimatedMinClamps(t *testing.T) {
	t.Parallel()
	// 0 and 10000 both land on the default. 240 is inside the cap and is
	// preserved (an upper bound is a policy guard, not a transform).
	raw := `{"items":[
	  {"id":"z","kind":"solve","title":"t","subtitle":"s","target_ref":"","deep_link":"","estimated_min":0},
	  {"id":"y","kind":"solve","title":"t","subtitle":"s","target_ref":"","deep_link":"","estimated_min":10000},
	  {"id":"x","kind":"solve","title":"t","subtitle":"s","target_ref":"","deep_link":"","estimated_min":240}
	]}`
	got, err := parsePlanJSON(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got[0].EstimatedMin != 25 || got[1].EstimatedMin != 25 || got[2].EstimatedMin != 240 {
		t.Fatalf("estimated-min clamping wrong: %d / %d / %d", got[0].EstimatedMin, got[1].EstimatedMin, got[2].EstimatedMin)
	}
}

func TestParsePlanJSON_Garbage(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{"", "{", "not json at all", `{"items":"wrong-type"}`} {
		if _, err := parsePlanJSON(raw); err == nil {
			t.Errorf("expected error for %q", raw)
		}
	}
}

// ─── splitCritiqueBySections ───────────────────────────────────────────────

func TestSplitCritiqueBySections_FourSections(t *testing.T) {
	t.Parallel()
	in := strings.Join([]string{
		"## STRENGTHS",
		"- clear separation",
		"- labelled edges",
		"",
		"## CONCERNS",
		"- api→postgres without cache",
		"",
		"## MISSING",
		"- retry policy",
		"",
		"## CLOSING",
		"Add a cache layer first; everything else is secondary.",
	}, "\n")
	got := splitCritiqueBySections(in)
	if len(got) != 4 {
		t.Fatalf("got %d sections, want 4", len(got))
	}
	want := []domain.CritiqueSection{
		domain.CritiqueStrengths, domain.CritiqueConcerns, domain.CritiqueMissing, domain.CritiqueClosing,
	}
	for i := range got {
		if got[i].Section != want[i] {
			t.Errorf("section %d = %q, want %q", i, got[i].Section, want[i])
		}
		if got[i].Body == "" {
			t.Errorf("section %d body is empty", i)
		}
	}
}

func TestSplitCritiqueBySections_NoMarkers(t *testing.T) {
	t.Parallel()
	// The parser extracts nothing — callers decide whether to fall back to
	// a single "closing" emission.
	got := splitCritiqueBySections("just some free-form prose without any headers")
	if len(got) != 0 {
		t.Fatalf("expected zero sections when no markers, got %d", len(got))
	}
}

func TestSplitCritiqueBySections_UnknownHeaderKeepsInCurrent(t *testing.T) {
	t.Parallel()
	// A "## SOMETHING_ELSE" line that doesn't match a known keyword is
	// treated as content of the current section — conservative, never drops.
	in := strings.Join([]string{
		"## STRENGTHS",
		"- one",
		"## SIDENOTE",
		"still part of strengths prose",
		"## CONCERNS",
		"- real concern",
	}, "\n")
	got := splitCritiqueBySections(in)
	if len(got) != 2 {
		t.Fatalf("got %d sections, want 2", len(got))
	}
	if !strings.Contains(got[0].Body, "still part of strengths prose") {
		t.Errorf("unknown marker should not have split the section; body was %q", got[0].Body)
	}
}

func TestSplitCritiqueBySections_TrailingWhitespaceOnly(t *testing.T) {
	t.Parallel()
	// A section with only blank lines is dropped — flush() refuses empty
	// bodies so the stream doesn't emit meaningless packets.
	in := strings.Join([]string{
		"## STRENGTHS",
		"- good",
		"## CONCERNS",
		"",
		"",
		"## MISSING",
		"- x",
	}, "\n")
	got := splitCritiqueBySections(in)
	if len(got) != 2 {
		t.Fatalf("got %d sections, want 2 (concerns had empty body)", len(got))
	}
	if got[0].Section != domain.CritiqueStrengths || got[1].Section != domain.CritiqueMissing {
		t.Fatalf("wrong sections after drop: %+v", got)
	}
}
