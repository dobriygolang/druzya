// Memory layer types — coach episodes (single store for all coach
// memory). Phase B: brief generations + user reactions + side-effect
// events from hone (reflections / standups / plan-skip-or-complete /
// notes / focus-sessions).
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// EpisodeKind enumerates everything coach can remember. String-typed
// (writes match BD CHECK CONSTRAINT exactly).
type EpisodeKind string

const (
	EpisodeBriefEmitted     EpisodeKind = "brief_emitted"
	EpisodeBriefFollowed    EpisodeKind = "brief_followed"
	EpisodeBriefDismissed   EpisodeKind = "brief_dismissed"
	EpisodeQAQuery          EpisodeKind = "qa_query"
	EpisodeQAAnswered       EpisodeKind = "qa_answered"
	EpisodeReflectionAdded  EpisodeKind = "reflection_added"
	EpisodeStandupRecorded  EpisodeKind = "standup_recorded"
	EpisodePlanSkipped      EpisodeKind = "plan_skipped"
	EpisodePlanCompleted    EpisodeKind = "plan_completed"
	EpisodeNoteCreated      EpisodeKind = "note_created"
	EpisodeFocusSessionDone EpisodeKind = "focus_session_done"
	// EpisodeMockPipelineFinished is written by the mock_interview
	// orchestrator on every FinishPipeline, so the AI Coach can reason
	// across weeks ("две недели назад sysdesign 32, сегодня 71 — рост").
	EpisodeMockPipelineFinished EpisodeKind = "mock_pipeline_finished"
	// EpisodeCodexArticleOpened — written when a user opens a Codex
	// article. Daily Brief uses these to spot reading patterns
	// ("regularly opening sysdesign content → suggest a sysdesign mock").
	EpisodeCodexArticleOpened EpisodeKind = "codex_article_opened"
	// EpisodeCueConversationMemory stores compact derived memory from
	// Cue desktop conversations. Raw screenshots/audio are never stored.
	EpisodeCueConversationMemory EpisodeKind = "cue_conversation_memory"
	// EpisodeWeeklyMemorySummary — Phase 4.5 consolidation. One per
	// (user, ISO-week): a compact rollup of every other episode that
	// week. Coach reads these instead of raw episode storms beyond the
	// 7-day fresh window so prompt-bloat stays bounded.
	EpisodeWeeklyMemorySummary EpisodeKind = "weekly_memory_summary"
	// EpisodeExternalActivity — структурированный лог обучения вне druz9
	// (LeetCode / Coursera / YouTube / книги). Пишется hone'ом из
	// AddExternalActivity UC как fire-and-forget side-effect, чтобы AI-tutor
	// recall + daily-brief видели эти эпизоды как часть коач-памяти.
	EpisodeExternalActivity EpisodeKind = "external_activity"
)

// IsValid powers exhaustive switches and runtime guards.
func (k EpisodeKind) IsValid() bool {
	switch k {
	case EpisodeBriefEmitted, EpisodeBriefFollowed, EpisodeBriefDismissed,
		EpisodeQAQuery, EpisodeQAAnswered,
		EpisodeReflectionAdded, EpisodeStandupRecorded,
		EpisodePlanSkipped, EpisodePlanCompleted,
		EpisodeNoteCreated, EpisodeFocusSessionDone,
		EpisodeMockPipelineFinished, EpisodeCodexArticleOpened, EpisodeCueConversationMemory,
		EpisodeWeeklyMemorySummary, EpisodeExternalActivity:
		return true
	}
	return false
}

// String satisfies fmt.Stringer.
func (k EpisodeKind) String() string { return string(k) }

// Episode is one row in coach_episodes.
type Episode struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Kind           EpisodeKind
	Summary        string
	Payload        []byte // raw JSON
	EmbeddingModel string
	EmbeddedAt     *time.Time
	OccurredAt     time.Time
	CreatedAt      time.Time
}

