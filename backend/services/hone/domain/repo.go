//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ─── Plan ──────────────────────────────────────────────────────────────────

// PlanRepo persists hone_daily_plans.
type PlanRepo interface {
	// GetForDate returns the plan for (user, date) — ErrNotFound if none.
	GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (Plan, error)
	// Upsert replaces the plan for (user, date). Used by GenerateDailyPlan
	// to overwrite; items list is the full canonical list.
	Upsert(ctx context.Context, p Plan) (Plan, error)
	// PatchItem updates the Dismissed/Completed flags of one item in place.
	// O(1) from the client's perspective; server re-serialises the jsonb.
	PatchItem(ctx context.Context, userID uuid.UUID, date time.Time, itemID string, dismissed, completed bool) (Plan, error)
}

// ─── Focus ─────────────────────────────────────────────────────────────────

// FocusRepo persists hone_focus_sessions.
type FocusRepo interface {
	// Create inserts a started session (ended_at nil). Returns the hydrated row.
	Create(ctx context.Context, s FocusSession) (FocusSession, error)
	// End updates an existing session with ended_at + totals. Returns the
	// hydrated row; ErrNotFound if the id doesn't exist or isn't owned by
	// the caller.
	End(ctx context.Context, userID, sessionID uuid.UUID, endedAt time.Time, pomodoros, secondsFocused int) (FocusSession, error)
	// Get returns a single session (by id + owner).
	Get(ctx context.Context, userID, sessionID uuid.UUID) (FocusSession, error)
}

// StreakRepo owns hone_streak_days + hone_streak_state.
type StreakRepo interface {
	// GetState returns the user's current streak summary. Never returns
	// ErrNotFound — an unseen user has a zero-value row.
	GetState(ctx context.Context, userID uuid.UUID) (StreakState, error)
	// ApplyFocusSession is the transactional mutation called by FocusSession
	// End — it upserts the day's aggregate and possibly bumps state.
	ApplyFocusSession(ctx context.Context, userID uuid.UUID, day time.Time, secondsDelta, sessionsDelta int, qualifyingThreshold int) (StreakState, error)
	// RangeDays returns all hone_streak_days in [from, to] inclusive. Used
	// to hydrate Stats.Heatmap + LastSevenDays.
	RangeDays(ctx context.Context, userID uuid.UUID, from, to time.Time) ([]StreakDay, error)

	// FindDrift scans hone_focus_sessions vs hone_streak_days for (user, day)
	// pairs where the aggregate diverges: session rows exist for a day but
	// streak_days is missing or has stale focused_seconds / sessions_count.
	// Used by StreakReconciler (background) to fix EndFocus failures where
	// the apply-mutation step errored out while the session was persisted.
	// `lookback` bounds the scan to the last N days — full-history rescan
	// is wasteful and the reconciler runs frequently.
	FindDrift(ctx context.Context, lookback time.Duration) ([]DriftRow, error)

	// RecomputeDay overwrites hone_streak_days with absolute values (not a
	// delta) and re-runs the state transition. Idempotent — running twice
	// for the same inputs is safe. Called by the reconciler, not by normal
	// request path (which uses ApplyFocusSession for the delta semantics).
	RecomputeDay(ctx context.Context, userID uuid.UUID, day time.Time, secondsAbs, sessionsAbs, qualifyingThreshold int) (StreakState, error)
}

// DriftRow is the projection returned by FindDrift. `ActualSeconds` /
// `ActualSessions` are source-of-truth aggregates from focus_sessions;
// `StoredSeconds` / `StoredSessions` are what streak_days currently holds
// (both zero when the streak_days row is missing entirely).
type DriftRow struct {
	UserID          uuid.UUID
	Day             time.Time
	ActualSeconds   int
	ActualSessions  int
	StoredSeconds   int
	StoredSessions  int
	StoredDayExists bool
}

// ─── Notes ─────────────────────────────────────────────────────────────────

// NoteRepo persists hone_notes.
type NoteRepo interface {
	Create(ctx context.Context, n Note) (Note, error)
	Update(ctx context.Context, n Note) (Note, error)
	Get(ctx context.Context, userID, noteID uuid.UUID) (Note, error)
	List(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]NoteSummary, string, error)
	Delete(ctx context.Context, userID, noteID uuid.UUID) error
	// SetEmbedding replaces the embedding vector + metadata. Called from
	// the async embedding worker after Update.
	SetEmbedding(ctx context.Context, userID, noteID uuid.UUID, vec []float32, model string, at time.Time) error
	// WithEmbeddingsForUser loads all notes with non-null embeddings, for
	// in-memory cosine scan during GetNoteConnections. Returns minimal
	// projection (id, title, embedding) to keep payload small.
	WithEmbeddingsForUser(ctx context.Context, userID uuid.UUID) ([]NoteEmbedding, error)
}

// NoteEmbedding is the minimal projection used by the cosine scanner.
type NoteEmbedding struct {
	ID        uuid.UUID
	Title     string
	Snippet   string // first N chars of body_md, prepared at query time
	Embedding []float32
}

// Embedder is the bge-small wrapper. Real impl talks to Ollama via
// llmcache; STUB returns ErrEmbeddingUnavailable.
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, string, error)
}

// ─── Whiteboard ────────────────────────────────────────────────────────────

// WhiteboardRepo persists hone_whiteboards.
type WhiteboardRepo interface {
	Create(ctx context.Context, wb Whiteboard) (Whiteboard, error)
	// Update accepts expected_version for optimistic concurrency. Pass 0 to
	// skip the check.
	Update(ctx context.Context, wb Whiteboard, expectedVersion int) (Whiteboard, error)
	Get(ctx context.Context, userID, wbID uuid.UUID) (Whiteboard, error)
	List(ctx context.Context, userID uuid.UUID) ([]WhiteboardSummary, error)
	Delete(ctx context.Context, userID, wbID uuid.UUID) error
}

// ─── Cross-domain readers (adapter-owned interfaces) ───────────────────────

// SkillAtlasReader exposes the current user's weakest skill nodes, used by
// plan_generator to target today's "solve" item. Implementation lives in
// monolith/services/adapters.go and wraps profile's SkillRepo.
//
// Keeping the interface here (not importing from profile) preserves the
// hard domain boundary: hone never depends on profile's public types.
type SkillAtlasReader interface {
	WeakestNodes(ctx context.Context, userID uuid.UUID, limit int) ([]WeakNode, error)
}

// WeakNode is the minimal projection returned to plan_generator.
type WeakNode struct {
	NodeKey     string // e.g. "algo.bfs"
	DisplayName string // e.g. "BFS on trees"
	Progress    int    // 0..100
	Priority    string // "high" | "medium" | "low"
}

// CritiqueStreamer is the llmchain wrapper for CritiqueWhiteboard. Real impl
// calls TaskSysDesignCritique and streams packets; STUB returns
// ErrLLMUnavailable immediately.
type CritiqueStreamer interface {
	Critique(ctx context.Context, whiteboardStateJSON []byte, yield func(CritiquePacket) error) error
}

// PlanSynthesizer is the llmchain wrapper for GenerateDailyPlan. Real impl
// calls TaskDailyPlanSynthesis with a strict-JSON prompt; STUB returns
// ErrLLMUnavailable. A nil synthesiser in the app struct must be checked
// at call time — the service boots without LLM when no keys are configured.
type PlanSynthesizer interface {
	Synthesise(ctx context.Context, userID uuid.UUID, weakNodes []WeakNode, date time.Time) ([]PlanItem, error)
}
