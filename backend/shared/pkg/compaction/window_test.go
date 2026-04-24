package compaction

import (
	"strconv"
	"testing"
)

// мкТурн — компактный конструктор turn'а для table-driven тестов.
func mkTurn(role, content string) Turn { return Turn{Role: role, Content: content} }

func gen(n int) []Turn {
	out := make([]Turn, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, mkTurn("user", "t"+strconv.Itoa(i)))
	}
	return out
}

func TestBuildWindow_Boundaries(t *testing.T) {
	cfg := Config{WindowSize: 10, Threshold: 15}

	cases := []struct {
		name                string
		n                   int
		wantTail            int
		wantNeedsCompaction bool
		wantOldTurns        int
	}{
		{"empty", 0, 0, false, 0},
		{"one", 1, 1, false, 0},
		{"exactly_window", 10, 10, false, 0},
		{"just_over_window", 11, 10, false, 0},
		{"at_threshold", 15, 10, false, 0},
		{"just_over_threshold", 16, 10, true, 6},
		{"large_25", 25, 10, true, 15},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := BuildWindow(gen(tc.n), "", cfg)
			if got := len(w.Tail); got != tc.wantTail {
				t.Fatalf("tail len: got %d, want %d", got, tc.wantTail)
			}
			if w.NeedsCompaction != tc.wantNeedsCompaction {
				t.Fatalf("needs compaction: got %v, want %v", w.NeedsCompaction, tc.wantNeedsCompaction)
			}
			if got := len(w.OldTurns); got != tc.wantOldTurns {
				t.Fatalf("old turns: got %d, want %d", got, tc.wantOldTurns)
			}
		})
	}
}

func TestBuildWindow_PreservesRunningSummary(t *testing.T) {
	cfg := Config{WindowSize: 10, Threshold: 15}
	w := BuildWindow(gen(5), "prev summary", cfg)
	if w.RunningSummary != "prev summary" {
		t.Fatalf("running summary not preserved: %q", w.RunningSummary)
	}
}

func TestBuildWindow_TailIsLastN(t *testing.T) {
	cfg := Config{WindowSize: 3, Threshold: 5}
	turns := []Turn{
		{Role: "user", Content: "a"},
		{Role: "user", Content: "b"},
		{Role: "user", Content: "c"},
		{Role: "user", Content: "d"},
		{Role: "user", Content: "e"},
		{Role: "user", Content: "f"},
	}
	w := BuildWindow(turns, "", cfg)
	if !w.NeedsCompaction {
		t.Fatalf("expected compaction trigger at threshold+1")
	}
	if len(w.Tail) != 3 || w.Tail[0].Content != "d" || w.Tail[2].Content != "f" {
		t.Fatalf("tail not correct slice: %+v", w.Tail)
	}
	if len(w.OldTurns) != 3 || w.OldTurns[0].Content != "a" || w.OldTurns[2].Content != "c" {
		t.Fatalf("old turns not correct slice: %+v", w.OldTurns)
	}
}

func TestBuildWindow_NoAliasing(t *testing.T) {
	// Мутация исходного слайса после BuildWindow не должна повлиять
	// на Window.Tail/OldTurns (пакет должен копировать).
	cfg := Config{WindowSize: 2, Threshold: 3}
	src := []Turn{{Content: "x"}, {Content: "y"}, {Content: "z"}, {Content: "w"}}
	w := BuildWindow(src, "", cfg)
	src[0].Content = "MUT"
	src[3].Content = "MUT"
	if w.OldTurns[0].Content == "MUT" || w.Tail[len(w.Tail)-1].Content == "MUT" {
		t.Fatalf("BuildWindow aliases source slice")
	}
}

func TestConfigValidate(t *testing.T) {
	if err := (Config{WindowSize: 0, Threshold: 10}).Validate(); err == nil {
		t.Fatal("window_size=0 must error")
	}
	if err := (Config{WindowSize: 10, Threshold: 5}).Validate(); err == nil {
		t.Fatal("threshold<window must error")
	}
	if err := DefaultConfig().Validate(); err != nil {
		t.Fatalf("default config must be valid: %v", err)
	}
}
