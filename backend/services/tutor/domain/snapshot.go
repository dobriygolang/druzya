//go:generate mockgen -package mocks -destination mocks/snapshot_mock.go -source snapshot.go
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// StudentSnapshot is the aggregated view a tutor sees for one of
// their students (Wave 2.4b of docs/feature/plan.md). Read-only,
// cross-context aggregation: pulled from hone_focus_sessions,
// mock_sessions and skill_nodes via a dedicated repo method.
//
// Why a flat struct instead of nested per-source views: the consumer
// is a tutor dashboard card + a 1-page LLM brief; both want a single
// readable shape. If a future caller wants only «Atlas weak spots»
// — they can walk this struct, no need for a third aggregation
// flavour.
type StudentSnapshot struct {
	StudentID    uuid.UUID
	WindowDays   int
	LastActiveAt time.Time // max(focus_session.ended_at, mock_session.finished_at). Zero when student has no activity in the window.

	// Hone activity (from hone_focus_sessions).
	FocusMinutesWindow int
	FocusSessionsCount int

	// English HR mocks specifically (most relevant for an English tutor).
	EnglishMocksCount     int
	EnglishMocksAvgScore  int // 0..100; 0 when count == 0
	EnglishMocksLastScore int // 0..100

	// Skill Atlas weak-spots — sub-skills with progress < threshold,
	// filtered to the student's English track when present (domain
	// query branches on the join). Empty slice when none / Atlas not
	// populated.
	WeakSpots []WeakSpot

	// Notes count over the window — proxy for «is the student
	// engaging beyond just clicking through the UI». Not displayed
	// directly; surfaces in the LLM brief.
	NotesCount int

	// English-track activity sourced from Hone (Wave 4 + 6.1).
	// All counts are bounded by WindowDays; vocab numbers reflect the
	// CURRENT queue state (not windowed) since SRS is stateful — a
	// «5 cards due today» counter is what the tutor actually wants to
	// see, not «5 cards added in the last 7 days».
	ReadingSessionsCount    int // hone_reading_sessions started inside the window
	ReadingMinutesWindow    int // sum(ended_at - started_at), rounded to minutes
	ReadingMaterialsTotal   int // active rows in hone_reading_materials (not windowed — total library size)
	WritingGradesCount      int // hone_reading_sessions with ai_summary_score IS NOT NULL inside the window (proxy for graded pieces — Writing surface itself doesn't persist)
	ListeningMaterialsTotal int // active hone_listening_materials (total, not windowed)
	VocabQueueTotal         int // active hone_vocab_queue rows (learned_at IS NULL)
	VocabDueToday           int // active rows with next_review_at <= now
}

// WeakSpot is one row in StudentSnapshot.WeakSpots — a sub-skill the
// student is currently weak on. Title is the human-readable name from
// atlas_nodes (e.g. «Reading: tech»); Progress is 0..100 from the
// student's skill_nodes row (or 0 if the row doesn't exist yet).
type WeakSpot struct {
	NodeKey  string
	Title    string
	Progress int
}

// SnapshotRepo is the cross-context read surface. Kept as a separate
// interface (not folded into Repo) so test fakes for tutor-flow tests
// don't have to implement Atlas/Hone/mock queries.
type SnapshotRepo interface {
	// EnsureRelationship returns ErrNotFound if the (tutor, student)
	// pair has no active row in tutor_students. Called BEFORE the
	// snapshot fetch so a malicious tutor can't probe arbitrary
	// student ids.
	EnsureRelationship(ctx context.Context, tutorID, studentID uuid.UUID) error

	// GetStudentSnapshot fetches the aggregated view for studentID
	// over the trailing window. windowDays defaults to 7 in the
	// caller's use case but the repo accepts whatever's passed.
	GetStudentSnapshot(ctx context.Context, studentID uuid.UUID, windowDays int, now time.Time) (StudentSnapshot, error)
}
