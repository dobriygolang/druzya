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

// ─── Cross-product readers ────────────────────────────────────────────────
//
// Coach service объединяет три продукта (Hone focus + druz9 mock-interview +
// druz9 arena/codex) — эти reader'ы пробрасывают в prompt сигналы из
// смежных доменов. Все adapter'ы — raw SQL в cmd/monolith/services/intelligence.go,
// чтобы intelligence-domain не импортировал чужие infra-пакеты.

// MockReader — последние finished mock-interview сессии. Coach использует
// score / weak_topics для personalized recommendations: «last system_design
// scored 6/10, weak on capacity-estimation — practice that today».
type MockReader interface {
	LastNFinished(ctx context.Context, userID uuid.UUID, n int) ([]MockSessionSummary, error)
}

// KataReader — daily kata streak + recent attempts. Сигнал «consistency».
type KataReader interface {
	GetStreak(ctx context.Context, userID uuid.UUID) (KataStreak, error)
	LastNAttempts(ctx context.Context, userID uuid.UUID, n int) ([]KataAttempt, error)
}

// ArenaReader — recent arena matches с outcome + elo delta. Coach видит
// «lost 3 algorithms 1v1 in a row, drop intensity, switch to katas».
type ArenaReader interface {
	LastNMatches(ctx context.Context, userID uuid.UUID, n int) ([]ArenaMatchSummary, error)
}

// QueueReader — снапшот сегодняшней Focus Queue. Coach видит «1/5 done,
// you're behind — focus on first item».
type QueueReader interface {
	TodaySnapshot(ctx context.Context, userID uuid.UUID) (QueueSnapshot, error)
}

// SkillReader — top-N weak skills из Skill Atlas. Coach предлагает решать
// конкретный weakest skill, а не абстрактные «practice algorithms».
type SkillReader interface {
	WeakestN(ctx context.Context, userID uuid.UUID, n int) ([]SkillWeak, error)
}

// DailyNoteReader — recent free-form daily notes (юзер пишет в Today). Это
// signal of intent/mood/topics. Last 3 days хватит для контекста.
type DailyNoteReader interface {
	RecentDailyNotes(ctx context.Context, userID uuid.UUID, n int) ([]DailyNoteHead, error)
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

	// ── Cross-product сигналы (могут быть пустыми если reader не wired) ──

	// Mocks — последние finished mock-interview сессии. Score + weak_topics
	// дают specific recommendations вместо generic «do system design».
	Mocks []MockSessionSummary

	// KataStreak / KataRecent — daily kata consistency (current_streak)
	// + последние passed/failed attempts.
	KataStreak KataStreak
	KataRecent []KataAttempt

	// Arena — последние arena-matches: section, outcome, elo delta. Coach
	// видит losing-streak, frustration patterns.
	Arena []ArenaMatchSummary

	// Queue — снапшот today queue. «You're 1/5 done на сегодня».
	Queue QueueSnapshot

	// WeakSkills — top-5 weakest skills. Самый прямой сигнал «что качать».
	WeakSkills []SkillWeak

	// DailyNotes — head'ы recent free-form daily notes. Mood / intent signal.
	DailyNotes []DailyNoteHead
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
