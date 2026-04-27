package app

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"
)

// CreatePersona inserts a persona.
type CreatePersona struct {
	Personas domain.PersonaRepo
}

// Do validates required fields and inserts.
func (uc *CreatePersona) Do(ctx context.Context, in domain.PersonaUpsert) (domain.Persona, error) {
	if in.ID == "" || in.Label == "" {
		return domain.Persona{}, fmt.Errorf("admin.CreatePersona: %w: %w",
			domain.ErrInvalidInput,
			errors.New("id and label required"))
	}
	out, err := uc.Personas.Create(ctx, in)
	if err != nil {
		return domain.Persona{}, fmt.Errorf("admin.CreatePersona: %w", err)
	}
	return out, nil
}
