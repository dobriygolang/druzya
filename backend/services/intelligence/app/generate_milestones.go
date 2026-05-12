// generate_milestones.go — F2 LLM-driven milestone generation.
//
// Frontend (frontend/src/lib/milestones.ts) shipped 4 static templates × 12
// weeks. Phase B/C goal: LLM cascade синтезирует per-user план из active
// PrimaryGoal. Aggressive cache (30d staleness) — milestones это roadmap,
// не daily action; regeneration редкая, через явный POST /milestones/generate
// или GetMilestones когда staleness > 30d.
//
// Cascade order — TaskAssistantForkAnalysis (70B на cloud, Ollama fallback);
// прямо для milestones отдельной task'и нет, но сильное reasoning требуется
// (взвесить goal + days_remaining + category-distribution). Используем
// TaskAssistantForkAnalysis: тот же 70B-class.
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

// MilestoneCacheTTL — staleness gate. После 30d юзер видит regenerate-prompt.
const MilestoneCacheTTL = 30 * 24 * time.Hour

// GenerateMilestones UC.
//
// Если cache свежий (< MilestoneCacheTTL) — возвращает cached set. Иначе
// дёргает LLM cascade, парсит JSON массив, валидирует, replace'ит cache
// row.
type GenerateMilestones struct {
	Repo       domain.MilestoneRepo
	Goals      domain.PrimaryGoalRepo
	Chain      llmchain.ChatClient
	Log        *slog.Logger
	Now        func() time.Time
	Timeout    time.Duration
	// ForceFresh — пропустить cache, всегда дёргать LLM. Caller — explicit
	// POST /milestones/generate.
	ForceFresh bool
}

// GenerateMilestonesInput.
type GenerateMilestonesInput struct {
	UserID uuid.UUID
	// Force — bypass 30d cache gate, regen even if recent.
	Force bool
}

// Do возвращает actionable milestone set. Cache-first; LLM only когда нужно.
func (uc *GenerateMilestones) Do(ctx context.Context, in GenerateMilestonesInput) ([]domain.Milestone, error) {
	if in.UserID == uuid.Nil {
		return nil, fmt.Errorf("intelligence.GenerateMilestones: %w: zero user_id", domain.ErrInvalidInput)
	}
	goal, err := uc.Goals.GetActive(ctx, in.UserID)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GenerateMilestones load goal: %w", err)
	}

	if !in.Force && !uc.ForceFresh {
		genAt, err := uc.Repo.LatestGenerationAt(ctx, in.UserID, goal.ID)
		if err != nil {
			return nil, fmt.Errorf("intelligence.GenerateMilestones gen check: %w", err)
		}
		if !genAt.IsZero() && uc.now().Sub(genAt) < MilestoneCacheTTL {
			return uc.Repo.LatestSet(ctx, in.UserID, goal.ID)
		}
	}

	if uc.Chain == nil {
		return nil, fmt.Errorf("intelligence.GenerateMilestones: %w", domain.ErrLLMUnavailable)
	}

	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 45 * time.Second
	}
	llmCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	prompt := buildMilestonePrompt(goal, uc.now())
	req := llmchain.Request{
		Task:        llmchain.TaskAssistantForkAnalysis,
		JSONMode:    true,
		Temperature: 0.4,
		MaxTokens:   1800,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: milestoneSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	}
	resp, err := uc.Chain.Chat(llmCtx, req)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GenerateMilestones chat: %w (%w)", err, domain.ErrLLMUnavailable)
	}

	parsed, err := parseMilestoneJSON(resp.Content)
	if err != nil {
		if uc.Log != nil {
			uc.Log.Warn("intelligence.GenerateMilestones parse fail",
				slog.Any("err", err),
				slog.String("preview", firstNContent(resp.Content, 240)),
				slog.String("user_id", in.UserID.String()))
		}
		return nil, fmt.Errorf("intelligence.GenerateMilestones parse: %w (%w)", err, domain.ErrLLMUnavailable)
	}

	now := uc.now()
	weekStart := startOfIsoWeek(now)
	items := make([]domain.Milestone, 0, len(parsed))
	for i, p := range parsed {
		ws := weekStart.AddDate(0, 0, i*7)
		items = append(items, domain.Milestone{
			UserID:      in.UserID,
			GoalID:      goal.ID,
			WeekIndex:   i + 1,
			WeekStart:   ws,
			Title:       p.Title,
			Detail:      p.Detail,
			Category:    domain.MilestoneCategory(p.Category),
			GeneratedAt: now,
			UpdatedAt:   now,
		})
	}

	saved, err := uc.Repo.Replace(ctx, in.UserID, goal.ID, items)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GenerateMilestones replace: %w", err)
	}
	return saved, nil
}

func (uc *GenerateMilestones) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

// ── GetMilestones — cached-only read ──────────────────────────────────────

// GetMilestones UC — returns latest cached set без LLM hit.
//
// Если cache empty или stale > MilestoneCacheTTL — caller сам решает
// pushinguть regenerate (frontend showuет "regenerate" CTA). Не делаем
// auto-generate здесь — это GET path, должен быть быстрый.
type GetMilestones struct {
	Repo  domain.MilestoneRepo
	Goals domain.PrimaryGoalRepo
}

// Do returns cached milestones. Empty slice если ничего не сгенерировано.
func (uc *GetMilestones) Do(ctx context.Context, userID uuid.UUID) ([]domain.Milestone, error) {
	if userID == uuid.Nil {
		return nil, fmt.Errorf("intelligence.GetMilestones: %w: zero user_id", domain.ErrInvalidInput)
	}
	goal, err := uc.Goals.GetActive(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetMilestones load goal: %w", err)
	}
	return uc.Repo.LatestSet(ctx, userID, goal.ID)
}

