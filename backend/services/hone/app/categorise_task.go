// categorise_task.go — Phase 10 TaskBoard auto-place (2026-05-04).
//
// Когда юзер создаёт новую task через CreateTask или AI генерит через
// SpawnAITask, опционально зовём LLM чтобы placement'нуть в правильную
// column (todo/doing/done) + add tags по deadline + kind. Latency-bound
// (UI ждёт drag-drop), 8B-class через TaskTaskboardCategorise.
//
// Phase J / H3 (2026-05-12) — extended:
//   - Kind inference: LLM decides one of {algo|sysdesign|quiz|reflection|reading|custom}
//     based on title/brief. Replaces input.Kind (auto-categoriser overrides).
//   - Reasoning: 1-2 sentence explanation surfaced as a toast «Auto-tagged
//     as Algo · why?». Cheap to regen, не персистится в DB.
//   - Confidence 0..1: low-confidence (<0.4) → UI skip auto-toast, поскольку
//     LLM не уверен и юзер всё равно перевыберет вручную.
//
// UC pure-functional: input → output. Caller (handler / coach_listener)
// уже сам решает звать ли (например, только для AI-sourced tasks или
// при explicit user-trigger «coach, organise this»).
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"druz9/hone/domain"
	"druz9/shared/pkg/llmchain"
)

// CategoriseTaskOutput — что LLM решил.
type CategoriseTaskOutput struct {
	// Column ∈ todo | doing | done. Default — todo.
	Column string `json:"column"`
	// Kind ∈ algo | sysdesign | quiz | reflection | reading | custom.
	// Empty (или unknown) — fallback на input.Kind в caller'е.
	Kind string `json:"kind"`
	// Tags — optional list of short labels (e.g. ["streaming", "urgent"]).
	Tags []string `json:"tags"`
	// EstimatedMinutes — 0 if unknown.
	EstimatedMinutes int `json:"estimated_minutes"`
	// Reasoning — 1-2 sentence rationale used for the «why?» toast peek.
	// Cap 200 chars (LLM tends to over-explain at 8B).
	Reasoning string `json:"reasoning"`
	// Confidence — 0..1 self-reported confidence. Sub-0.4 hints UI to
	// skip the toast (low signal → noise).
	Confidence float32 `json:"confidence"`
}

// CategoriseTaskInput.
type CategoriseTaskInput struct {
	Title    string
	BriefMD  string
	Kind     string // hone domain TaskKind (current value, may be overridden)
	SkillKey string
	// DeadlineISO — RFC3339 если есть (e.g. interview date).
	DeadlineISO string
}

// CategoriseTask — UC.
type CategoriseTask struct {
	Chain   llmchain.ChatClient
	Timeout time.Duration
}

func (uc *CategoriseTask) Do(ctx context.Context, in CategoriseTaskInput) (CategoriseTaskOutput, error) {
	if strings.TrimSpace(in.Title) == "" {
		return CategoriseTaskOutput{}, fmt.Errorf("hone.CategoriseTask: empty title")
	}
	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 8 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	prompt := buildCategorisePrompt(in)
	resp, err := uc.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskTaskboardCategorise,
		JSONMode:    true,
		Temperature: 0.2,
		MaxTokens:   240,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: categoriseSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		return CategoriseTaskOutput{}, fmt.Errorf("hone.CategoriseTask: %w", err)
	}
	out, err := parseCategorise(resp.Content)
	if err != nil {
		return CategoriseTaskOutput{}, fmt.Errorf("hone.CategoriseTask parse: %w", err)
	}
	return out, nil
}

