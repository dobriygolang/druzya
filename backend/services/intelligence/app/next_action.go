// Package app — Coach hero «one daily action».
//
// UC берёт snapshot user'а и зовёт TaskAssistantNextAction. Output —
// structured JSON {action_kind, target, rationale, estimated_minutes}.
// Cached 1/day per user; на dismiss кас'ится TaskAssistantRereroll вариант
// (отдельный UC).
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
// RecentFocusReflections даёт prompt'у конкретный pain («вчера 25 min на
// prefix-sum, grade 2, stuck on joins») — rationale получает named anchor.
//
// ML.IsML=true → caller-loader детектит (primary_goal=ml_offer OR
// active_track=ml); UC appends ML overlay system message чтобы свернуть
// default Go-senior framing на ML.
type NextActionInput struct {
	UserID                 uuid.UUID
	LearningState          LearningStateView
	RecentMocks            []domain.MockSessionSummary
	Fork                   domain.ForkProgressSnapshot
	ResourceTrail          domain.ResourceEngagement
	ActiveTrack            *ActiveTrackStep
	RecentFocusReflections []domain.FocusReflection
	ML                     domain.MLProfile
	// Wave 15: RecentActivity24h — counts of last 24h actions. Coach
	// uses these to either avoid duplicating recent action ("you did
	// 3 focus sessions already") or build on momentum.
	RecentActivity24h domain.RecentActivitySummary
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
	// ML overlay: append as second system message when in.ML.IsML=true.
	// Hot-path mirror of coach_prompts.slug='weak_axis_ml_drill'; constant
	// is fallback when DB lookup would add latency (next-action serves on
	// /today first-load).
	messages := []llmchain.Message{
		{Role: llmchain.RoleSystem, Content: nextActionSystemPrompt},
	}
	if in.ML.IsML {
		messages = append(messages, llmchain.Message{
			Role:    llmchain.RoleSystem,
			Content: nextActionMLOverlay,
		})
	}
	messages = append(messages, llmchain.Message{Role: llmchain.RoleUser, Content: prompt})

	req := llmchain.Request{
		Task:        llmchain.TaskAssistantNextAction,
		JSONMode:    true,
		Temperature: 0.5,
		MaxTokens:   400,
		Messages:    messages,
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

// nextActionMLOverlay — hot-path mirror of coach_prompts.slug=
// 'weak_axis_ml_drill'. Appended when NextActionInput.ML.IsML=true to
// reframe default action recommendations through ML lens; JSON envelope
// identical between default + ML so downstream parser остаётся одним.
const nextActionMLOverlay = `ML-COACH OVERLAY (user committed to ML offer track):
- Reframe action targets to ML (numpy/pytorch coding drill > algo kata; recsys/ranking sysdesign > generic distributed-systems).
- Rationale must cite ML-specific signal (last ml_coding mock weak topic, ML radar axis with progress<30, named ML resource user has been engaging with).
- For action_kind=review_resource — prefer Lilian Weng / Karpathy / Chip Huyen / HF course / Papers with Code over generic CS textbooks.
- For action_kind=start_mock — ML stage_kinds (ml_coding / ml_system_design / ml_theory), не algorithms/coding/sysdesign.`

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

	// Recent focus reflections — grade + notes from a finished pomodoro.
	// Coach uses these so rationale цитирует конкретный pain
	// («previously stuck on X with grade 2 — try Y today»).
	if len(in.RecentFocusReflections) > 0 {
		b.WriteString("\nRECENT FOCUS REFLECTIONS (newest first):\n")
		// Cap at 5 entries — prompt budget conservation.
		capN := min(5, len(in.RecentFocusReflections))
		for i := range capN {
			r := in.RecentFocusReflections[i]
			grade := "no grade"
			if r.Grade != nil {
				grade = fmt.Sprintf("grade %d/5", *r.Grade)
			}
			task := r.TaskPinned
			if task == "" {
				task = r.FocusMode
			}
			note := r.Notes
			if len(note) > 160 {
				note = note[:160] + "…"
			}
			if note == "" {
				note = "(no note)"
			}
			fmt.Fprintf(&b, "  - %s · %d min · %s · on %q · %q\n",
				r.EndedAt.Format("2006-01-02"), r.DurationSeconds/60, grade, task, note)
		}
	}

	// Wave 15: RecentActivity24h — surface continuity context.
	if hasRecentActivityNA(in.RecentActivity24h) {
		ra := in.RecentActivity24h
		b.WriteString("\nRECENT ACTIVITY (last 24h — DO NOT recommend a duplicate of what user just did):\n")
		if ra.FocusSessionsCount > 0 {
			fmt.Fprintf(&b, "  - %d focus session(s), %d min\n", ra.FocusSessionsCount, ra.FocusMinutesTotal)
		}
		if ra.TasksDone > 0 {
			fmt.Fprintf(&b, "  - %d task(s) marked done\n", ra.TasksDone)
		}
		if ra.MockAttempts > 0 {
			fmt.Fprintf(&b, "  - %d mock(s); last %d/100\n", ra.MockAttempts, ra.LastMockResult)
		}
		if ra.ReadingMinutes > 0 {
			fmt.Fprintf(&b, "  - %d min Lingua reading\n", ra.ReadingMinutes)
		}
		if ra.SpeakingAttempts > 0 {
			fmt.Fprintf(&b, "  - %d speaking attempt(s); avg %.0f/100\n", ra.SpeakingAttempts, ra.SpeakingAvgScore)
		}
		if ra.VocabReviewed > 0 {
			fmt.Fprintf(&b, "  - %d vocab card(s) reviewed\n", ra.VocabReviewed)
		}
	}

	b.WriteString("\nReturn the single most-important next action.")
	return b.String()
}

// hasRecentActivityNA — local mirror of infra/hasRecentActivity to keep
// the UC free of infra imports. Returns true when any 24h counter > 0.
func hasRecentActivityNA(r domain.RecentActivitySummary) bool {
	return r.FocusSessionsCount > 0 ||
		r.TasksDone > 0 ||
		r.MockAttempts > 0 ||
		r.NotesCreated > 0 ||
		r.ReadingMinutes > 0 ||
		r.SpeakingAttempts > 0 ||
		r.VocabReviewed > 0
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
