// categorise_task.go — Phase 10 TaskBoard auto-place (2026-05-04).
//
// Когда юзер создаёт новую task через CreateTask или AI генерит через
// SpawnAITask, опционально зовём LLM чтобы placement'нуть в правильную
// column (todo/doing/done) + add tags по deadline + kind. Latency-bound
// (UI ждёт drag-drop), 8B-class через TaskTaskboardCategorise.
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

	"druz9/shared/pkg/llmchain"
)

// CategoriseTaskOutput — что LLM решил.
type CategoriseTaskOutput struct {
	// Column ∈ todo | doing | done. Default — todo.
	Column string `json:"column"`
	// Tags — optional list of short labels (e.g. ["streaming", "urgent"]).
	Tags []string `json:"tags"`
	// EstimatedMinutes — 0 if unknown.
	EstimatedMinutes int `json:"estimated_minutes"`
}

// CategoriseTaskInput.
type CategoriseTaskInput struct {
	Title    string
	BriefMD  string
	Kind     string // hone domain TaskKind
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
		MaxTokens:   200,
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

const categoriseSystemPrompt = `You categorise a freshly-created kanban task.

Output JSON ONLY (no markdown, no commentary):
{"column":"todo|doing|done","tags":["<short>","..."],"estimated_minutes":<int>}

Rules:
- Default column=todo. Use "doing" only if input clearly describes in-flight work; "done" only when title indicates completion.
- Tags are 1-3 SHORT labels (≤12 chars), lowercase, semantic (streaming, sql, urgent). Empty array allowed.
- estimated_minutes ∈ [0, 240]. 0 = unknown.`

func buildCategorisePrompt(in CategoriseTaskInput) string {
	var b strings.Builder
	fmt.Fprintf(&b, "TASK\n  title: %s\n  kind: %s\n", in.Title, in.Kind)
	if in.SkillKey != "" {
		fmt.Fprintf(&b, "  skill: %s\n", in.SkillKey)
	}
	if in.DeadlineISO != "" {
		fmt.Fprintf(&b, "  deadline: %s\n", in.DeadlineISO)
	}
	if in.BriefMD != "" {
		fmt.Fprintf(&b, "  brief:\n%s\n", in.BriefMD)
	}
	b.WriteString("\nReturn placement decision.")
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
