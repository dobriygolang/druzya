// coach_generator.go — periodic AI task suggestions for the TaskBoard.
//
// Runs in a cron loop (every 6h by default) over recently-active users.
// For each user we pull the top-3 weak skill nodes from atlas, then call
// SpawnAITask which honours the dedup-by-skill_key + cap=7 invariants.
//
// No LLM is invoked here on purpose: titles/briefs come straight from
// atlas_nodes.{title, description}, and deep_link is a deterministic
// druz9://… URL. A future iteration can swap Title/Brief for an LLM-
// generated personalised pitch, but the current shape gives users a
// useful default without spending tokens.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ActiveUsersReader returns the user-ids that have been active recently.
// "Active" is fuzzy by design — implementations typically union signals
// from tg_user_link.last_seen_at, hone_focus_sessions, and arena
// participation. Keeping the cross-domain join in the adapter (monolith
// services/hone) avoids importing other services from this domain.
type ActiveUsersReader interface {
	ListActive(ctx context.Context, since time.Time, limit int) ([]uuid.UUID, error)
}

// CoachGenerator is the worker. Spawn through Background(ctx) at boot.
type CoachGenerator struct {
	Tasks       domain.TaskRepo
	Skills      domain.SkillAtlasReader
	ActiveUsers ActiveUsersReader
	Spawner     *SpawnAITask
	Log         *slog.Logger
	Now         func() time.Time

	// Tunables (zeros use sensible defaults).
	Interval    time.Duration // 0 → 6h
	ActiveSince time.Duration // 0 → 7d
	UsersPerRun int           // 0 → 50
	WeakPerUser int           // 0 → 3
}

