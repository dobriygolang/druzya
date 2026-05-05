// next_action.go — Phase 2 Coach hero «one daily action».
//
// UC берёт snapshot user'а (learning_state, recent mocks, resource trail,
// active track step) и зовёт TaskAssistantNextAction (70B). Output —
// structured JSON {action_kind, target, rationale, estimated_minutes}.
//
// Cached 1/day per user (cache key = user_id + UTC date). При dismiss
// каскад'ится TaskAssistantRereroll для variation, но это отдельный UC.
//
// Provider chain через llmchain — fallback'и групповым уровнем (Groq →
// Cerebras → Mistral → OpenRouter free → Ollama).
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// NextAction — структура output'а LLM.
type NextAction struct {
	ActionKind       string `json:"action_kind"`
	Target           string `json:"target"`
	Rationale        string `json:"rationale"`
	EstimatedMinutes int    `json:"estimated_minutes"`
}

// NextActionInput — снапшот для prompt'а. Caller (handler) собирает из
// readers и passes сюда — UC не дёргает readers сам, чтобы оставаться
// тестируемым.
//
// Calendar pivot 2026-05-04: UpcomingEvents removed alongside personal_events.
// Coach next-action no longer factors interview-window pressure; track step
// + fork mode + recent mocks remain the active inputs.
type NextActionInput struct {
	UserID          uuid.UUID
	LearningState   LearningStateView
	RecentMocks     []domain.MockSessionSummary
	Fork            domain.ForkProgressSnapshot
	ResourceTrail   domain.ResourceEngagement
	ActiveTrack     *ActiveTrackStep
}

// LearningStateView — slim projection (UC не импортирует learning_state
// модуль, чтобы не создавать круговую зависимость).
type LearningStateView struct {
	Mode             string
	ForkBranch       string
	ExploreWeekIndex int
	CommittedTrackID string
}

// ActiveTrackStep — текущий step юзера (если committed).
type ActiveTrackStep struct {
	TrackSlug      string
	StepIndex      int
	StepTitle      string
	SkillKeys      []string
	CheckpointKeys []string
}

// GetNextAction — UC.
type GetNextAction struct {
	Chain   llmchain.ChatClient
	Log     *slog.Logger
	Now     func() time.Time
	Timeout time.Duration
}

// Do вызывает LLM и парсит response. Не кэширует — кэш — это уже DB-слой
// caller'а. UC чисто-функциональный: input → output.
func (uc *GetNextAction) Do(ctx context.Context, in NextActionInput) (NextAction, error) {
	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 20 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	prompt := buildNextActionPrompt(in)
	req := llmchain.Request{
		Task:        llmchain.TaskAssistantNextAction,
		JSONMode:    true,
		Temperature: 0.5,
		MaxTokens:   400,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: nextActionSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	}
	resp, err := uc.Chain.Chat(ctx, req)
	if err != nil {
		return NextAction{}, fmt.Errorf("intelligence.GetNextAction chat: %w", err)
	}
	out, err := parseNextAction(resp.Content)
	if err != nil {
		if uc.Log != nil {
			uc.Log.Warn("intelligence.GetNextAction parse fail",
				slog.Any("err", err),
				slog.String("preview", firstNContent(resp.Content, 200)),
				slog.String("user_id", in.UserID.String()))
		}
		return NextAction{}, fmt.Errorf("intelligence.GetNextAction parse: %w", err)
	}
	return out, nil
}

const nextActionSystemPrompt = `You are the AI-coach producing ONE concrete next action for today.

Constraints:
- Output STRICT JSON, no markdown, no commentary:
  {"action_kind":"focus_block|start_mock|review_resource|reflection|checkpoint|graduation_mock","target":"<atlas_node_id|track_step_slug|resource_url>","rationale":"<1-2 sentences citing specific signal>","estimated_minutes":<int>}
- Rationale MUST cite a SPECIFIC signal: weak axis from last mock, concrete track step, named resource, named atlas node. Generic ("practice algorithms", "be consistent") = FAIL.
- If learning_state.mode=='explore' — DO NOT push commit; suggest exploration of underdeveloped fork-branch.
- estimated_minutes ∈ [15, 120].`

func buildNextActionPrompt(in NextActionInput) string {
	var b strings.Builder
	fmt.Fprintf(&b, "USER STATE:\n  mode=%s · fork_branch=%s · explore_week=%d\n",
		in.LearningState.Mode, in.LearningState.ForkBranch, in.LearningState.ExploreWeekIndex)
	if in.LearningState.CommittedTrackID != "" {
		fmt.Fprintf(&b, "  committed_track=%s\n", in.LearningState.CommittedTrackID)
	}

	if in.ActiveTrack != nil {
		fmt.Fprintf(&b, "\nACTIVE STEP:\n  track=%s · step %d · %q · skills=[%s] · checkpoint=[%s]\n",
			in.ActiveTrack.TrackSlug, in.ActiveTrack.StepIndex, in.ActiveTrack.StepTitle,
			strings.Join(in.ActiveTrack.SkillKeys, ","),
			strings.Join(in.ActiveTrack.CheckpointKeys, ","))
	}

	if len(in.RecentMocks) > 0 {
		b.WriteString("\nRECENT MOCKS (newest first):\n")
		for _, m := range in.RecentMocks {
			fmt.Fprintf(&b, "  - section=%s · score?=available · weak=%v · finished=%s\n",
				m.Section, m.WeakTopics, m.FinishedAt.Format("2006-01-02"))
		}
	}

	if in.Fork.Mode == "explore" && len(in.Fork.ScoresByBranch) > 0 {
		b.WriteString("\nFORK STATUS:\n")
		for _, s := range in.Fork.ScoresByBranch {
			fmt.Fprintf(&b, "  - %s: %d mocks (avg %.0f), %d voluntary deep-dives\n",
				s.Branch, s.MockCount, s.AvgScore, s.VoluntaryDeepDives)
		}
	}

	if in.ResourceTrail.UnfinishedCount > 0 || len(in.ResourceTrail.MarkedUnhelpful) > 0 {
		fmt.Fprintf(&b, "\nRESOURCE TRAIL: %d unfinished · %d unhelpful\n",
			in.ResourceTrail.UnfinishedCount, len(in.ResourceTrail.MarkedUnhelpful))
	}

	b.WriteString("\nReturn the single most-important next action.")
	return b.String()
}

func parseNextAction(raw string) (NextAction, error) {
	cleaned := stripFences(raw)
	var out NextAction
	if err := json.Unmarshal([]byte(cleaned), &out); err != nil {
		return NextAction{}, fmt.Errorf("unmarshal: %w", err)
	}
	if !validActionKind(out.ActionKind) {
		return NextAction{}, fmt.Errorf("invalid action_kind: %q", out.ActionKind)
	}
	if strings.TrimSpace(out.Rationale) == "" {
		return NextAction{}, fmt.Errorf("empty rationale")
	}
	if out.EstimatedMinutes < 0 {
		return NextAction{}, fmt.Errorf("negative estimated_minutes")
	}
	return out, nil
}

func validActionKind(k string) bool {
	switch k {
	case "focus_block", "start_mock", "review_resource", "reflection",
		"checkpoint", "graduation_mock":
		return true
	}
	return false
}

func stripFences(raw string) string {
	s := strings.TrimSpace(raw)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(s, "```"))
}

func firstNContent(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