// EpisodeWithScore is a recall hit (cosine similarity).
type EpisodeWithScore struct {
	Episode
	Score float32
}

// MemoryStats is the lightweight count for the trust indicator on the
// DailyBriefPanel («COACH KNOWS [N] EVENTS»).
type MemoryStats struct {
	TotalLast30d int
	ByKind       map[EpisodeKind]int
}

// EpisodeRepo persists coach_episodes rows. Single writer for the
// intelligence bounded context.
type EpisodeRepo interface {
	Append(ctx context.Context, e Episode) error
	LatestByKind(ctx context.Context, userID uuid.UUID, kind EpisodeKind, limit int) ([]Episode, error)
	LatestByKinds(ctx context.Context, userID uuid.UUID, kinds []EpisodeKind, limit int) ([]Episode, error)
	// LatestPerKind returns up to perKindLimit newest rows for each kind in
	// one query. Used by recall recency tails to avoid one SQL round-trip per kind.
	LatestPerKind(ctx context.Context, userID uuid.UUID, kinds []EpisodeKind, perKindLimit int) ([]Episode, error)
	// SearchSimilar returns top-K by cosine over embedding, filtered to
	// episodes embedded with the given model (Phase I: embedding
	// isolation — mixed-model cosine is undefined). modelName == ""
	// disables the filter (test-only path). kinds is optional filter
	// (empty = all kinds). Episodes без embedding'а автоматически пропускаются.
	SearchSimilar(ctx context.Context, userID uuid.UUID, vec []float32, modelName string, kinds []EpisodeKind, limit int) ([]EpisodeWithScore, error)
	// PendingEmbeddings returns rows where embedded_at IS NULL. Used by
	// the async embed worker.
	PendingEmbeddings(ctx context.Context, limit int) ([]Episode, error)
	// MarkStaleForReembed clears embedded_at for episodes whose vector
	// was produced by a model OTHER than currentModelName, so the async
	// embed worker picks them up via the same partial index. Returns
	// count of marked rows. Called once after admin swaps the canonical
	// embedding model (no automatic trigger — re-embedding the corpus is
	// deliberate and rate-limited).
	MarkStaleForReembed(ctx context.Context, currentModelName string) (int64, error)
	// SetEmbedding writes the vector + model + embedded_at=now for one row.
	SetEmbedding(ctx context.Context, id uuid.UUID, vec []float32, model string) error
	// Stats30d returns total + per-kind counts for the user, last 30d.
	Stats30d(ctx context.Context, userID uuid.UUID) (MemoryStats, error)
	// GetBriefRecommendations возвращает recommendations payload одного
	// сохранённого brief'а, scoped by owner. Используется AckRecommendation
	// чтобы достать title + kind по index'у без отдельного fetch'а из
	// hone_daily_briefs.
	GetBriefRecommendations(ctx context.Context, userID, briefID uuid.UUID) ([]Recommendation, error)
	// DeleteOlderThan removes episodes whose occurred_at is strictly older
	// than the cutoff. Returns the number of rows deleted. Used by the
	// retention worker to keep coach memory bounded.
	DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, error)
	// CountByKindInRange — Phase 4.5. Returns map[kind]count of episodes
	// whose occurred_at lies in [from, to). Used by the weekly memory
	// consolidator to build a compact rollup без скана payload-полей.
	CountByKindInRange(ctx context.Context, userID uuid.UUID, from, to time.Time) (map[EpisodeKind]int, error)
	// HasWeeklySummary returns true when a weekly_memory_summary episode
	// already exists for the given (user, week_start). Used to avoid
	// double-consolidation during reruns.
	HasWeeklySummary(ctx context.Context, userID uuid.UUID, weekStart time.Time) (bool, error)
}

// ErrEpisodeNotFound — sentinel для GetBriefRecommendations.
var ErrEpisodeNotFound = errors.New("intelligence: episode not found")