// ── MarkMilestoneDone ─────────────────────────────────────────────────────

// MarkMilestoneDone UC — flip done_at. done=false — clear.
type MarkMilestoneDone struct {
	Repo domain.MilestoneRepo
}

// MarkMilestoneDoneInput.
type MarkMilestoneDoneInput struct {
	UserID      uuid.UUID
	MilestoneID uuid.UUID
	Done        bool
}

// Do flips done_at.
func (uc *MarkMilestoneDone) Do(ctx context.Context, in MarkMilestoneDoneInput) (domain.Milestone, error) {
	if in.UserID == uuid.Nil {
		return domain.Milestone{}, fmt.Errorf("intelligence.MarkMilestoneDone: %w: zero user_id", domain.ErrInvalidInput)
	}
	if in.MilestoneID == uuid.Nil {
		return domain.Milestone{}, fmt.Errorf("intelligence.MarkMilestoneDone: %w: zero milestone_id", domain.ErrInvalidInput)
	}
	return uc.Repo.MarkDone(ctx, in.UserID, in.MilestoneID, in.Done)
}

// ── Prompt + parser ───────────────────────────────────────────────────────

const milestoneSystemPrompt = `You decompose a user's PRIMARY learning goal into 10-12 weekly milestones.

Constraints:
- Output STRICT JSON, no markdown, no commentary:
  {"milestones":[{"title":"...","detail":"...","category":"..."},...]}
- Exactly 10-12 entries in the array.
- title ≤ 60 chars, noun-phrase ("Concurrency deep-dive", not "Do concurrency").
- detail 1-2 sentences, concrete ("Read DDIA Ch 5-7; do 2 system design mocks").
- category MUST be one of: foundation | practice | mock | reflection | final.
- First 2-3 entries: 'foundation' (refresh basics). Middle: mostly 'practice'
  with 1-2 'mock' checkpoints. Last entry: 'final' (interview readiness / final push).
- No filler ("be consistent", "stay motivated"). Each milestone = concrete weekly outcome.`

// milestoneRaw — JSON shape ожидаемый от LLM.
type milestoneRaw struct {
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	Category string `json:"category"`
}

// milestoneEnvelope — top-level shape. Объект с массивом стабильнее чем top-level
// массив (некоторые провайдеры в JSONMode требуют object root).
type milestoneEnvelope struct {
	Milestones []milestoneRaw `json:"milestones"`
}

func parseMilestoneJSON(raw string) ([]milestoneRaw, error) {
	cleaned := stripFences(raw)
	// Try envelope first.
	var env milestoneEnvelope
	if err := json.Unmarshal([]byte(cleaned), &env); err == nil && len(env.Milestones) > 0 {
		return validateMilestones(env.Milestones)
	}
	// Fallback: bare array (некоторые провайдеры в JSONMode плохо обрабатывают
	// nested object envelope).
	var bare []milestoneRaw
	if err := json.Unmarshal([]byte(cleaned), &bare); err == nil && len(bare) > 0 {
		return validateMilestones(bare)
	}
	return nil, fmt.Errorf("invalid milestone JSON: cannot unmarshal envelope or bare array")
}

func validateMilestones(in []milestoneRaw) ([]milestoneRaw, error) {
	if len(in) < 4 {
		return nil, fmt.Errorf("expected ≥4 milestones, got %d", len(in))
	}
	if len(in) > 16 {
		in = in[:16] // hard cap — LLM иногда переусердствует
	}
	out := make([]milestoneRaw, 0, len(in))
	for i, m := range in {
		title := strings.TrimSpace(m.Title)
		if title == "" {
			return nil, fmt.Errorf("milestone[%d]: empty title", i)
		}
		if len(title) > 120 {
			title = title[:120]
		}
		cat := strings.TrimSpace(strings.ToLower(m.Category))
		if !domain.MilestoneCategory(cat).IsValid() {
			cat = string(domain.MilestoneCategoryPractice) // graceful fallback
		}
		out = append(out, milestoneRaw{
			Title:    title,
			Detail:   strings.TrimSpace(m.Detail),
			Category: cat,
		})
	}
	return out, nil
}

func buildMilestonePrompt(goal domain.PrimaryGoal, now time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "PRIMARY GOAL:\n  kind=%s\n", goal.Kind)
	if goal.TargetCompany != "" {
		fmt.Fprintf(&b, "  target_company=%s\n", goal.TargetCompany)
	}
	if goal.TargetLevel != "" {
		fmt.Fprintf(&b, "  target_level=%s\n", goal.TargetLevel)
	}
	if goal.TargetText != "" {
		fmt.Fprintf(&b, "  target_text=%s\n", goal.TargetText)
	}
	if goal.TargetDate != nil {
		daysToTarget := int(goal.TargetDate.Sub(now).Hours() / 24)
		fmt.Fprintf(&b, "  target_date=%s (%d days from now)\n",
			goal.TargetDate.Format("2006-01-02"), daysToTarget)
	} else {
		b.WriteString("  target_date=none (open-ended)\n")
	}
	b.WriteString("\nGenerate 10-12 weekly milestones decomposing this goal. " +
		"Match the kind: senior-IT goals → algorithms/system-design/mocks; " +
		"ML offer → math/PyTorch/MLOps; english_target → speaking/writing/test prep; " +
		"custom → split user's text into sub-goals.")
	return b.String()
}

// startOfIsoWeek returns Monday of week containing t (UTC).
func startOfIsoWeek(t time.Time) time.Time {
	t = t.UTC()
	weekday := int(t.Weekday())
	if weekday == 0 {
		weekday = 7 // Sunday → 7 для ISO
	}
	offset := weekday - 1
	monday := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, -offset)
	return monday
}
