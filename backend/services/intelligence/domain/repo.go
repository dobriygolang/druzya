package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// DailyBriefRepo persists hone_daily_briefs.
type DailyBriefRepo interface {
	// GetForDate returns the cached brief for (user, date). ErrNotFound
	// when no row exists.
	GetForDate(ctx context.Context, userID uuid.UUID, date time.Time) (DailyBrief, error)
	// Upsert replaces the cached brief for (user, date).
	Upsert(ctx context.Context, userID uuid.UUID, date time.Time, b DailyBrief) error
	// LastForcedAt returns the generated_at of the most-recent brief for
	// the user. Used to gate force=true to 1/h. Zero time when none.
	LastForcedAt(ctx context.Context, userID uuid.UUID) (time.Time, error)
}

// FocusReader reads focus aggregates for the daily-brief prompt. Implementation
// lives in cmd/monolith/services/intelligence.go and queries hone_streak_days.
type FocusReader interface {
	LastNDays(ctx context.Context, userID uuid.UUID, n int) ([]FocusDay, error)
}

// PlanReader reads skipped + completed plan items for the daily-brief
// prompt. Implementation lives in cmd/monolith/services/intelligence.go
// and walks hone_daily_plans.items jsonb.
type PlanReader interface {
	SkippedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]SkippedPlanItem, error)
	CompletedItems(ctx context.Context, userID uuid.UUID, since time.Time) ([]CompletedPlanItem, error)
}

// NotesReader reads reflection lines + recent notes + embedding-equipped
// corpus. Implementation lives in cmd/monolith/services/intelligence.go.
type NotesReader interface {
	// RecentReflections returns the last N reflection-style notes (notes
	// whose title contains the " — YYYY-MM-DD" suffix written by EndFocusSession).
	RecentReflections(ctx context.Context, userID uuid.UUID, limit int) ([]Reflection, error)
	// RecentNotes returns the top-N notes by updated_at DESC.
	RecentNotes(ctx context.Context, userID uuid.UUID, limit int) ([]NoteHead, error)
	// EmbeddedCorpus returns ALL notes that have a non-null embedding,
	// projection includes full body_md (capped) for QA-context assembly.
	EmbeddedCorpus(ctx context.Context, userID uuid.UUID) ([]NoteEmbedding, error)
}

// Embedder is the bge-small wrapper. Real impl talks to Ollama via the
// shared HoneEmbedder; floor returns ErrEmbeddingUnavailable.
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, string, error)
}

// BriefSynthesizer generates the daily brief via TaskDailyBrief. Real impl
// returns strict JSON parsed into the struct; floor returns ErrLLMUnavailable.
type BriefSynthesizer interface {
	Synthesise(ctx context.Context, in BriefPromptInput) (DailyBrief, error)
}

// BriefPromptInput aggregates everything the synthesiser needs.
type BriefPromptInput struct {
	UserID          uuid.UUID
	Today           time.Time
	FocusDays       []FocusDay
	SkippedRecent   []SkippedPlanItem
	CompletedRecent []CompletedPlanItem
	Reflections     []Reflection
	RecentNotes     []NoteHead
	// PastEpisodes — Memory.Recall hits, передаются в prompt как
	// «past coach interactions» — синтезайзер избегает повторов и
	// корректирует тон под историю user-реакций.
	PastEpisodes []Episode
}

// AskNotesPromptInput — вход для NoteAnswerer (Phase B). Past Q&A
// эпизоды дают модели контекст «юзер уже спрашивал X».
type AskNotesPromptInput struct {
	Question     string
	ContextNotes []NoteEmbedding
	PastEpisodes []Episode
}

// NoteAnswerer synthesises an answer from question + top-K notes + past Q&A
// episodes. Real impl uses TaskNoteQA; floor returns ErrLLMUnavailable.
//
// Sig сохранена обратно-совместимой: первая версия принимала только
// (question, ctxNotes). Новый параметр past — optional (nil = old behaviour).
type NoteAnswerer interface {
	Answer(ctx context.Context, in AskNotesPromptInput) (string, error)
}
