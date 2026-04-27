package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// TogglePersona flips is_enabled.
type TogglePersona struct {
	Personas domain.PersonaRepo
}

// Do flips is_enabled and returns the refreshed row.
func (uc *TogglePersona) Do(ctx context.Context, id string) (domain.Persona, error) {
	out, err := uc.Personas.Toggle(ctx, id)
	if err != nil {
		return domain.Persona{}, fmt.Errorf("admin.TogglePersona: %w", err)
	}
	return out, nil
}
