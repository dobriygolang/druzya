// Package domain holds the pure entities and repo contracts for Hone's four
// bounded sub-contexts — plan, focus, notes, whiteboards. No framework imports.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// ─── Plan ──────────────────────────────────────────────────────────────────

// PlanItemKind classifies a row in the AI-generated plan. Kept as a string
// (not an iota enum) because the set is driven by the LLM's output — adding
// a new kind shouldn't require a Go-side migration, only a task_map prompt
// tweak.
type PlanItemKind string

const (
	PlanItemSolve  PlanItemKind = "solve"
	PlanItemMock   PlanItemKind = "mock"
	PlanItemReview PlanItemKind = "review"
	PlanItemRead   PlanItemKind = "read"
	PlanItemCustom PlanItemKind = "custom"
)

// IsValid returns true for known kinds.
func (k PlanItemKind) IsValid() bool {
	switch k {
	case PlanItemSolve, PlanItemMock, PlanItemReview, PlanItemRead, PlanItemCustom:
		return true
	}
	return false
}

// PlanItem is one row in a day's plan. Stored as an element of plan.items
// jsonb array — there is no hone_plan_items table. The id is generated
// client-side-stable so dismiss/complete can target a specific row without
// requiring server roundtrip for insertion.
type PlanItem struct {
	ID           string
	Kind         PlanItemKind
	Title        string
	Subtitle     string
	TargetRef    string
	DeepLink     string
	EstimatedMin int
	Dismissed    bool
	Completed    bool
	// Rationale — мотивирующий контекст («это закрывает твой gap в System
	// Design: progress=28»). Строится синтезайзером из Skill Atlas. Пустая
	// строка = нет rationale'а (клиент показывает только subtitle).
	Rationale string
	// SkillKey — NodeKey скилла которому item адресован, для resistance
	// tracker'а. Пустой у custom/review-item'ов не связанных со skill atlas.
	SkillKey string
}

// Plan is one day's plan for one user.
type Plan struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	Date          time.Time
	Items         []PlanItem
	RegeneratedAt time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// ─── Focus ─────────────────────────────────────────────────────────────────

// FocusMode is "pomodoro" | "stopwatch".
type FocusMode string

const (
	FocusModePomodoro  FocusMode = "pomodoro"
	FocusModeStopwatch FocusMode = "stopwatch"
)

// IsValid returns true for known modes.
func (m FocusMode) IsValid() bool {
	return m == FocusModePomodoro || m == FocusModeStopwatch
}

// FocusSession is one pomodoro-run or stopwatch-run.
type FocusSession struct {
	ID                 uuid.UUID
	UserID             uuid.UUID
	PlanID             *uuid.UUID
	PlanItemID         string
	PinnedTitle        string
	Mode               FocusMode
	StartedAt          time.Time
	EndedAt            *time.Time
	PomodorosCompleted int
	SecondsFocused     int
	CreatedAt          time.Time
}

// StreakState is the user-level summary used by /stats.
type StreakState struct {
	UserID        uuid.UUID
	CurrentStreak int
	LongestStreak int
	LastQualified *time.Time
	UpdatedAt     time.Time
}

// StreakDay is one per-user per-day aggregate row, populated as
// FocusSessions end. "Qualifies" is the boolean that drives streak
// increments — a day is counted once its focused_seconds crosses the
// MinQualifyingSeconds threshold (see app package).
type StreakDay struct {
	UserID          uuid.UUID
	Day             time.Time
	FocusedSeconds  int
	SessionsCount   int
	QualifiesStreak bool
	UpdatedAt       time.Time
}

// Stats is the /stats response aggregate.
type Stats struct {
	CurrentStreakDays int
	LongestStreakDays int
	TotalFocusedSecs  int
	Heatmap           []StreakDay // last 182 days (7x26) for Winter-style grid
	LastSevenDays     []StreakDay // for the bar chart
	Queue             QueueStats  // focus-queue counters (today + 7d AI/user share)
}

// ─── Focus Queue ──────────────────────────────────────────────────────────
//
// QueueItem — одна таска в дневной очереди. AI items материализуются из
// PlanItem'ов после GeneratePlan; user items создаются вручную через
// AddQueueItem. Status — TODO → IN_PROGRESS → DONE flow, причём только
// один item per user может быть IN_PROGRESS одновременно (бизнес-правило
// в app/queue.go UpdateItemStatus).

