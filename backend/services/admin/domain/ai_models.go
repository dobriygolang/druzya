package domain

import "context"

// AIModel mirrors a row in the llm_models catalogue (admin write
// projection). Timestamps stay as strings — they are formatted at the SQL
// boundary (to_char) and surfaced verbatim through the API.
type AIModel struct {
	ID                int64
	ModelID           string
	Label             string
	Provider          string
	Tier              string
	IsEnabled         bool
	ContextWindow     *int
	CostPerKInputUSD  *float64
	CostPerKOutputUSD *float64
	// UseForArena removed 2026-05-12 (D8) — see migration 00088.
	UseForInsight     bool
	UseForMock        bool
	SortOrder         int
	CreatedAt         string
	UpdatedAt         string
}

// AIModelUpsert is the curator-supplied payload for create / update.
// Fields that are pointers (*bool, *int, …) are tri-state — nil means
// "leave unchanged" on update / "use the default" on create.
type AIModelUpsert struct {
	ModelID           string
	Label             string
	Provider          string
	Tier              string
	IsEnabled         *bool
	ContextWindow     *int
	CostPerKInputUSD  *float64
	CostPerKOutputUSD *float64
	// UseForArena removed 2026-05-12 (D8).
	UseForInsight     *bool
	UseForMock        *bool
	SortOrder         *int
}

// PublicAIModel is the read-through projection used by the public
// /ai/models catalogue endpoint.
type PublicAIModel struct {
	ID        string
	Label     string
	Provider  string
	Tier      string
	Available bool
	IsVirtual bool
}

// PublicAIModelFilter narrows the public listing by use-surface
// (arena / insight / mock / vacancies). Empty Surface = no filter.
type PublicAIModelFilter struct {
	Surface string
}

// AIModelRepo persists llm_models rows for the admin write surface and
// also serves the public catalogue read.
type AIModelRepo interface {
	List(ctx context.Context) ([]AIModel, error)
	Create(ctx context.Context, in AIModelUpsert) (AIModel, error)
	Update(ctx context.Context, modelID string, in AIModelUpsert) (AIModel, error)
	Toggle(ctx context.Context, modelID string) (AIModel, error)
	Delete(ctx context.Context, modelID string) error

	ListPublic(ctx context.Context, f PublicAIModelFilter) ([]PublicAIModel, error)
}
