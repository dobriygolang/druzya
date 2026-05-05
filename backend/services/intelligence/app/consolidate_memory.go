// Phase 4.5 — weekly memory consolidation.
//
// Раз в неделю (cron / admin trigger) запускается ConsolidateWeeklyMemory.
// Use case собирает counts всех episode kinds за окно [weekStart,
// weekStart+7d), форматирует короткий summary template'ом и пишет один
// EpisodeWeeklyMemorySummary с payload {"week_start": RFC3339}. Coach
// затем читает summary вместо сырых эпизодов когда они вышли из
// 7-day fresh window.
//
// Намеренно НЕ-LLM в первой итерации: deterministic template дешевле,
// быстрее и легче тестируется. LLM-narrative — следующий polish.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// ConsolidateWeeklyMemory rolls one user-week into a single episode.
// Caller decides scheduling: cron tick, admin trigger, lazy-on-recall.
type ConsolidateWeeklyMemory struct {
	Episodes domain.EpisodeRepo
	Memory   *Memory // используется для записи через Append (тот же путь что hot-path)
	Log      *slog.Logger
	Now      func() time.Time
}

// ConsolidateInput.
type ConsolidateInput struct {
	UserID    uuid.UUID
	WeekStart time.Time // UTC, начало недели (понедельник 00:00 рекомендован)
}

// Outcome describes the result. Empty result means nothing happened
// either because the week was already consolidated or had zero episodes.
type ConsolidateOutcome struct {
	Skipped       bool   // already consolidated for this week
	EpisodesCount int    // total raw episodes counted in window
	Summary       string // human-readable rollup, also stored as Episode.Summary
}

// Do executes the consolidation. Idempotent: повторный вызов за ту же
// неделю возвращает Skipped=true без записи нового episode'а.
func (uc *ConsolidateWeeklyMemory) Do(ctx context.Context, in ConsolidateInput) (ConsolidateOutcome, error) {
	if uc.Episodes == nil || uc.Memory == nil {
		return ConsolidateOutcome{}, fmt.Errorf("intelligence.ConsolidateWeeklyMemory: deps not wired")
	}
	if in.UserID == uuid.Nil {
		return ConsolidateOutcome{}, fmt.Errorf("intelligence.ConsolidateWeeklyMemory: zero user_id")
	}
	weekStart := in.WeekStart.UTC().Truncate(24 * time.Hour)
	if weekStart.IsZero() {
		return ConsolidateOutcome{}, fmt.Errorf("intelligence.ConsolidateWeeklyMemory: zero week_start")
	}
	weekEnd := weekStart.Add(7 * 24 * time.Hour)

	already, err := uc.Episodes.HasWeeklySummary(ctx, in.UserID, weekStart)
	if err != nil {
		return ConsolidateOutcome{}, fmt.Errorf("intelligence.ConsolidateWeeklyMemory: probe: %w", err)
	}
	if already {
		return ConsolidateOutcome{Skipped: true}, nil
	}

	counts, err := uc.Episodes.CountByKindInRange(ctx, in.UserID, weekStart, weekEnd)
	if err != nil {
		return ConsolidateOutcome{}, fmt.Errorf("intelligence.ConsolidateWeeklyMemory: count: %w", err)
	}
	total := 0
	for _, n := range counts {
		total += n
	}
	if total == 0 {
		// Empty week — нечего consolidating. Не пишем episode (иначе
		// расход места без пользы); следующий запуск опять увидит no-op.
		return ConsolidateOutcome{Skipped: true, EpisodesCount: 0}, nil
	}

	summary := formatWeeklySummary(weekStart, counts)
	payload := map[string]any{
		"week_start":     weekStart.Format(time.RFC3339),
		"week_end":       weekEnd.Format(time.RFC3339),
		"episodes_count": total,
		"by_kind":        counts,
	}
	if err := uc.Memory.Append(ctx, AppendInput{
		UserID:     in.UserID,
		Kind:       domain.EpisodeWeeklyMemorySummary,
		Summary:    summary,
		Payload:    payload,
		OccurredAt: weekEnd, // ставим в конец недели — чтобы recency-tail видел его свежим
	}); err != nil {
		return ConsolidateOutcome{}, fmt.Errorf("intelligence.ConsolidateWeeklyMemory: append: %w", err)
	}
	if uc.Log != nil {
		uc.Log.Info("intelligence: weekly memory consolidated",
			slog.String("user_id", in.UserID.String()),
			slog.String("week_start", weekStart.Format("2006-01-02")),
			slog.Int("episodes", total))
	}
	return ConsolidateOutcome{
		EpisodesCount: total,
		Summary:       summary,
	}, nil
}

// formatWeeklySummary — deterministic rollup. Не зависит от LLM. Output
// shape (одна строка многострочного):
//
//	Week of YYYY-MM-DD: brief_emitted=5, brief_followed=2, ...
//
// Sorted by count desc для читаемости (важные сигналы первыми).
func formatWeeklySummary(weekStart time.Time, counts map[domain.EpisodeKind]int) string {
	type kc struct {
		Kind  domain.EpisodeKind
		Count int
	}
	rows := make([]kc, 0, len(counts))
	for k, n := range counts {
		if n <= 0 {
			continue
		}
		rows = append(rows, kc{Kind: k, Count: n})
	}
	slices.SortFunc(rows, func(a, b kc) int {
		if a.Count != b.Count {
			return b.Count - a.Count
		}
		return strings.Compare(string(a.Kind), string(b.Kind))
	})
	var sb strings.Builder
	fmt.Fprintf(&sb, "Week of %s: ", weekStart.Format("2006-01-02"))
	parts := make([]string, 0, len(rows))
	for _, r := range rows {
		parts = append(parts, fmt.Sprintf("%s=%d", r.Kind, r.Count))
	}
	sb.WriteString(strings.Join(parts, ", "))
	sb.WriteString(".")
	return sb.String()
}
