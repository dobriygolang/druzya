// Package infra — daily plan synthesiser (Hone Coach).
//
// Builds a JSON-shaped daily plan from weakest atlas nodes + chronic skips
// + today's note context. See llm.go for shared helpers and floor types.
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"druz9/hone/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// ─── LLMChainPlanSynthesiser ──────────────────────────────────────────────

// LLMChainPlanSynthesiser generates a daily plan via Task=DailyPlanSynthesis.
// Output is strict JSON parsed into []PlanItem. One retry on parse failure;
// second failure surfaces ErrLLMUnavailable so the 503 is honest.
type LLMChainPlanSynthesiser struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainPlanSynthesiser wires the adapter. chain MUST be non-nil — the
// wirer falls back to NoLLMPlanSynthesiser when the chain is nil, never
// constructs this type. Panics enforce that invariant.
func NewLLMChainPlanSynthesiser(chain llmchain.ChatClient, log *slog.Logger) *LLMChainPlanSynthesiser {
	if chain == nil {
		panic("hone.NewLLMChainPlanSynthesiser: chain is required (use NoLLMPlanSynthesiser when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainPlanSynthesiser: logger is required (anti-fallback policy)")
	}
	return &LLMChainPlanSynthesiser{chain: chain, log: log, timeout: 30 * time.Second}
}

// planSynthPrompt is the system prompt. Kept compact — the model just
// needs to know the schema and the "why" axis. Per ChatGPT best practice
// we never say "pretty please" — just the constraint set.
const planSynthPrompt = `You are the daily-plan synthesiser for Hone, a focus cockpit for programmers.

Given a list of the user's weakest skill nodes (by atlas progress), produce 3-5 plan items for today.

Each item MUST be one of these kinds:
  - "solve"  : an algorithmic / design task to work on (target_ref = a task slug like "dsa/bfs-tree")
  - "mock"   : a mock interview (target_ref = a section like "system-design")
  - "review" : a code / PR review to do (target_ref = a PR URL or empty)
  - "read"   : a book / article segment (target_ref = optional URL)
  - "custom" : free-form

Constraints:
  - Do NOT invent a generic balanced plan. Every item must be grounded in an input weak node or chronic skip.
  - NEVER write generic titles such as "Solve a basic algorithmic problem", "Practice algorithms", "Do system design", "Review your notes", or "Start with the first item".
  - Do not repeat the same action/topic with minor wording changes.
  - If the user prompt includes "Today's note context", prioritize it over generic skill coverage: use the user's intent, blockers, and action hints as today's plan anchor.
  - If Today's blockers are present, include one tiny unblock item that attacks the blocker directly.
  - Prefer "solve" items targeting the weakest node; one per item.
  - Inject a "mock" item only when a weak node's progress is below 40 AND the section suggests a mock would help (system-design, behavioral).
  - subtitle MUST explain the "why" in one short sentence, referencing the weakness.
  - rationale: SECOND explanatory line aimed at motivation — reference the specific skill gap and the current progress number. 6-12 words. Example: "Closes your System Design gap (progress=28 — lowest in atlas)." Leave empty for "review" / "custom" items not tied to a skill node.
  - skill_key: MUST match the input node_key when the item targets a weak node (e.g. "algo.bfs"). Empty for "review" / "custom" items.
  - deep_link: for "solve" use "druz9://task/<target_ref>"; for "mock" use "druz9://mock/start?section=<target_ref>"; empty for others.
  - estimated_min: realistic, 15-60 range.

Resistance handling (CRITICAL):
  - The user prompt MAY include a "Chronic skips" section listing skills that have been dismissed multiple times recently.
  - For EACH chronic skill, you MUST produce ONE item that either:
      (a) breaks the topic into the smallest possible concrete sub-task (prefix title with "tiny: "; estimated_min=15), OR
      (b) replaces it with a reflection prompt — kind="custom", title="Why are you avoiding <skill>?", subtitle="Notice the resistance, name it. 2-minute write-up.", estimated_min=10, target_ref="", deep_link="".
  - Pick (a) when the skill has a clear atomic sub-task; (b) when the user has skipped it 3+ times and small tasks haven't worked.
  - Set skill_key to the chronic skill's key for both (a) and (b).

Output EXACTLY this JSON shape, nothing else:
{"items":[{"id":"<short-id>","kind":"solve|mock|review|read|custom","title":"...","subtitle":"...","rationale":"...","skill_key":"...","target_ref":"...","deep_link":"...","estimated_min":25}]}

Return ONLY the JSON object. No prose, no code fences.`

