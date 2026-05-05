// Package domain — AI-tutor entities.
//
// Design в /docs/feature/ai-tutor.md. 4 слоя памяти:
//
//	episodic  — Episode (per-message immutable audit row)
//	working   — Thread.SummaryMD (rolling summary, перезаписывается)
//	semantic  — Fact (key/value/confidence per thread)
//	skill     — derived через services/tutor.GetStudentSnapshot, не наша таблица
//
// Reuse: AI-тутор живёт как user с role='ai_tutor', связь со студентом —
// обычная tutor_students запись через services/tutor. Никаких новых
// list/snapshot RPC — существующие работают.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound       = errors.New("ai_tutor: not found")
	ErrInvalidInput   = errors.New("ai_tutor: invalid input")
	ErrRateLimited    = errors.New("ai_tutor: daily message limit reached")
	ErrAlreadyAdopted = errors.New("ai_tutor: already adopted this persona")
)

// EpisodeRole — role enum mirroring SQL CHECK.
type EpisodeRole string

const (
	RoleUser           EpisodeRole = "user"
	RoleAssistant      EpisodeRole = "assistant"
	RoleSystem         EpisodeRole = "system"
	RoleAssignment     EpisodeRole = "assignment"
	RoleSnapshotInject EpisodeRole = "snapshot_inject"
)

func (r EpisodeRole) Valid() bool {
	switch r {
	case RoleUser, RoleAssistant, RoleSystem, RoleAssignment, RoleSnapshotInject:
		return true
	}
	return false
}

// Persona — БД-row, не код. См 00030 seed для 4 курируемых.
type Persona struct {
	ID             uuid.UUID
	Slug           string
	DisplayName    string
	ScopeTrackKind string
	PromptTemplate string // содержит {{snapshot}} / {{facts}} / {{summary}} / {{user_message}}
	PacePerWeek    int
	LLMTaskKind    string // entry в llmchain.TaskMap
	Active         bool
	AIUserID       *uuid.UUID // populated lazily на первом adopt
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Thread — per-(student, persona) разговор. UNIQUE на (student_id, persona_id).
type Thread struct {
	ID                uuid.UUID
	StudentID         uuid.UUID
	PersonaID         uuid.UUID
	SummaryMD         string
	MessageCount      int
	LastCompactedAt   *time.Time
	DailyMsgCount     int
	DailyMsgResetDate time.Time // date-only
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// DailyMessageLimit — после превышения SendMessage возвращает ErrRateLimited.
// Free-tier LLM — стоимости 0, но провайдеры сами ограничивают rps.
const DailyMessageLimit = 30

// Episode — immutable per-message row.
type Episode struct {
	ID         uuid.UUID
	ThreadID   uuid.UUID
	Role       EpisodeRole
	Content    string
	ModelUsed  string
	TokensIn   int
	TokensOut  int
	OccurredAt time.Time
}

// Fact — distilled student-specific knowledge.
//
// Confidence:
//
//	1.0 — explicit user statement («у меня собес 15 мая»)
//	0.5 — LLM-extracted hypothesis after compaction
//	0.0..0.4 — stale / contradicted; recall ranking даёт им низкий приоритет
type Fact struct {
	ID              uuid.UUID
	ThreadID        uuid.UUID
	Key             string
	Value           string
	Confidence      float64
	SourceEpisodeID *uuid.UUID
	LastUsedAt      time.Time
	CreatedAt       time.Time
}

// CompactionTrigger — настройки auto-compaction для SendMessage UC.
//
// Компакт срабатывает если:
//
//	message_count - last_compact_count >= MessageThreshold OR
//	approximate_tokens >= TokenThreshold OR
//	time.Since(last_compacted_at) >= CompactionStaleAfter (Phase R6)
//
// Free-tier Mistral 7B → 8k context. Целимся в ≤4k input на ход:
//
//	persona prompt ~500 + 5 facts ~500 + summary ~1k + last 4 turns ~2k = 4k
const (
	CompactionMessageThreshold = 10
	CompactionTokenThreshold   = 4000

	// CompactionStaleAfter — Phase R6. Если thread не compact'ился >7d,
	// SendMessage всё равно прогоняет compaction (даже при низком
	// message_count). Защищает от двух bug'ов:
	//   - SummaryMD растёт unbounded для медленных threads (1-2 msgs/week)
	//   - Facts с low confidence не decay'ятся → stale memory
	CompactionStaleAfter = 7 * 24 * time.Hour

	// FactDecayRate — Phase R6. Каждый прогон compaction'а понижает
	// confidence у facts которые давно не использовались (touch'ились).
	// 0.1 значит fact полностью исчезает через ~10 неиспользованных
	// compaction циклов (~10 weeks для медленного потока).
	FactDecayRate = 0.10

	// FactDecayThreshold — facts с confidence ниже этого drop'аются на
	// ближайшем compaction. Меньше = более агрессивный gc.
	FactDecayThreshold = 0.30

	// FactDecayUnusedAfter — fact считается "stale" если LastUsedAt
	// старше этого периода. Только stale facts decay'ятся.
	FactDecayUnusedAfter = 7 * 24 * time.Hour
)
