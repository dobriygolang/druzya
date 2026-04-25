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
)

// IsValid powers exhaustive switches and runtime guards.
func (k EpisodeKind) IsValid() bool {
	switch k {
	case EpisodeBriefEmitted, EpisodeBriefFollowed, EpisodeBriefDismissed,
		EpisodeQAQuery, EpisodeQAAnswered,
		EpisodeReflectionAdded, EpisodeStandupRecorded,
		EpisodePlanSkipped, EpisodePlanCompleted,
		EpisodeNoteCreated, EpisodeFocusSessionDone:
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
	Embedding      []float32
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
	// SearchSimilar returns top-K by cosine over embedding. kinds is
	// optional filter (empty = all kinds). Episodes без embedding'а
	// автоматически пропускаются.
	SearchSimilar(ctx context.Context, userID uuid.UUID, vec []float32, kinds []EpisodeKind, limit int) ([]EpisodeWithScore, error)
	// PendingEmbeddings returns rows where embedded_at IS NULL. Used by
	// the async embed worker.
	PendingEmbeddings(ctx context.Context, limit int) ([]Episode, error)
	// SetEmbedding writes the vector + model + embedded_at=now for one row.
	SetEmbedding(ctx context.Context, id uuid.UUID, vec []float32, model string) error
	// Stats30d returns total + per-kind counts for the user, last 30d.
	Stats30d(ctx context.Context, userID uuid.UUID) (MemoryStats, error)
	// GetBriefRecommendations возвращает recommendations payload одного
	// сохранённого brief'а. Используется AckRecommendation чтобы достать
	// title + kind по index'у — без отдельного fetch'а из hone_daily_briefs.
	GetBriefRecommendations(ctx context.Context, briefID uuid.UUID) ([]Recommendation, error)
}

// ErrEpisodeNotFound — sentinel для GetBriefRecommendations.
var ErrEpisodeNotFound = errors.New("intelligence: episode not found")
