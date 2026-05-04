package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// PersonaRepo — read-mostly catalogue. Админ редактирует через CMS.
type PersonaRepo interface {
	GetBySlug(ctx context.Context, slug string) (Persona, error)
	GetByID(ctx context.Context, id uuid.UUID) (Persona, error)
	ListActive(ctx context.Context) ([]Persona, error)
	// SetAIUserID populates ai_user_id на первом adopt'е персоны.
	// Идемпотентно: если уже выставлено — no-op.
	SetAIUserID(ctx context.Context, personaID, aiUserID uuid.UUID) error
}

// ThreadRepo — chat threads.
//
// NOTE: метод называется GetThreadByID а не просто GetByID — потому что
// один *Postgres struct реализует и PersonaRepo, и ThreadRepo, и Go не
// допускает двух методов с одним именем и разными сигнатурами на одном
// типе. То же самое мотивация для ListThreadsByStudent.
type ThreadRepo interface {
	// CreateOrGet — идемпотентно. Если thread (student, persona) уже
	// существует — возвращает существующий без перезаписи summary.
	CreateOrGet(ctx context.Context, studentID, personaID uuid.UUID) (Thread, error)
	GetThreadByID(ctx context.Context, id uuid.UUID) (Thread, error)
	ListThreadsByStudent(ctx context.Context, studentID uuid.UUID) ([]Thread, error)

	// IncrementMessageCount + rolling daily counter. Возвращает обновлённый
	// thread. Если daily_msg_count >= DailyMessageLimit (после reset на
	// новый день) → ErrRateLimited.
	IncrementCounters(ctx context.Context, threadID uuid.UUID, now time.Time) (Thread, error)

	// UpdateSummary перезаписывает summary_md и стампит last_compacted_at.
	UpdateSummary(ctx context.Context, threadID uuid.UUID, summary string, now time.Time) error
}

// EpisodeRepo — append-only audit log.
type EpisodeRepo interface {
	Append(ctx context.Context, e Episode) (Episode, error)
	// ListRecent возвращает последние N episodes (any role) ordered by
	// occurred_at ASC. Используется в SendMessage для recall + compaction.
	ListRecent(ctx context.Context, threadID uuid.UUID, limit int) ([]Episode, error)
	// CountSinceCompaction — message_count − episodes_at_last_compaction.
	// Триггер для auto-compaction.
	CountSinceCompaction(ctx context.Context, threadID uuid.UUID, since *time.Time) (int, error)
}

// FactRepo — semantic memory с ranked recall.
type FactRepo interface {
	// Upsert — INSERT … ON CONFLICT (thread_id, fact_key) DO UPDATE.
	// На update: value/confidence/source_episode_id перезаписываются.
	Upsert(ctx context.Context, f Fact) (Fact, error)
	// TopRanked — recall query: ORDER BY confidence DESC, last_used_at DESC.
	// limit обычно 5 для prompt budget.
	TopRanked(ctx context.Context, threadID uuid.UUID, limit int) ([]Fact, error)
	// TouchLastUsed — после того как fact попал в prompt, апдейтим
	// last_used_at чтобы recall ranking видел его как актуальный.
	TouchLastUsed(ctx context.Context, ids []uuid.UUID, now time.Time) error
	// Delete — для случая «студент явно опроверг fact».
	Delete(ctx context.Context, threadID uuid.UUID, key string) error
}

// AIUserCreator — adapter, создающий user с role='ai_tutor' если ещё нет.
// Реализация в services/profile или прямо в monolith wiring (мы не
// зависим от services/profile из ai_tutor — оставляем чистый контракт).
type AIUserCreator interface {
	// EnsureAIUser возвращает id уже существующего AI-юзера или создаёт
	// нового. external_id = persona.slug, role = 'ai_tutor'.
	EnsureAIUser(ctx context.Context, personaSlug, displayName string) (uuid.UUID, error)
}

// TutorRelator — bridge to existing services/tutor. AI-тутор использует
// тот же relationship-механизм что human-туторы — ListMyTutors уже
// возвращает обоих.
type TutorRelator interface {
	// EnsureRelationship создаёт tutor_students row если ещё нет.
	// Идемпотентно. tutorID — это ai_user_id персоны.
	EnsureRelationship(ctx context.Context, tutorID, studentID uuid.UUID, now time.Time) error
}

// SnapshotProvider — bridge to services/tutor StudentSnapshot. Чтобы не
// тащить весь tutor.StudentSnapshot type через границу, отдаём УЖЕ
// rendered text-block (3-5 строк plain text). Adapter в monolith
// wiring владеет форматированием.
//
// Возврат пустой строки = «нет данных, snapshot пропущен в prompt».
type SnapshotProvider interface {
	GetSnapshotText(ctx context.Context, studentID uuid.UUID) (string, error)
}

// LLMDispatcher — provider-agnostic один-shot chat call. Нам нужно ровно
// одно: «дай ответ на эти messages по этому task-kind». Полный
// llmchain.Chain даёт больше surface (streaming, vision и т.п.) — мы
// держим contract узким чтобы можно было тестировать UC через fake.
type LLMDispatcher interface {
	// Run — synchronous chat call. taskKind = persona.LLMTaskKind
	// (TaskAITutorChat / TaskAITutorCompact / TaskAITutorAssignment).
	// Возврат: текст ответа + tokens_in/out + использованная модель
	// (для записи в Episode.ModelUsed).
	Run(ctx context.Context, taskKind string, messages []LLMMessage, opts LLMOptions) (LLMResponse, error)
}

// LLMMessage — провайдер-нейтральный chat-turn. Mirror'ит llmchain.Message
// без тащения зависимости.
type LLMMessage struct {
	Role    string // 'system' | 'user' | 'assistant'
	Content string
}

// LLMOptions — необязательные параметры вызова.
type LLMOptions struct {
	Temperature float64
	MaxTokens   int
	JSONMode    bool
}

// LLMResponse — что вернулось.
type LLMResponse struct {
	Content   string
	TokensIn  int
	TokensOut int
	Model     string // 'groq:llama-3.3-70b-versatile' и т.п.
}