// Run blocks until ctx.Done, sweeping at Interval. Same shape as
// streak_reconciler.Run / memory_retention.Run.
func (g *CoachGenerator) Run(ctx context.Context) {
	if g.Spawner == nil {
		if g.Log != nil {
			g.Log.Warn("hone.coach.generator: Spawner not wired, generator disabled")
		}
		return
	}
	interval := g.Interval
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	// Defer the first sweep so we don't fight migrations / health on boot.
	select {
	case <-ctx.Done():
		return
	case <-time.After(2 * time.Minute):
	}
	tick := time.NewTicker(interval)
	defer tick.Stop()

	for {
		g.sweep(ctx)
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

func (g *CoachGenerator) sweep(ctx context.Context) {
	now := time.Now
	if g.Now != nil {
		now = g.Now
	}
	activeSince := g.ActiveSince
	if activeSince <= 0 {
		activeSince = 7 * 24 * time.Hour
	}
	usersLimit := g.UsersPerRun
	if usersLimit <= 0 {
		usersLimit = 50
	}
	weakLimit := g.WeakPerUser
	if weakLimit <= 0 {
		weakLimit = 3
	}

	users, err := g.ActiveUsers.ListActive(ctx, now().UTC().Add(-activeSince), usersLimit)
	if err != nil {
		if g.Log != nil {
			g.Log.WarnContext(ctx, "hone.coach.generator: ListActive failed", slog.Any("err", err))
		}
		return
	}
	for _, uid := range users {
		if err := ctx.Err(); err != nil {
			return
		}
		g.generateForUser(ctx, uid, weakLimit)
	}
}

func (g *CoachGenerator) generateForUser(ctx context.Context, userID uuid.UUID, weakLimit int) {
	weak, err := g.Skills.WeakestNodes(ctx, userID, weakLimit)
	if err != nil {
		if g.Log != nil {
			g.Log.WarnContext(ctx, "hone.coach.generator: WeakestNodes failed",
				slog.Any("err", err), slog.String("user_id", userID.String()))
		}
		return
	}
	for _, w := range weak {
		spawned, err := g.Spawner.Do(ctx, SpawnAITaskInput{
			UserID:   userID,
			Kind:     kindForSkill(w.NodeKey),
			Title:    coachTitleForSkill(w),
			BriefMD:  coachBriefForSkill(w),
			SkillKey: w.NodeKey,
			DeepLink: deepLinkForSkill(w.NodeKey),
			Priority: priorityForWeak(w),
		})
		if err != nil {
			if g.Log != nil {
				g.Log.WarnContext(ctx, "hone.coach.generator: SpawnAITask failed",
					slog.Any("err", err), slog.String("skill", w.NodeKey))
			}
			continue
		}
		if g.Log != nil {
			g.Log.InfoContext(ctx, "hone.coach.generator: spawn",
				slog.String("user_id", userID.String()),
				slog.String("skill", w.NodeKey),
				slog.String("reason", spawned.Reason),
				slog.Bool("created", spawned.Created))
		}
	}
}

// ── content helpers ──────────────────────────────────────────────────────

// kindForSkill maps an atlas skill_key to the right TaskBoard column
// kind. Non-mapped skills default to algo (the safest bucket — solving
// at arena is the universal fallback).
func kindForSkill(nodeKey string) domain.TaskKind {
	switch nodeKey {
	case "sd_basics", "sd_scale":
		return domain.TaskKindSysDesign
	case "beh_star":
		return domain.TaskKindReflection
	}
	return domain.TaskKindAlgo
}

// coachTitleForSkill returns a short imperative title built from the
// atlas display name. We keep it deterministic (no LLM) so the worker
// is cheap and predictable.
func coachTitleForSkill(w domain.WeakNode) string {
	if w.DisplayName != "" {
		return "Подтянуть: " + w.DisplayName
	}
	return "Подтянуть навык"
}

// coachBriefForSkill — one-line "why this card now".
func coachBriefForSkill(w domain.WeakNode) string {
	if w.Progress == 0 {
		return "Этот навык ещё не открыт. Начни с базовой задачи."
	}
	return fmt.Sprintf("Текущий прогресс: %d%%. Возьми задачу из arena по этой теме.", w.Progress)
}

// deepLinkForSkill builds a druz9://… URL the frontend resolves to the
// right starting point in the main project.
func deepLinkForSkill(nodeKey string) string {
	switch nodeKey {
	case "sd_basics", "sd_scale":
		return "druz9://mock/start?section=system_design"
	case "go_idioms", "go_concurrency":
		return "druz9://arena/queue?section=go"
	case "sql_basics", "sql_perf":
		return "druz9://arena/queue?section=sql"
	case "beh_star":
		return "druz9://mock/start?section=behavioral"
	default:
		return "druz9://arena/queue?section=algorithms"
	}
}

// priorityForWeak maps the weak-node priority bucket to a sortable
// int16. Higher number = top of the column.
func priorityForWeak(w domain.WeakNode) int16 {
	switch w.Priority {
	case "high":
		return 30
	case "medium":
		return 20
	case "low":
		return 10
	}
	return 15
}

// ── TTL cleanup worker ───────────────────────────────────────────────────

// TaskCleanupWorker is the cron wrapper around AutoDismissExpired —
// once a day it sweeps `todo` cards older than the TTL window.
type TaskCleanupWorker struct {
	Sweep    *AutoDismissExpired
	Interval time.Duration // 0 → 24h
	Log      *slog.Logger
}

// Run blocks until ctx.Done.
func (w *TaskCleanupWorker) Run(ctx context.Context) {
	if w.Sweep == nil {
		return
	}
	interval := w.Interval
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	// Defer first sweep so it doesn't race migrations.
	select {
	case <-ctx.Done():
		return
	case <-time.After(5 * time.Minute):
	}
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for {
		if _, err := w.Sweep.Do(ctx); err != nil {
			if w.Log != nil && !errors.Is(err, context.Canceled) {
				w.Log.WarnContext(ctx, "hone.tasks.cleanup: sweep failed", slog.Any("err", err))
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