// Synthesise builds the prompt, calls the chain, parses the response.
func (s *LLMChainPlanSynthesiser) Synthesise(ctx context.Context, userID uuid.UUID, weak []domain.WeakNode, chronic []domain.ChronicSkill, today domain.TodayContext, date time.Time) ([]domain.PlanItem, error) {
	userMsg := buildPlanUserPrompt(weak, chronic, today, date)

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := s.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskDailyPlanSynthesis,
			JSONMode:    true,
			Temperature: 0.3, // some diversity but reproducible-ish across retries
			MaxTokens:   900,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: planSynthPrompt},
				{Role: llmchain.RoleUser, Content: userMsg},
			},
		})
		if err != nil {
			lastErr = err
			s.log.Warn("hone.LLMChainPlanSynthesiser: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("user_id", userID.String()))
			continue
		}
		items, parseErr := parsePlanJSON(resp.Content)
		if parseErr != nil {
			lastErr = parseErr
			s.log.Warn("hone.LLMChainPlanSynthesiser: parse error",
				slog.Any("err", parseErr), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 200)))
			continue
		}
		// Stamp stable ids — LLM-produced ids collide across regenerations.
		for i := range items {
			if items[i].ID == "" {
				items[i].ID = newPlanItemID()
			}
			items[i].Dismissed = false
			items[i].Completed = false
		}
		return items, nil
	}
	return nil, fmt.Errorf("hone.LLMChainPlanSynthesiser.Synthesise: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

func buildPlanUserPrompt(weak []domain.WeakNode, chronic []domain.ChronicSkill, today domain.TodayContext, date time.Time) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Date: %s\n\n", date.Format("2006-01-02"))
	if len(weak) == 0 {
		sb.WriteString("Weakest nodes: none known. Do not invent generic work; return {\"items\":[]} unless Chronic skips or Today's note context below provide concrete signals.\n")
	} else {
		sb.WriteString("Weakest skill nodes (progress 0..100, lower = weaker):\n")
		for _, n := range weak {
			fmt.Fprintf(&sb, "  - %s (%s) progress=%d priority=%s\n", n.NodeKey, n.DisplayName, n.Progress, n.Priority)
		}
	}
	if len(chronic) > 0 {
		sb.WriteString("\nChronic skips — skills dismissed repeatedly. For EACH of these you MUST include a tiny-task OR reflection-prompt item (see system prompt Resistance handling):\n")
		for _, c := range chronic {
			fmt.Fprintf(&sb, "  - %s skipped %d times (last: %s)\n", c.SkillKey, c.SkipCount, c.LastSkip.Format("2006-01-02"))
		}
	}
	if hasPlanTodayContextSignal(today) {
		sb.WriteString("\nToday's note context — user-authored, highest priority for today's plan:\n")
		if today.Intent != "" {
			fmt.Fprintf(&sb, "  intent: %q\n", today.Intent)
		}
		if len(today.Blockers) > 0 {
			sb.WriteString("  blockers:\n")
			for _, blocker := range today.Blockers {
				fmt.Fprintf(&sb, "    - %q\n", blocker)
			}
		}
		if len(today.ActionHints) > 0 {
			sb.WriteString("  action_hints:\n")
			for _, hint := range today.ActionHints {
				fmt.Fprintf(&sb, "    - %q\n", hint)
			}
		}
		if len(today.Topics) > 0 {
			fmt.Fprintf(&sb, "  topics: %s\n", strings.Join(today.Topics, ", "))
		}
		if today.Excerpt != "" {
			fmt.Fprintf(&sb, "  excerpt: %q\n", firstN(today.Excerpt, 300))
		}
	}
	return sb.String()
}

func hasPlanTodayContextSignal(today domain.TodayContext) bool {
	return today.Intent != "" || len(today.Blockers) > 0 || len(today.Topics) > 0 || len(today.ActionHints) > 0
}

// planJSONEnvelope matches the JSON shape the system prompt locks in.
type planJSONEnvelope struct {
	Items []planJSONItem `json:"items"`
}

type planJSONItem struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Title        string `json:"title"`
	Subtitle     string `json:"subtitle"`
	Rationale    string `json:"rationale"`
	SkillKey     string `json:"skill_key"`
	TargetRef    string `json:"target_ref"`
	DeepLink     string `json:"deep_link"`
	EstimatedMin int    `json:"estimated_min"`
}

func parsePlanJSON(raw string) ([]domain.PlanItem, error) {
	// Some models emit code fences despite instruction; strip defensively.
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)

	var env planJSONEnvelope
	if err := json.Unmarshal([]byte(s), &env); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	if len(env.Items) == 0 {
		return nil, errors.New("empty items array")
	}
	out := make([]domain.PlanItem, 0, len(env.Items))
	seen := make(map[string]struct{}, len(env.Items))
	for _, it := range env.Items {
		kind := domain.PlanItemKind(strings.ToLower(strings.TrimSpace(it.Kind)))
		if !kind.IsValid() {
			// Unknown kind from the model — default to custom rather than
			// dropping the row. The plan remains usable.
			kind = domain.PlanItemCustom
		}
		title := strings.TrimSpace(it.Title)
		if title == "" {
			continue // skip degenerate rows
		}
		if isGenericPlanTitle(title) {
			continue
		}
		key := planTitleKey(title)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		est := it.EstimatedMin
		if est <= 0 || est > 240 {
			est = 25
		}
		out = append(out, domain.PlanItem{
			ID:           it.ID,
			Kind:         kind,
			Title:        title,
			Subtitle:     it.Subtitle,
			Rationale:    strings.TrimSpace(it.Rationale),
			SkillKey:     strings.TrimSpace(it.SkillKey),
			TargetRef:    it.TargetRef,
			DeepLink:     it.DeepLink,
			EstimatedMin: est,
		})
	}
	if len(out) == 0 {
		return nil, errors.New("all items dropped as degenerate")
	}
	return out, nil
}

func isGenericPlanTitle(title string) bool {
	s := strings.ToLower(strings.TrimSpace(title))
	generic := []string{
		"solve a basic algorithmic problem",
		"solve an algorithmic problem",
		"basic algorithmic problem",
		"practice algorithms",
		"work on algorithms",
		"do system design",
		"review your notes",
		"start with the first item",
		"first item in the queue",
	}
	return slices.ContainsFunc(generic, func(phrase string) bool { return strings.Contains(s, phrase) })
}

func planTitleKey(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	s = strings.NewReplacer(
		"ё", "е",
		".", " ",
		",", " ",
		":", " ",
		";", " ",
		"!", " ",
		"?", " ",
		"—", " ",
		"-", " ",
		"\"", " ",
		"'", " ",
	).Replace(s)
	return strings.Join(strings.Fields(s), " ")
}
