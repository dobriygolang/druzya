// llm_model.go — domain entity + repository contract for the
// admin-editable LLM model registry (migration 00033).
//
// Replaces the hardcoded enums.LLMModel + canonicalModels() pair: every
// AI-feature consumer (Arena AI opponent, Weekly Insight, Mock LLM)
// now reads its picker / default from this registry so admins can add a
// new OpenRouter id without a code deploy.
//
// Anti-fallback policy: when the registry is empty, callers MUST treat
// the catalogue as empty (frontend hides the picker, server falls back
// to "AI features disabled"). We deliberately do NOT inject a hidden
// default set here — see migration 00033 for the seeded baseline.
package domain

import (
	"context"
	"errors"
	"time"
)

// LLMModelTier is the gate string stored in llm_models.tier.
type LLMModelTier string

const (
	LLMModelTierFree    LLMModelTier = "free"
	LLMModelTierPremium LLMModelTier = "premium"
)

// IsValid reports whether the value matches one of the table's
// CHECK-constraint strings.
func (t LLMModelTier) IsValid() bool {
	switch t {
	case LLMModelTierFree, LLMModelTierPremium:
		return true
	}
	return false
}

// LLMModelUse selects which feature surface a model is enabled for.
// Mirrors the use_for_* boolean columns. Used by the GET /ai/models
// query parameter `?use=arena|insight|mock`.
type LLMModelUse string

const (
	LLMModelUseArena     LLMModelUse = "arena"
	LLMModelUseInsight   LLMModelUse = "insight"
	LLMModelUseMock      LLMModelUse = "mock"
	LLMModelUseVacancies LLMModelUse = "vacancies"
)

// IsValid reports whether the value matches a known use string.
func (u LLMModelUse) IsValid() bool {
	switch u {
	case LLMModelUseArena, LLMModelUseInsight, LLMModelUseMock, LLMModelUseVacancies:
		return true
	}
	return false
}

// LLMModel is one row of the llm_models table.
//
// CostPer1KInputUSD / CostPer1KOutputUSD are pointers because the column
// is NULL-able — admin may seed a model whose pricing isn't published
// yet; the catalogue must still render. Same applies to ContextWindow.
// ProviderID — routing identity for the llmchain package ("groq" /
// "cerebras" / "mistral" / "openrouter" / "druz9" for virtual). Redundant
// with the "<prefix>/<rest>" shape of ModelID for real models, but stored
// explicitly so admin UI / backend dispatch don't rely on prefix parsing.
// Added in migration 00046.
//
// IsVirtual — marks llmchain pseudo-models (today only "druz9/turbo").
// UI treats virtual rows specially (⚡ badge, "Авто-роутинг" label); admin
// CMS hides the wire-format editor because the id is a contract, not a
// config value. Added in migration 00046.
type LLMModel struct {
	ID                 int64
	ModelID            string
	Label              string
	Provider           string
	ProviderID         string
	IsVirtual          bool
	Tier               LLMModelTier
	IsEnabled          bool
	ContextWindow      *int
	CostPer1KInputUSD  *float64
	CostPer1KOutputUSD *float64
	UseForArena        bool
	UseForInsight      bool
	UseForMock         bool
	UseForVacancies    bool
	SortOrder          int
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// IsPremium mirrors the legacy enums.LLMModel.IsPremium() check so
// callers gating premium-only models can keep the same conditional.
func (m LLMModel) IsPremium() bool { return m.Tier == LLMModelTierPremium }

// LLMModelFilter narrows a List query. Zero value lists everything.
type LLMModelFilter struct {
	// OnlyEnabled excludes is_enabled=false rows. Public callers must
	// always set this; admin callers leave it false to see disabled
	// rows for management.
	OnlyEnabled bool
	// Use restricts to a feature surface. Empty means "any".
	Use LLMModelUse
}

// ErrLLMModelNotFound is returned when GetByID / Update / Delete cannot
// locate a row by its model_id.
var ErrLLMModelNotFound = errors.New("llm_model: not found")

// ErrLLMModelConflict is returned when Create encounters a duplicate
// model_id (UNIQUE violation).
var ErrLLMModelConflict = errors.New("llm_model: model_id already exists")

// ErrLLMModelInvalid is returned for validation failures (empty
// model_id, unknown tier, etc.) before the SQL ever runs.
var ErrLLMModelInvalid = errors.New("llm_model: invalid")

// LLMModelRepo persists llm_models rows. Hand-rolled pgx adapter lives
// in infra/postgres_models.go.
type LLMModelRepo interface {
	List(ctx context.Context, f LLMModelFilter) ([]LLMModel, error)
	GetByID(ctx context.Context, modelID string) (LLMModel, error)
	Create(ctx context.Context, m LLMModel) (LLMModel, error)
	Update(ctx context.Context, modelID string, m LLMModel) (LLMModel, error)
	Delete(ctx context.Context, modelID string) error
	SetEnabled(ctx context.Context, modelID string, enabled bool) error
}
