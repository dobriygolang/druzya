//go:generate mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"fmt"
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

// ─── Subscription tier (cross-domain read-only reader) ─────────────────────

// TierReader проверяет, активен ли у пользователя Pro-tier. Используется
// транспортом hone'а для gate'инга premium-endpoint'ов (GeneratePlan,
// CritiqueWhiteboard, GetNoteConnections).
//
// Реализация — adapter в monolith/services/adapters.go, который дёргает
// subscription.GetTier и сравнивает с TierPro. Держим интерфейс в hone
// domain'е, чтобы не тянуть subscription-пакет как прямую зависимость.
type TierReader interface {
	IsPro(ctx context.Context, userID uuid.UUID) (bool, error)
}

// ─── Resistance ────────────────────────────────────────────────────────────

// ResistanceRepo — persist dismiss-event'ы для «chronic skip» детектора.
// Запись идёт из DismissPlanItem только когда item.SkillKey непустой
// (custom/review item'ы в resistance-логике не участвуют).
type ResistanceRepo interface {
	// Record пишет одну dismiss-event. Идемпотентен: PRIMARY KEY
	// (user, skill, item_id, plan_date) гарантирует, что повторный dismiss
	// того же item'а в тот же день не создаст дубль.
	Record(ctx context.Context, userID uuid.UUID, skillKey, itemID string, planDate time.Time) error
	// ChronicSkills возвращает скиллы, от которых пользователь отмахивался
	// `minCount`+ раз за `window`. Пустой slice — нет сопротивления, obvious
	// result. Используется синтезайзером.
	ChronicSkills(ctx context.Context, userID uuid.UUID, window time.Duration, minCount int) ([]ChronicSkill, error)
}

// ChronicSkill — агрегат для синтезайзера.
type ChronicSkill struct {
	SkillKey  string
	SkipCount int
	LastSkip  time.Time
}

// ─── Folders ───────────────────────────────────────────────────────────────

// FolderRepo persists hone_note_folders.
type FolderRepo interface {
	Create(ctx context.Context, f Folder) (Folder, error)
	List(ctx context.Context, userID uuid.UUID) ([]Folder, error)
	// Delete removes the folder. If moveNotesToRoot is true, notes in this
	// folder are moved to root (folder_id = NULL) in the same transaction.
	// If false and notes exist, returns ErrFolderNotEmpty.
	Delete(ctx context.Context, userID, folderID uuid.UUID, moveNotesToRoot bool) error
}

// ErrFolderNotEmpty is returned when deleting a non-empty folder without moveNotesToRoot.
var ErrFolderNotEmpty = fmt.Errorf("folder is not empty")

// ─── Notes ─────────────────────────────────────────────────────────────────

// NoteRepo persists hone_notes.
type NoteRepo interface {
	Create(ctx context.Context, n Note) (Note, error)
	Update(ctx context.Context, n Note) (Note, error)
	Get(ctx context.Context, userID, noteID uuid.UUID) (Note, error)
	// List returns notes filtered by folderID when non-nil, or all notes when nil.
	List(ctx context.Context, userID uuid.UUID, limit int, cursor string, folderID *uuid.UUID) ([]NoteSummary, string, error)
	Delete(ctx context.Context, userID, noteID uuid.UUID) error
	// Move sets folder_id for a note. folderID nil = move to root.
	Move(ctx context.Context, userID, noteID uuid.UUID, folderID *uuid.UUID) (Note, error)
	// SetEmbedding replaces the embedding vector + metadata. Called from
	// the async embedding worker after Update.
	SetEmbedding(ctx context.Context, userID, noteID uuid.UUID, vec []float32, model string, at time.Time) error
	// MarkStaleForReembed clears embedded_at for every note whose vector
	// was produced by a model OTHER than currentModelName. Returns the
	// count of marked rows. The async embed worker picks them up via the
	// `WHERE embedded_at IS NULL` partial index and re-embeds with the
	// current model. Idempotent. Called once after admin swaps the
	// canonical embedding model — there is no automatic trigger because
	// re-embedding the whole corpus is expensive and must be deliberate.
	MarkStaleForReembed(ctx context.Context, currentModelName string) (int64, error)
	// WithEmbeddingsForUser loads notes with embeddings produced by the
	// given model name (embedding isolation). Vectors from other models
	// are excluded — comparing across embedding spaces is undefined and
	// silently corrupts cosine results. Returns minimal projection
	// (id, title, embedding) to keep payload small.
	//
	// Deprecated in favour of SearchSimilarNotes (push-down to Postgres
	// via pgvector). Kept for tests / dev environments without the
	// pgvector extension.
	WithEmbeddingsForUser(ctx context.Context, userID uuid.UUID, modelName string) ([]NoteEmbedding, error)
	// SearchSimilarNotes — top-K по cosine distance напрямую
	// в Postgres через pgvector `<=>` operator + IVFFlat index. Никакого
	// Go-cosine, никакого pre-fetch'а корпуса. excludeNoteID можно
	// передать чтобы отфильтровать seed-note из результатов (использует
	// GetNoteConnections); uuid.Nil = не фильтровать. simFloor — нижний
	// порог similarity (0.6 — sweet spot для bge-small).
	SearchSimilarNotes(
		ctx context.Context,
		userID uuid.UUID,
		queryVec []float32,
		modelName string,
		excludeNoteID uuid.UUID,
		simFloor float32,
		limit int,
	) ([]NoteSimilarityHit, error)
	// ExistsByTitleForUser — точный match по title. Используется
	// TodayStandup чтобы понять «уже записал standup сегодня?» — note
	// title = "Standup YYYY-MM-DD".
	ExistsByTitleForUser(ctx context.Context, userID uuid.UUID, title string) (bool, error)
}

