// personas_repo.go — Postgres adapter for the personas table.
//
// SQL kept verbatim from cmd/monolith/services/admin/personas.go.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Personas is the persistence adapter for personas.
type Personas struct {
	pool *pgxpool.Pool
}

// NewPersonas wraps a pool.
func NewPersonas(pool *pgxpool.Pool) *Personas { return &Personas{pool: pool} }

const adminPersonaCols = `
	id, label, hint, icon_emoji, brand_gradient, suggested_task, system_prompt,
	sort_order, is_enabled,
	to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

func scanPersona(row pgx.Row) (domain.Persona, error) {
	var d domain.Persona
	err := row.Scan(
		&d.ID, &d.Label, &d.Hint, &d.IconEmoji, &d.BrandGradient,
		&d.SuggestedTask, &d.SystemPrompt, &d.SortOrder, &d.IsEnabled,
		&d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return d, fmt.Errorf("scan persona: %w", err)
	}
	return d, nil
}

// List returns personas. enabledOnly=true filters to is_enabled=TRUE.
func (p *Personas) List(ctx context.Context, enabledOnly bool) ([]domain.Persona, error) {
	q := `SELECT ` + adminPersonaCols + ` FROM personas ORDER BY sort_order ASC, id ASC`
	if enabledOnly {
		q = `SELECT ` + adminPersonaCols + ` FROM personas WHERE is_enabled = TRUE ORDER BY sort_order ASC, id ASC`
	}
	rows, err := p.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("admin.Personas.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Persona, 0, 8)
	for rows.Next() {
		row, err := scanPersona(rows)
		if err != nil {
			continue
		}
		out = append(out, row)
	}
	return out, nil
}

// Create inserts a persona.
func (p *Personas) Create(ctx context.Context, in domain.PersonaUpsert) (domain.Persona, error) {
	enabled := true
	if in.IsEnabled != nil {
		enabled = *in.IsEnabled
	}
	sort := 100
	if in.SortOrder != nil {
		sort = *in.SortOrder
	}
	row := p.pool.QueryRow(ctx, `
		INSERT INTO personas (
			id, label, hint, icon_emoji, brand_gradient, suggested_task, system_prompt,
			sort_order, is_enabled
		) VALUES ($1,$2,$3,COALESCE(NULLIF($4,''), '💬'),$5,$6,$7,$8,$9)
		RETURNING `+adminPersonaCols,
		in.ID, in.Label, in.Hint, in.IconEmoji, in.BrandGradient,
		in.SuggestedTask, in.SystemPrompt, sort, enabled)
	out, err := scanPersona(row)
	if err != nil {
		return domain.Persona{}, fmt.Errorf("admin.Personas.Create: %w", err)
	}
	return out, nil
}

// Update partially updates a persona by id.
func (p *Personas) Update(ctx context.Context, id string, in domain.PersonaUpsert) (domain.Persona, error) {
	row := p.pool.QueryRow(ctx, `
		UPDATE personas SET
		  label = COALESCE(NULLIF($2,''), label),
		  hint = COALESCE(NULLIF($3,''), hint),
		  icon_emoji = COALESCE(NULLIF($4,''), icon_emoji),
		  brand_gradient = COALESCE(NULLIF($5,''), brand_gradient),
		  suggested_task = COALESCE(NULLIF($6,''), suggested_task),
		  system_prompt = COALESCE(NULLIF($7,''), system_prompt),
		  sort_order = COALESCE($8, sort_order),
		  is_enabled = COALESCE($9, is_enabled),
		  updated_at = now()
		WHERE id = $1
		RETURNING `+adminPersonaCols,
		id, in.Label, in.Hint, in.IconEmoji, in.BrandGradient,
		in.SuggestedTask, in.SystemPrompt, in.SortOrder, in.IsEnabled)
	out, err := scanPersona(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Persona{}, domain.ErrNotFound
		}
		return domain.Persona{}, fmt.Errorf("admin.Personas.Update: %w", err)
	}
	return out, nil
}

// Toggle flips is_enabled.
func (p *Personas) Toggle(ctx context.Context, id string) (domain.Persona, error) {
	row := p.pool.QueryRow(ctx, `
		UPDATE personas SET is_enabled = NOT is_enabled, updated_at = now()
		WHERE id = $1
		RETURNING `+adminPersonaCols, id)
	out, err := scanPersona(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Persona{}, domain.ErrNotFound
		}
		return domain.Persona{}, fmt.Errorf("admin.Personas.Toggle: %w", err)
	}
	return out, nil
}

// Delete removes a persona.
func (p *Personas) Delete(ctx context.Context, id string) error {
	tag, err := p.pool.Exec(ctx, `DELETE FROM personas WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("admin.Personas.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

var _ domain.PersonaRepo = (*Personas)(nil)
