// Package infra — per-deploy admin pin для coach-LLM. Пишется в
// `dynamic_config[coach.pinned_model]`. Если
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

// CoachReflectiveEnabledKey — dynamic_config row key.
//
// Когда true и computed severity ∈ {warn, critical}, brief synthesiser
// делает second LLM call с critique prompt и refined output подменяет
// исходный sketch. Default false — flag разворачивает админ через
// admin /llm-keys panel или прямым SQL update.
const CoachReflectiveEnabledKey = "coach.reflective_enabled"

// CoachPromptVariantKey — A/B prompt-variant gate.
//
//	"" / "default"  — стандартный briefSystemPrompt без overlay.
//	"terse"         — terser: shorter narrative, tighter rationales.
//	"sharp"         — sharper: один pin'd headline-claim в первой строке.
//
// Голосование за variant остаётся за админом: dynamic_config ставит
// одно значение → одно поведение для всех юзеров. Это не per-user
// experimentation, а evolutionary prompt-twist (можно сравнивать
// follow-rate по variant в admin dashboard).
const CoachPromptVariantKey = "coach.prompt_variant"

// CoachPromptVariant — typed wrapper. IsValid фильтрует unknown значения.
type CoachPromptVariant string

const (
	CoachPromptVariantDefault CoachPromptVariant = "default"
	CoachPromptVariantTerse   CoachPromptVariant = "terse"
	CoachPromptVariantSharp   CoachPromptVariant = "sharp"
)

// IsValid — true для known variants. Empty string также valid (= default).
func (v CoachPromptVariant) IsValid() bool {
	switch v {
	case "", CoachPromptVariantDefault, CoachPromptVariantTerse, CoachPromptVariantSharp:
		return true
	}
	return false
}

// CoachPersonaKey — dynamic_config row key.
//
// Persona — это tone-overlay поверх стандартного briefSystemPrompt:
//
//	"strict"   — direct, no hedging, holds high standards.
//	"warm"     — acknowledges effort, frames as learning.
//	"sparring" — challenges claims, treats user as peer who takes pushback.
//
// Пустая строка / unknown → tone overlay не применяется (default tone
// уже определён в briefSystemPrompt — анти-фланк, "honest, not nice").
const CoachPersonaKey = "coach.persona"

// CoachPersona — typed wrapper для допустимых значений. Caller использует
// IsValid() перед применением, чтобы случайный typo в dynamic_config не
// сломал prompt.
type CoachPersona string

const (
	CoachPersonaStrict   CoachPersona = "strict"
	CoachPersonaWarm     CoachPersona = "warm"
	CoachPersonaSparring CoachPersona = "sparring"
)

// IsValid — true для известных персон.
func (p CoachPersona) IsValid() bool {
	switch p {
	case CoachPersonaStrict, CoachPersonaWarm, CoachPersonaSparring:
		return true
	}
	return false
}

// CoachConfigReader — narrow port над dynamic_config для coach LLM pin.
// Реализация — DBCoachConfigReader; тесты могут подставлять свою.
type CoachConfigReader interface {
	// PinnedModel читает текущий pinned model. Пустая строка =
	// pin не задан, caller должен fall back на task-routing.
	// Не возвращает ошибок: любой fail (БД недоступна, config битый)
	// трактуется как «pin не задан» — не ломаем coach из-за config-issue.
	PinnedModel(ctx context.Context) string

	// ReflectiveEnabled — feature gate. Если true, severity warn/critical
	// триггерит second-stage critique LLM call. Cruise/nudge briefs идут
	// single-stage всегда (latency не оправдана для спокойных дней).
	// Fail-soft: любая ошибка чтения = false.
	ReflectiveEnabled(ctx context.Context) bool

	// Persona returns active tone overlay (strict / warm / sparring) или
	// пустую строку = no overlay. Невалидное значение в dynamic_config
	// трактуется как пустая строка (default tone из briefSystemPrompt не
	// меняется).
	Persona(ctx context.Context) CoachPersona

	// PromptVariant returns active prompt-variant (terse / sharp /
	// default). Empty / unknown → default = no overlay.
	PromptVariant(ctx context.Context) CoachPromptVariant
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

// PromptVariant читает coach.prompt_variant. Возвращает
// CoachPromptVariantDefault для пустого / unknown значения.
func (r *DBCoachConfigReader) PromptVariant(ctx context.Context) CoachPromptVariant {
	if r == nil || r.pool == nil {
		return CoachPromptVariantDefault
	}
	var raw string
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(value::text, '') FROM dynamic_config WHERE key = $1`,
		CoachPromptVariantKey,
	).Scan(&raw)
	if err != nil {
		return CoachPromptVariantDefault
	}
	if len(raw) >= 2 && raw[0] == '"' && raw[len(raw)-1] == '"' {
		raw = raw[1 : len(raw)-1]
	}
	v := CoachPromptVariant(raw)
	if !v.IsValid() || v == "" {
		return CoachPromptVariantDefault
	}
	return v
}

// Persona — читает coach.persona. Поддерживает оба формата хранения:
// JSON-string (`"strict"`) и raw-string (strict). Любой не-strict/warm/
// sparring → пустая строка (no overlay).
func (r *DBCoachConfigReader) Persona(ctx context.Context) CoachPersona {
	if r == nil || r.pool == nil {
		return ""
	}
	var raw string
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(value::text, '') FROM dynamic_config WHERE key = $1`,
		CoachPersonaKey,
	).Scan(&raw)
	if err != nil {
		return ""
	}
	// JSONB::text для строки даёт `"strict"` (с кавычками); снимаем их.
	if len(raw) >= 2 && raw[0] == '"' && raw[len(raw)-1] == '"' {
		raw = raw[1 : len(raw)-1]
	}
	p := CoachPersona(raw)
	if !p.IsValid() {
		return ""
	}
	return p
}

// ReflectiveEnabled — читает coach.reflective_enabled. Принимает
// JSON-bool (`true`/`false`) или JSON-string (`"true"`/`"on"`/`"1"`)
// чтобы admin'у не пришлось помнить точный формат при ручной правке.
func (r *DBCoachConfigReader) ReflectiveEnabled(ctx context.Context) bool {
	if r == nil || r.pool == nil {
		return false
	}
	var raw string
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(value::text, '') FROM dynamic_config WHERE key = $1`,
		CoachReflectiveEnabledKey,
	).Scan(&raw)
	if err != nil {
		return false
	}
	switch raw {
	case "true", "1", `"true"`, `"on"`, `"1"`, `"yes"`:
		return true
	}
	return false
}

// StaticCoachConfigReader — для тестов.
type StaticCoachConfigReader struct {
	Model              string
	Reflective         bool
	PersonaValue       CoachPersona
	PromptVariantValue CoachPromptVariant
}

// PinnedModel returns the static value.
func (s StaticCoachConfigReader) PinnedModel(_ context.Context) string {
	return s.Model
}

// ReflectiveEnabled returns the static toggle.
func (s StaticCoachConfigReader) ReflectiveEnabled(_ context.Context) bool {
	return s.Reflective
}

// Persona returns the static persona.
func (s StaticCoachConfigReader) Persona(_ context.Context) CoachPersona {
	return s.PersonaValue
}

// PromptVariant returns the static variant; empty value treated as default.
func (s StaticCoachConfigReader) PromptVariant(_ context.Context) CoachPromptVariant {
	if s.PromptVariantValue == "" {
		return CoachPromptVariantDefault
	}
	return s.PromptVariantValue
}
