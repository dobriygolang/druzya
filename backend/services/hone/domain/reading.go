package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Reading sub-context (Wave 4 of docs/feature/english.md). Three flat
// entities — materials, sessions, vocab queue — owned by Hone because
// the user-facing surface is Hone's Reading-модуль (hotkey R), not
// the web. Engineering-only tables (ratings/elo/tasks) are not
// touched; English content lives free-form alongside Hone notes.

// ReadingSourceKind enumerates how a material was ingested. Mirrors
// the CHECK constraint on hone_reading_materials.source_kind. The
// frontend stays free to pick the input flow (paste / URL fetch /
// file upload) without forcing a schema migration per channel.
type ReadingSourceKind string

const (
	ReadingSourcePaste ReadingSourceKind = "paste"
	ReadingSourceURL   ReadingSourceKind = "url"
	ReadingSourcePDF   ReadingSourceKind = "pdf"
	ReadingSourceEPUB  ReadingSourceKind = "epub"
)

// IsValid keeps switches downstream exhaustive.
func (k ReadingSourceKind) IsValid() bool {
	switch k {
	case ReadingSourcePaste, ReadingSourceURL, ReadingSourcePDF, ReadingSourceEPUB:
		return true
	}
	return false
}

// ReadingMaterial mirrors a row in hone_reading_materials. BodyMD is
// the full content; total_chars is precomputed at insert time so
// progress-bar widgets don't have to recount.
type ReadingMaterial struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	SourceKind ReadingSourceKind
	SourceURL  string // empty for SourceKind == paste
	Title      string
	BodyMD     string
	TotalChars int
	ArchivedAt *time.Time // soft-delete; nil = active
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// ReadingSession is one «sit» of reading. Started when the user
// opens the material; ended_at stamped when they close it or the
// pomodoro timer expires.
//
// AISummaryScore + SummaryMD are populated by the post-chapter AI
// summary-check (Wave 4.3 — outside this slice). Both nil/empty
// when the session ends without a summary attempt.
type ReadingSession struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	MaterialID     uuid.UUID
	CharsRead      int
	CharsTotal     int
	StartedAt      time.Time
	EndedAt        *time.Time
	AISummaryScore *int
	SummaryMD      string
}

// VocabEntry is one row in hone_vocab_queue. Box (0..5) drives the
// SRS scheduler — review intervals scale by box level. NextReviewAt
// is the «when to surface this card next» key; LearnedAt non-nil
// means the user has graduated this word and it's no longer in the
// active queue (kept for analytics).
type VocabEntry struct {
	UserID         uuid.UUID
	Word           string
	Translation    string
	ContextMD      string
	SourceMaterial *uuid.UUID
	Box            int
	NextReviewAt   time.Time
	ReviewedCount  int
	LearnedAt      *time.Time
	CreatedAt      time.Time
}

// ReadingRepo is the persistence surface. One interface per sub-
// context (materials / sessions / vocab) would force three injects
// at every callsite — Hone's other sub-contexts use one fat repo
// per area too (NoteRepo, FocusRepo, etc.), so we follow suit.
type ReadingRepo interface {
	// CreateMaterial persists a new material. Caller fills Title,
	// SourceKind, BodyMD; the repo stamps ID + timestamps and
	// computes TotalChars from BodyMD length.
	CreateMaterial(ctx context.Context, m ReadingMaterial) (ReadingMaterial, error)

	// GetMaterial loads a single material; ErrNotFound when absent
	// OR when the requested user_id doesn't own it (cross-user leak
	// protection — same convention as other Hone repos).
	GetMaterial(ctx context.Context, userID, materialID uuid.UUID) (ReadingMaterial, error)

	// ListMaterials returns the user's active materials (ArchivedAt
	// IS NULL), most-recent first. limit caps the result.
	ListMaterials(ctx context.Context, userID uuid.UUID, limit int) ([]ReadingMaterial, error)

	// ArchiveMaterial soft-deletes a material. Returns ErrNotFound
	// if the row doesn't exist or belongs to another user.
	ArchiveMaterial(ctx context.Context, userID, materialID uuid.UUID, now time.Time) error

	// StartSession creates a hone_reading_sessions row and returns
	// it (with ID stamped). chars_total is captured from the
	// material at start-time so a later body edit doesn't lie about
	// «I read 90% of the article».
	StartSession(ctx context.Context, userID, materialID uuid.UUID) (ReadingSession, error)

	// EndSession stamps ended_at and writes chars_read + summary_md
	// (when the user submitted a summary). ai_summary_score stays
	// nil here — the AI grader is a separate flow (Wave 4.3).
	EndSession(ctx context.Context, userID, sessionID uuid.UUID, charsRead int, summaryMD string, now time.Time) error

	// GetSession loads a single session row. Used by the post-end
	// grader path (read-modify-write of ai_summary_score) and by
	// future analytics callers. ErrNotFound on cross-user probe.
	GetSession(ctx context.Context, userID, sessionID uuid.UUID) (ReadingSession, error)

	// SetAISummaryScore persists the AI-graded score (0..100) onto a
	// completed session. Idempotent — re-grading the same session
	// overwrites the previous score; we don't keep a history.
	SetAISummaryScore(ctx context.Context, userID, sessionID uuid.UUID, score int) error

	// ListVocabDue returns vocab entries due today (next_review_at
	// <= now), ordered earliest-first. Drives the daily 5-minute
	// review widget. Excludes learned_at IS NOT NULL.
	ListVocabDue(ctx context.Context, userID uuid.UUID, now time.Time, limit int) ([]VocabEntry, error)

	// UpsertVocab adds a word to the queue OR refreshes its
	// context_md if it already exists. Idempotent — clicking the
	// same word twice in the same chapter doesn't reset the box.
	UpsertVocab(ctx context.Context, e VocabEntry) (VocabEntry, error)

	// AdvanceVocab moves a vocab card forward in the SRS algorithm.
	// `correct` distinguishes graduating (box+1) from regressing
	// (box=0). LearnedAt is stamped when box reaches 5.
	AdvanceVocab(ctx context.Context, userID uuid.UUID, word string, correct bool, now time.Time) (VocabEntry, error)

	// ListVocabBySourceMaterial — Wave 4.2 reverse cross-link. Returns
	// every vocab entry whose `source_material` points to materialID,
	// scoped to the user. Reader UI shows «vocab you've saved from this
	// material» sidebar; without this method that surface would require
	// the client to fetch the entire vocab queue and filter.
	// limit caps the result; 0 → server default (50).
	ListVocabBySourceMaterial(ctx context.Context, userID, materialID uuid.UUID, limit int) ([]VocabEntry, error)
}

// SummaryGrader scores a user-written summary against the source
// material on a 0..100 scale. Wave 4.3 «AI summary check»: after
// the user finishes a chapter and submits their summary, the grader
// compares it to the chapter body and returns coverage + accuracy.
//
// Implementations are LLM-backed; an explicit no-op fallback returns
// ErrLLMUnavailable when the chain isn't configured. Use cases that
// call this MUST treat both ErrLLMUnavailable and any other error as
// non-fatal — the session was already persisted by EndSession, the
// grade is best-effort.
type SummaryGrader interface {
	GradeSummary(ctx context.Context, in GradeSummaryInput) (int, error)
}

// GradeSummaryInput carries everything the LLM needs to grade. Title
// is included so the prompt can scope its judgement to the chapter,
// not the whole book/article series.
type GradeSummaryInput struct {
	Title   string
	BodyMD  string
	Summary string
}
