package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
)

// UpdatePersona partially updates a persona.
type UpdatePersona struct {
	Personas domain.PersonaRepo
}

// Do updates the persona identified by id.
func (uc *UpdatePersona) Do(ctx context.Context, id string, in domain.PersonaUpsert) (domain.Persona, error) {
	if id == "" {
		return domain.Persona{}, fmt.Errorf("admin.UpdatePersona: %w: %w",
			domain.ErrInvalidInput,
			errors.New("id required"))
	}
	out, err := uc.Personas.Update(ctx, id, in)
	if err != nil {
		return domain.Persona{}, fmt.Errorf("admin.UpdatePersona: %w", err)
	}
	return out, nil
}
