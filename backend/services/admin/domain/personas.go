package domain

import "context"

// Persona mirrors a personas row.
type Persona struct {
	ID            string
	Label         string
	Hint          string
	IconEmoji     string
	BrandGradient string
	SuggestedTask string
	SystemPrompt  string
	SortOrder     int
	IsEnabled     bool
	CreatedAt     string
	UpdatedAt     string
}

// PersonaUpsert is the curator-supplied payload.
type PersonaUpsert struct {
	ID            string
	Label         string
	Hint          string
	IconEmoji     string
	BrandGradient string
	SuggestedTask string
	SystemPrompt  string
	SortOrder     *int
	IsEnabled     *bool
}

// PersonaRepo persists the personas table.
type PersonaRepo interface {
	List(ctx context.Context, enabledOnly bool) ([]Persona, error)
	Create(ctx context.Context, in PersonaUpsert) (Persona, error)
	Update(ctx context.Context, id string, in PersonaUpsert) (Persona, error)
	Toggle(ctx context.Context, id string) (Persona, error)
	Delete(ctx context.Context, id string) error
}
