package app

import (
	"context"
	"fmt"

	"druz9/admin/domain"
)

// DeletePersona removes a persona row.
type DeletePersona struct {
	Personas domain.PersonaRepo
}

// Do removes the row.
func (uc *DeletePersona) Do(ctx context.Context, id string) error {
	if err := uc.Personas.Delete(ctx, id); err != nil {
		return fmt.Errorf("admin.DeletePersona: %w", err)
	}
	return nil
}
