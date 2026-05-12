package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// InsightSurface keeps the closed set of UI surfaces where an insight
// can appear. New entries require both a SQL row check (the column is
// TEXT not enum, but readers MUST match this set) and a UI mount.
type InsightSurface string

const (
	InsightSurfaceToday InsightSurface = "today"
	// Arena removed 2026-05-12 (D8) — no surface для arena в текущем продукте.
	InsightSurfaceMock  InsightSurface = "mock"
	InsightSurfaceCodex InsightSurface = "codex"
)

// IsValid returns true for known surfaces.
func (s InsightSurface) IsValid() bool {
	switch s {
	case InsightSurfaceToday, InsightSurfaceMock, InsightSurfaceCodex:
		return true
	}
	return false
}

// InsightSeverity mirrors the SQL `insight_severity` enum.
type InsightSeverity string

const (
	InsightSeverityCruise   InsightSeverity = "cruise"
	InsightSeverityNudge    InsightSeverity = "nudge"
	InsightSeverityWarn     InsightSeverity = "warn"
	InsightSeverityCritical InsightSeverity = "critical"
)

// IsValid returns true for known severities.
func (s InsightSeverity) IsValid() bool {
	switch s {
	case InsightSeverityCruise, InsightSeverityNudge, InsightSeverityWarn, InsightSeverityCritical:
		return true
	}
	return false
}

// Insight is the atomic "fact of the day" the coach surfaces.
//
// Shape on purpose: every field plays a role.
//   - Headline: ≤80 char, the only thing rendered when the user
//     glances. MUST be a fact, not a generic verb.
//   - Evidence: 1 sentence with numbers ("4 of 7 days <30 min focus").
//   - Interpret: 1 sentence pattern claim ("not noise — 3rd week").
//   - Lever: 1 sentence today's action ("25-min DP drill before 12").
//   - DeepLink: in-app route the lever opens. Empty when there is no
//     concrete target (sparse-data nudges).
//
// Anchor stably identifies what the insight is about, so the generator
// can upsert (instead of producing a duplicate the next morning).
type Insight struct {
	ID       uuid.UUID
	UserID   uuid.UUID
	Surface  InsightSurface
	Severity InsightSeverity
	Anchor   string

	Headline  string
	Evidence  string
	Interpret string
	Lever     string
	DeepLink  string

	EventID   *uuid.UUID
	SkillKey  string
	CodexSlug string
	TrackID   *uuid.UUID

	DismissedAt *time.Time
	ActedAt     *time.Time

	GeneratedAt time.Time
	ExpiresAt   time.Time
}

// IsLive reports whether the insight should be visible to the user
// right now (not dismissed, not expired).
func (i Insight) IsLive(now time.Time) bool {
	if i.DismissedAt != nil {
		return false
	}
	if i.ExpiresAt.Before(now) {
		return false
	}
	return true
}

// InsightRepo is the persistence port for the insight stream.
type InsightRepo interface {
	// Upsert writes the insight identified by (user_id, surface, anchor).
	// Existing row's headline/evidence/severity/expires are overwritten;
	// dismissed_at and acted_at survive (so re-generation doesn't
	// resurrect a dismissed insight inside the dismiss window).
	Upsert(ctx context.Context, in Insight) (Insight, error)

	// ListLiveBySurface returns insights for one surface, freshest
	// first, capped at limit. Filters dismissed + expired at the SQL
	// layer so callers can render directly.
	ListLiveBySurface(ctx context.Context, userID uuid.UUID, surface InsightSurface, limit int) ([]Insight, error)

	// ListLiveBySurfacePaged — same as ListLiveBySurface but with
	// offset+limit pagination. Returns rows + the total live count for
	// (user, surface) so the UI can render «N of M» / page controls.
	// Severity-then-recency ordering preserved.
	ListLiveBySurfacePaged(ctx context.Context, userID uuid.UUID, surface InsightSurface, offset, limit int) ([]Insight, int, error)

	// MarkDismissed records a user-visible dismiss (×). Idempotent.
	MarkDismissed(ctx context.Context, userID, insightID uuid.UUID) error

	// MarkActed records that the user followed the lever (✓). Idempotent.
	MarkActed(ctx context.Context, userID, insightID uuid.UUID) error

	// SweepExpired deletes rows past expires_at. Cron-driven.
	SweepExpired(ctx context.Context) (int64, error)
}

// ErrInsightNotFound — sentinel for not-found inside the insight repo.
// Reuses domain.ErrNotFound contract via wrap; declared explicitly so
// adapters can match without importing other domain errors.
var ErrInsightNotFound = errors.New("intelligence: insight not found")
