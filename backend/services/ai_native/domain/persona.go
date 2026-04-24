// persona.go — expert-mode preset for the desktop Copilot picker
// (migration 00051). Mirrors the LLMModel pattern so CRUD, wiring and
// admin UI can reuse the same conventions without per-entity quirks.
package domain

import (
	"context"
	"errors"
	"time"
)

// Persona is one row of the personas table. Fields map 1:1 onto the
// catalogue that used to be hardcoded in desktop/src/shared/personas.ts.
//
// "Default" persona is also a row (id='default', empty prefix) rather
// than a special-case constant — keeps the wire contract uniform and
// lets admins re-label the baseline if they want.
type Persona struct {
	ID            string
	Label         string
	Hint          string
	IconEmoji     string
	BrandGradient string
	// SuggestedTask is advisory — matches llmchain.Task constants.
	// Empty string means "let the caller choose". Kept as a free text
	// field rather than a typed enum here because the domain layer
	// shouldn't depend on the llmchain package; the desktop maps it
	// when routing calls.
	SuggestedTask string
	SystemPrompt  string
	SortOrder     int
	IsEnabled     bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// PersonaFilter narrows a List query. Zero value lists everything —
// admin console uses this to see disabled rows. Public callers always
// set OnlyEnabled=true.
type PersonaFilter struct {
	OnlyEnabled bool
}

// Sentinels returned by the Postgres repo. Admin handler maps them to
// HTTP 404 / 409 / 400 respectively.
var (
	ErrPersonaNotFound = errors.New("persona: not found")
	ErrPersonaConflict = errors.New("persona: id already exists")
	ErrPersonaInvalid  = errors.New("persona: invalid")
)

// PersonaRepo is the persistence contract. Hand-rolled pgx adapter
// lives in infra/postgres_personas.go. Small surface on purpose — we
// don't paginate (expected ≤ 30 rows ever) and don't bulk-import.
type PersonaRepo interface {
	List(ctx context.Context, f PersonaFilter) ([]Persona, error)
	GetByID(ctx context.Context, id string) (Persona, error)
	Create(ctx context.Context, p Persona) (Persona, error)
	Update(ctx context.Context, id string, p Persona) (Persona, error)
	Delete(ctx context.Context, id string) error
	SetEnabled(ctx context.Context, id string, enabled bool) error
}