const categoriseSystemPrompt = `You categorise a freshly-created kanban task for a senior IT developer's focus cockpit.

Output JSON ONLY (no markdown, no commentary):
{"column":"todo|doing|done","kind":"algo|sysdesign|quiz|reflection|reading|custom","tags":["<short>","..."],"estimated_minutes":<int>,"reasoning":"<one short sentence>","confidence":<0..1>}

Kind rules:
- algo       — competitive programming, LeetCode-style, data structures, dynamic programming, graph algorithms, big-O analysis.
- sysdesign  — distributed systems, scalability, architecture diagrams, cap theorem, load balancers, sharding, message queues.
- quiz       — Q&A drills, flashcards, multiple-choice, theory recall, English grammar drills.
- reflection — retrospectives, journaling, post-mortems, weekly review, learnings.
- reading    — books, articles, papers, RFCs, documentation deep-dives.
- custom     — none of the above, or task too vague (project setup, personal, errand).

Column rules:
- Default column=todo. Use "doing" only if input clearly describes in-flight work; "done" only when title indicates completion.

Tag rules:
- Tags are 1-3 SHORT labels (≤12 chars), lowercase, semantic (streaming, sql, urgent). Empty array allowed.
- estimated_minutes ∈ [0, 240]. 0 = unknown.

Reasoning rules:
- 1 short sentence (≤140 chars) explaining the kind choice: name the trigger words you spotted, e.g. «Mentioned 'BFS' + 'O(V+E)' → algo».
- Be concrete. Don't say «looks like algo» — say WHAT in the input suggested algo.

Confidence rules:
- 0.9-1.0 → unambiguous (clear keywords match a single kind).
- 0.5-0.8 → likely but title is short / mixed signals.
- 0.0-0.4 → vague / could be multiple kinds → caller may suppress toast.`

func buildCategorisePrompt(in CategoriseTaskInput) string {
	var b strings.Builder
	fmt.Fprintf(&b, "TASK\n  title: %s\n", in.Title)
	if in.Kind != "" {
		fmt.Fprintf(&b, "  current_kind: %s (may be wrong — re-infer)\n", in.Kind)
	}
	if in.SkillKey != "" {
		fmt.Fprintf(&b, "  skill: %s\n", in.SkillKey)
	}
	if in.DeadlineISO != "" {
		fmt.Fprintf(&b, "  deadline: %s\n", in.DeadlineISO)
	}
	if in.BriefMD != "" {
		fmt.Fprintf(&b, "  brief:\n%s\n", in.BriefMD)
	}
	b.WriteString("\nReturn placement + kind decision with reasoning.")
	return b.String()
}

func parseCategorise(raw string) (CategoriseTaskOutput, error) {
	cleaned := stripCategoriseFences(raw)
	var out CategoriseTaskOutput
	if err := json.Unmarshal([]byte(cleaned), &out); err != nil {
		return CategoriseTaskOutput{}, fmt.Errorf("unmarshal categorise: %w", err)
	}
	if out.Column == "" {
		out.Column = "todo"
	}
	switch out.Column {
	case "todo", "doing", "done":
	default:
		return CategoriseTaskOutput{}, fmt.Errorf("invalid column %q", out.Column)
	}
	// Kind: validate against domain. Empty / unknown — caller falls back
	// to input kind (e.g. user-picked from create modal).
	if out.Kind != "" {
		k := domain.TaskKind(strings.ToLower(strings.TrimSpace(out.Kind)))
		if !k.IsValid() {
			out.Kind = "" // signal to caller: ignore (don't fail).
		} else {
			out.Kind = string(k)
		}
	}
	if out.EstimatedMinutes < 0 || out.EstimatedMinutes > 240 {
		return CategoriseTaskOutput{}, fmt.Errorf("estimated_minutes %d out of [0,240]", out.EstimatedMinutes)
	}
	// Cap tags at 3, trim long.
	if len(out.Tags) > 3 {
		out.Tags = out.Tags[:3]
	}
	cleaned2 := out.Tags[:0]
	for _, t := range out.Tags {
		t = strings.TrimSpace(strings.ToLower(t))
		if t == "" {
			continue
		}
		if len(t) > 12 {
			t = t[:12]
		}
		cleaned2 = append(cleaned2, t)
	}
	out.Tags = cleaned2
	// Clamp reasoning length (LLM tends to spill at 8B even with explicit ≤140).
	out.Reasoning = strings.TrimSpace(out.Reasoning)
	if len(out.Reasoning) > 200 {
		out.Reasoning = out.Reasoning[:200]
	}
	// Clamp confidence — defensive (sometimes LLM returns 1.5 or -0.1).
	if out.Confidence < 0 {
		out.Confidence = 0
	}
	if out.Confidence > 1 {
		out.Confidence = 1
	}
	return out, nil
}

func stripCategoriseFences(raw string) string {
	s := strings.TrimSpace(raw)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(s, "```"))
}
