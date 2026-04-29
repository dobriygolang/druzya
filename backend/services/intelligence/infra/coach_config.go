// coach_config.go — Phase III context-preservation: per-deploy admin pin
// для coach-LLM. Пишется в `dynamic_config[coach.pinned_model]`. Если
// задан — DailyBrief synthesizer + AskNotes answerer используют его как
// ModelOverride (single candidate, no fallback). Это даёт стилистическую
// стабильность коуча между запросами: один и тот же tone/voice пока
// admin не сменит модель явно.
//
// Пустая строка / отсутствующая row / parse error → fail-soft через
// task-routing (ModelOverride пустой → chain выбирает по TaskDailyBrief
// / TaskNoteQA из task_map). Это сохраняет старое поведение в чистом
// окружении без admin-конфига.
package infra

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CoachPinnedModelKey — dynamic_config row key.
const CoachPinnedModelKey = "coach.pinned_model"

// CoachConfigReader — narrow port над dynamic_config для coach LLM pin.
// Реализация — DBCoachConfigReader; тесты могут подставлять свою.
type CoachConfigReader interface {
	// PinnedModel читает текущий pinned model. Пустая строка =
	// pin не задан, caller должен fall back на task-routing.
	// Не возвращает ошибок: любой fail (БД недоступна, config битый)
	// трактуется как «pin не задан» — не ломаем coach из-за config-issue.
	PinnedModel(ctx context.Context) string
}

// DBCoachConfigReader читает из dynamic_config. Безопасен при nil-pool
// (отдаёт "" — fail-soft).
type DBCoachConfigReader struct {
	pool *pgxpool.Pool
}

// NewDBCoachConfigReader wraps a pool.
func NewDBCoachConfigReader(pool *pgxpool.Pool) *DBCoachConfigReader {
	return &DBCoachConfigReader{pool: pool}
}

// PinnedModel — читает coach.pinned_model. Никогда не панится.
func (r *DBCoachConfigReader) PinnedModel(ctx context.Context) string {
	if r == nil || r.pool == nil {
		return ""
	}
	var raw string
	// dynamic_config.value хранится как JSONB; для простой строки
	// формат — JSON-строка ("openai/gpt-4o"), значит unmarshal через
	// pgx Scan в string не работает. Используем COALESCE + ::text +
	// trim quotes для зеркальной совместимости с whatever admin писал.
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(value::text, '') FROM dynamic_config WHERE key = $1`,
		CoachPinnedModelKey,
	).Scan(&raw)
	if err != nil {
		return ""
	}
	// JSONB::text для строки даёт `"openai/gpt-4o"` (с кавычками).
	// Снимаем их; для других форматов (число, объект) возвращаем "".
	if len(raw) >= 2 && raw[0] == '"' && raw[len(raw)-1] == '"' {
		return raw[1 : len(raw)-1]
	}
	return ""
}

// StaticCoachConfigReader — для тестов.
type StaticCoachConfigReader struct {
	Model string
}

// PinnedModel returns the static value.
func (s StaticCoachConfigReader) PinnedModel(_ context.Context) string {
	return s.Model
}
