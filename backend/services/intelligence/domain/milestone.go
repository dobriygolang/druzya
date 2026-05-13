//go:generate mockgen -package mocks -destination mocks/milestone_mock.go -source milestone.go

// milestone.go — F2 LLM-driven milestones (Phase B/C).
//
// 10-12 weekly checkpoints, decomposed by LLM из active PrimaryGoal. Cached
// в user_milestones table; recompute monthly (30d staleness gate) или явный
// POST /milestones/generate. Frontend hits GetMilestones hot-path; миграция
// 00094 — partition unique по (user_id, goal_id, week_index).
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// MilestoneCategory mirrors the frontend Milestone['category'] union plus the
// SQL CHECK constraint в migration 00094.
type MilestoneCategory string

const (
	MilestoneCategoryFoundation MilestoneCategory = "foundation"
	MilestoneCategoryPractice   MilestoneCategory = "practice"
	MilestoneCategoryMock       MilestoneCategory = "mock"
	MilestoneCategoryReflection MilestoneCategory = "reflection"
	MilestoneCategoryFinal      MilestoneCategory = "final"
)

// IsValid is used by parser-side guard rails for LLM JSON output.
func (c MilestoneCategory) IsValid() bool {
	switch c {
	case MilestoneCategoryFoundation, MilestoneCategoryPractice,
		MilestoneCategoryMock, MilestoneCategoryReflection, MilestoneCategoryFinal:
		return true
	}
	return false
}

// Milestone — projection over user_milestones row.
type Milestone struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	GoalID      uuid.UUID
	WeekIndex   int
	WeekStart   time.Time
	Title       string
	Detail      string
	Category    MilestoneCategory
	DoneAt      *time.Time
	GeneratedAt time.Time
	UpdatedAt   time.Time
}

// MilestoneRepo — read/write адаптер над user_milestones.
//
// LatestSet возвращает все milestones для текущего goal'а (newest generation
// первая). Replace атомарно стирает старую генерацию и пишет новую set.
// MarkDone flip'ит done_at; nil = un-done.
type MilestoneRepo interface {
	// LatestSet — все milestones последней генерации для (user, goal),
	// ordered by week_index ASC. Empty slice если ни одна не сгенерирована.
	LatestSet(ctx context.Context, userID, goalID uuid.UUID) ([]Milestone, error)
	// Replace атомарно DELETE'ит старые milestones и пишет новые.
	Replace(ctx context.Context, userID, goalID uuid.UUID, items []Milestone) ([]Milestone, error)
	// MarkDone flip'ит done_at для (id, user_id). done=false — clear NULL.
	MarkDone(ctx context.Context, userID, milestoneID uuid.UUID, done bool) (Milestone, error)
	// LatestGenerationAt — generated_at последней генерации для (user, goal).
	// Возвращает zero-time если генерации нет. Используется UC чтобы решать —
	// hit cache или regenerate.
	LatestGenerationAt(ctx context.Context, userID, goalID uuid.UUID) (time.Time, error)
}

// ── F1 Memory expansion Phase 2 (2026-05-12) ──────────────────────────────
//
// Read + soft-delete над coach_episodes. ListMemoryEntries показывает юзеру
// own AI memory в /profile transparency панели; DeleteMemoryEntry помечает
// row deleted_at-stamp'ом так что recall / daily_brief / stats его игнорят.

// MemoryEntryFilter — params для ListMemoryEntries.
type MemoryEntryFilter struct {
	UserID uuid.UUID
	Kind   EpisodeKind // optional — empty = all kinds
	Since  *time.Time  // optional — nil = unrestricted
	Limit  int         // 0 → 50, hard cap 200
	Offset int
}

// MemoryEntryPage — paginated result.
type MemoryEntryPage struct {
	Items []Episode
	Total int
}

// MemoryEntryReader — read-side over coach_episodes.deleted_at IS NULL.
//
// List возвращает paginated entries newest-first. Soft-delete помечает row
// deleted_at = now(); recall / stats фильтруют по deleted_at IS NULL.
// Edit обновляет summary + ставит edited_at; row остаётся alive.
type MemoryEntryReader interface {
	List(ctx context.Context, filter MemoryEntryFilter) (MemoryEntryPage, error)
	SoftDelete(ctx context.Context, userID, episodeID uuid.UUID) error
	// Edit обновляет summary + ставит edited_at = now(). Scope (id, user_id).
	// Возвращает обновлённый episode либо ErrNotFound если row уже удалена /
	// принадлежит другому юзеру.
	Edit(ctx context.Context, userID, episodeID uuid.UUID, content string) (Episode, error)
}

// ── R3 Per-node coverage (2026-05-12) ─────────────────────────────────────

// NodeCoverageState mirrors the frontend CoverageState union в atlasCoverage.ts.
type NodeCoverageState string

const (
	NodeCoverageCovered    NodeCoverageState = "covered"
	NodeCoveragePartial    NodeCoverageState = "partial"
	NodeCoverageStruggling NodeCoverageState = "struggling"
	NodeCoverageNotYet     NodeCoverageState = "not_yet"
)

// NodeCoverage — per-node aggregated engagement signal.
//
// MatchCount30d / MatchCount7d — count of finished/clicked events на этой
// node за окно. LastMatchAt — newest occurred_at, zero если нет matches.
type NodeCoverage struct {
	NodeKey       string
	State         NodeCoverageState
	MatchCount30d int
	MatchCount7d  int
	LastMatchAt   time.Time
}

// NodeCoverageReader — pgx adapter поверх user_resource_log. Aggregates
// per-atlas_node engagement и возвращает CoverageState mirror'ом frontend
// heuristic.
type NodeCoverageReader interface {
	CoverageForNodes(ctx context.Context, userID uuid.UUID, nodeKeys []string) ([]NodeCoverage, error)
}
