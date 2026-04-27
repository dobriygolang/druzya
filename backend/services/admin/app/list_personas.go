package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// ListPersonas serves both the public read (enabledOnly=true) and the
// admin listing (enabledOnly=false).
type ListPersonas struct {
	Personas domain.PersonaRepo
}

// Do returns personas.
func (uc *ListPersonas) Do(ctx context.Context, enabledOnly bool) ([]domain.Persona, error) {
	out, err := uc.Personas.List(ctx, enabledOnly)
	if err != nil {
		return nil, fmt.Errorf("admin.ListPersonas: %w", err)
	}
	return out, nil
}