type QueueItemSource string

const (
	QueueItemSourceAI   QueueItemSource = "ai"
	QueueItemSourceUser QueueItemSource = "user"
)

func (s QueueItemSource) IsValid() bool {
	switch s {
	case QueueItemSourceAI, QueueItemSourceUser:
		return true
	}
	return false
}

type QueueItemStatus string

const (
	QueueItemStatusTodo       QueueItemStatus = "todo"
	QueueItemStatusInProgress QueueItemStatus = "in_progress"
	QueueItemStatusDone       QueueItemStatus = "done"
)

func (s QueueItemStatus) IsValid() bool {
	switch s {
	case QueueItemStatusTodo, QueueItemStatusInProgress, QueueItemStatusDone:
		return true
	}
	return false
}

type QueueItem struct {
	ID        string
	UserID    string
	Title     string
	Source    QueueItemSource
	Status    QueueItemStatus
	Date      time.Time
	SkillKey  string // optional — пусто для user items
	CreatedAt time.Time
	UpdatedAt time.Time
}

// QueueStats — агрегаты для Stats endpoint'а.
//
//   - TodayTotal/TodayDone — счётчик для прогресс-бара «X из Y сделано».
//   - AIShare/UserShare — за last 7 days по DONE items, доли (0.0..1.0).
//     Сумма не обязательно = 1.0 если items имеют редкие source'ы (но
//     с текущими двумя — всегда даёт 1.0). Используется в Stats для
//     карточки «Focus balance · 7 days».
type QueueStats struct {
	TodayTotal int
	TodayDone  int
	AIShare    float32
	UserShare  float32
}

// ─── Notes ─────────────────────────────────────────────────────────────────

// Note is a markdown note, privately scoped to one user.
type Note struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Title          string
	BodyMD         string
	SizeBytes      int
	Embedding      []float32 // 384-dim bge-small, nil until first embedding job ran
	EmbeddingModel string
	EmbeddedAt     *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
	// Encrypted (Phase C-7) — true означает, что BodyMD содержит
	// base64(IV || ciphertext) от AES-256-GCM, key которого derived'ed
	// клиентом из user password + users.vault_kdf_salt. Server при
	// Encrypted=true ДОЛЖЕН пропускать LLM-features (embedding, RAG,
	// publish-to-web) — иначе мы перенесём plaintext в embeddings БД,
	// что ломает E2E threat model.
	Encrypted bool
}

// NoteSummary is the list-view projection — no body, no embedding.
type NoteSummary struct {
	ID        uuid.UUID
	Title     string
	SizeBytes int
	UpdatedAt time.Time
}

// ConnectionKind — kinds of edges that AI discovers from a note.
type ConnectionKind string

const (
	ConnectionKindNote    ConnectionKind = "note"
	ConnectionKindPR      ConnectionKind = "pr"
	ConnectionKindTask    ConnectionKind = "task"
	ConnectionKindSession ConnectionKind = "session"
	ConnectionKindBook    ConnectionKind = "book"
)

// Connection is one AI-discovered edge from a note to another artefact. Not
// persisted — generated on demand via GetNoteConnections and cached at the
// embedding layer.
type Connection struct {
	Kind         ConnectionKind
	TargetID     string
	DisplayTitle string
	Snippet      string
	Similarity   float32
}

// ─── Whiteboard ────────────────────────────────────────────────────────────

// Whiteboard is a tldraw document. state_json is opaque to the server — we
// persist the blob and return it untouched; parsing is client-side only.
type Whiteboard struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Title     string
	StateJSON []byte
	Version   int
	CreatedAt time.Time
	UpdatedAt time.Time
}

// WhiteboardSummary — list-view projection, no state_json.
type WhiteboardSummary struct {
	ID        uuid.UUID
	Title     string
	UpdatedAt time.Time
}

// CritiqueSection identifies which part of the AI architect's critique a
// streamed chunk belongs to.
type CritiqueSection string

const (
	CritiqueStrengths CritiqueSection = "strengths"
	CritiqueConcerns  CritiqueSection = "concerns"
	CritiqueMissing   CritiqueSection = "missing"
	CritiqueClosing   CritiqueSection = "closing"
)

// CritiquePacket is one streaming chunk of AI architect's critique.
type CritiquePacket struct {
	Section CritiqueSection
	Delta   string
	Done    bool
}