// NoteEmbedding is the minimal projection used by the cosine scanner.
type NoteEmbedding struct {
	ID        uuid.UUID
	Title     string
	Snippet   string // first N chars of body_md, prepared at query time
	Embedding []float32
}

// NoteSimilarityHit — row из SearchSimilarNotes pgvector результата.
// Score уже посчитан в Postgres (1 - cosine_distance);
// не нужно дополнительной cosine math на caller-side.
type NoteSimilarityHit struct {
	ID      uuid.UUID
	Title   string
	Snippet string
	Score   float32 // [0..1] для cosine; больше = ближе
}

// Embedder is the bge-small wrapper. Production impl is HoneEmbedder
// (Ollama via llmcache) wired in cmd/monolith; NoEmbedder is the explicit
// "Ollama not configured" fallback that returns ErrEmbeddingUnavailable so
// callers surface a real 503 instead of indexing nothing silently.
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

// CritiqueStreamer is the llmchain wrapper for CritiqueWhiteboard.
// Production impl (LLMChainCritiqueStreamer) calls TaskSysDesignCritique
// and streams packets; NoLLMCritiqueStreamer is the wired-but-disabled
// fallback that returns ErrLLMUnavailable so the 503 is honest.
type CritiqueStreamer interface {
	Critique(ctx context.Context, whiteboardStateJSON []byte, yield func(CritiquePacket) error) error
}

// PlanSynthesizer is the llmchain wrapper for GenerateDailyPlan.
// Production impl (LLMChainPlanSynthesiser) calls TaskDailyPlanSynthesis
// with a strict-JSON prompt; NoLLMPlanSynthesiser is the wired-but-disabled
// fallback that returns ErrLLMUnavailable. A nil synthesiser in the app
// struct must be checked at call time — the service boots without LLM
// when no keys are configured.
//
// chronic — скиллы с высокой «стеной сопротивления» (>= N dismiss'ов за
// последние M дней). Синтезайзер использует их чтобы разбивать pump-up
// задачи на меньшие или генерировать reflection-prompt'ы. nil/empty —
// обычный plan без поправок.
type PlanSynthesizer interface {
	Synthesise(ctx context.Context, userID uuid.UUID, weakNodes []WeakNode, chronic []ChronicSkill, today TodayContext, date time.Time) ([]PlanItem, error)
}

// ─── Focus Queue ──────────────────────────────────────────────────────────

// QueueRepo persists hone_queue_items. Per-user, per-day list. UpdateStatus
// инкапсулирует бизнес-правило «один in_progress на user одновременно» —
// см. impl в infra/postgres.go (single transaction reset+update).
type QueueRepo interface {
	// ListByDate возвращает все items на дату, отсортированные:
	// in_progress (top) → todo (by created_at) → done (bottom).
	ListByDate(ctx context.Context, userID uuid.UUID, date time.Time) ([]QueueItem, error)
	// Create вставляет новый item, возвращает hydrated row с id/created_at.
	Create(ctx context.Context, item QueueItem) (QueueItem, error)
	// UpdateStatus меняет status. Если new = in_progress, все остальные
	// in_progress items этого user'а на сегодня сбрасываются в todo.
	UpdateStatus(ctx context.Context, id, userID uuid.UUID, status QueueItemStatus) (QueueItem, error)
	// Delete — owner-only hard delete.
	Delete(ctx context.Context, id, userID uuid.UUID) error
	// ExistsByTitleToday — для SyncAIItems-идемпотентности.
	ExistsByTitleToday(ctx context.Context, userID uuid.UUID, title string) (bool, error)
	// CountTodayByStatus — for QueueStats. Возвращает (total, done).
	CountTodayByStatus(ctx context.Context, userID uuid.UUID) (total, done int, err error)
	// GetAIShareLast7Days — доли AI/user среди DONE items за 7 дней (0..1).
	// Если за 7 дней нет done items — возвращает (0, 0, nil).
	GetAIShareLast7Days(ctx context.Context, userID uuid.UUID) (aiShare, userShare float32, err error)
}

// ─── Cue Sessions ──────────────────────────────────────────────────────────

// CueSessionRepo владеет hone_cue_sessions. Idempotent по (user_id, file_path):
// повторный Import не дублирует, обновляет raw_analysis но НЕ перезаписывает
// body_md (юзерские правки сохраняются).
type CueSessionRepo interface {
	// Import создаёт или обновляет сессию по (user_id, file_path).
	// На update'е перезаписывает title + raw_analysis + started_at, но
	// body_md и id остаются прежними. Возвращает hydrated row.
	// initialBodyMD заполняет body_md ТОЛЬКО при первом импорте.
	Import(ctx context.Context, s CueSession, initialBodyMD string) (CueSession, error)
	List(ctx context.Context, userID uuid.UUID) ([]CueSession, error)
	Get(ctx context.Context, userID, id uuid.UUID) (CueSession, error)
	UpdateBody(ctx context.Context, userID, id uuid.UUID, bodyMD string) (CueSession, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
}

// NotificationSender — cross-domain интерфейс для отправки follow-up
// сообщений в Telegram (или другой канал). Реализация живёт в monolith
// adapter'е и проксирует в notify.SendNotification.Do.
//
// Hone не зависит от notify-сервиса напрямую — этот интерфейс инвертирует
// зависимость.
type NotificationSender interface {
	// SendCueFollowup шлёт markdown-текст в Telegram-чат юзера. Если у
	// юзера не linked TG, возвращает (ok=false, message="not linked"),
	// без error'а — это user-facing статус, не infra-failure.
	SendCueFollowup(ctx context.Context, userID uuid.UUID, title, bodyMD string) (ok bool, message string, err error)
}
