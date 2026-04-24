// postgres_personas.go — hand-rolled pgx adapter for the personas
// registry (migration 00051). Mirrors postgres_models.go — same
// scanner pattern, same error mapping (pg 23505 → ErrPersonaConflict).
package infra

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"druz9/ai_native/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Personas is the persistence adapter for the personas table.
type Personas struct {
	pool *pgxpool.Pool
}

// NewPersonas wraps a pool. Caller passes the same pgxpool used by the
// rest of ai_native — no separate connection needed.
func NewPersonas(pool *pgxpool.Pool) *Personas {
	if pool == nil {
		panic("ai_native.infra.NewPersonas: pool is required")
	}
	return &Personas{pool: pool}
}

const personaColumns = `id, label, hint, icon_emoji, brand_gradient,
    suggested_task, system_prompt, sort_order, is_enabled,
    created_at, updated_at`

// List returns rows ordered by (sort_order, label) so picker UIs see a
// stable ordering. OnlyEnabled is a public-vs-admin gate.
func (r *Personas) List(ctx context.Context, f domain.PersonaFilter) ([]domain.Persona, error) {
	q := `SELECT ` + personaColumns + ` FROM personas WHERE 1=1`
	if f.OnlyEnabled {
		q += ` AND is_enabled = TRUE`
	}
	q += ` ORDER BY sort_order ASC, label ASC`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("ai_native.Personas.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.Persona, 0, 16)
	for rows.Next() {
		p, err := scanPersona(rows)
		if err != nil {
			return nil, fmt.Errorf("ai_native.Personas.List: scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai_native.Personas.List: rows: %w", err)
	}
	return out, nil
}

func (r *Personas) GetByID(ctx context.Context, id string) (domain.Persona, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.Persona{}, fmt.Errorf("ai_native.Personas.GetByID: %w: empty id", domain.ErrPersonaInvalid)
	}
	row := r.pool.QueryRow(ctx,
		`SELECT `+personaColumns+` FROM personas WHERE id = $1`,
		id,
	)
	p, err := scanPersona(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Persona{}, fmt.Errorf("ai_native.Personas.GetByID: %w", domain.ErrPersonaNotFound)
		}
		return domain.Persona{}, fmt.Errorf("ai_native.Personas.GetByID: %w", err)
	}
	return p, nil
}

// Create inserts a new row. Id must be unique; pg 23505 → ErrPersonaConflict
// so the HTTP layer can map to 409.
func (r *Personas) Create(ctx context.Context, p domain.Persona) (domain.Persona, error) {
	if err := validatePersona(p); err != nil {
		return domain.Persona{}, fmt.Errorf("ai_native.Personas.Create: %w", err)
	}
	row := r.pool.QueryRow(ctx,
		`INSERT INTO personas (
            id, label, hint, icon_emoji, brand_gradient,
            suggested_task, system_prompt, sort_order, is_enabled
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING `+personaColumns,
		p.ID, p.Label, p.Hint, p.IconEmoji, p.BrandGradient,
		p.SuggestedTask, p.SystemPrompt, p.SortOrder, p.IsEnabled,
	)
	out, err := scanPersona(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.Persona{}, fmt.Errorf("ai_native.Personas.Create: %w", domain.ErrPersonaConflict)
		}
		return domain.Persona{}, fmt.Errorf("ai_native.Personas.Create: %w", err)
	}
	return out, nil
}

// Update overwrites every editable column. The id in the path is the
// lookup key; the p.ID may be a rename (we allow it — admin may want
// to slug-rename a persona once the user-facing label changes).
func (r *Personas) Update(ctx context.Context, id string, p domain.Persona) (domain.Persona, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return domain.Persona{}, fmt.Errorf("ai_native.Personas.Update: %w: empty id", domain.ErrPersonaInvalid)
	}
	if err := validatePersona(p); err != nil {
		return domain.Persona{}, fmt.Errorf("ai_native.Personas.Update: %w", err)
	}
	row := r.pool.QueryRow(ctx,
		`UPDATE personas SET
             id = $1, label = $2, hint = $3, icon_emoji = $4,
             brand_gradient = $5, suggested_task = $6,
             system_prompt = $7, sort_order = $8, is_enabled = $9,
             updated_at = now()
         WHERE id = $10
         RETURNING `+personaColumns,
		p.ID, p.Label, p.Hint, p.IconEmoji, p.BrandGradient,
		p.SuggestedTask, p.SystemPrompt, p.SortOrder, p.IsEnabled, id,
	)
	out, err := scanPersona(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Persona{}, fmt.Errorf("ai_native.Personas.Update: %w", domain.ErrPersonaNotFound)
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.Persona{}, fmt.Errorf("ai_native.Personas.Update: %w", domain.ErrPersonaConflict)
		}
		return domain.Persona{}, fmt.Errorf("ai_native.Personas.Update: %w", err)
	}
	return out, nil
}

func (r *Personas) Delete(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("ai_native.Personas.Delete: %w: empty id", domain.ErrPersonaInvalid)
	}
	tag, err := r.pool.Exec(ctx, `DELETE FROM personas WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("ai_native.Personas.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("ai_native.Personas.Delete: %w", domain.ErrPersonaNotFound)
	}
	return nil
}

func (r *Personas) SetEnabled(ctx context.Context, id string, enabled bool) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("ai_native.Personas.SetEnabled: %w: empty id", domain.ErrPersonaInvalid)
	}
	tag, err := r.pool.Exec(ctx,
		`UPDATE personas SET is_enabled = $1, updated_at = now() WHERE id = $2`,
		enabled, id,
	)
	if err != nil {
		return fmt.Errorf("ai_native.Personas.SetEnabled: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("ai_native.Personas.SetEnabled: %w", domain.ErrPersonaNotFound)
	}
	return nil
}

type personaScanner interface {
	Scan(dest ...any) error
}

func scanPersona(s personaScanner) (domain.Persona, error) {
	var p domain.Persona
	if err := s.Scan(
		&p.ID, &p.Label, &p.Hint, &p.IconEmoji, &p.BrandGradient,
		&p.SuggestedTask, &p.SystemPrompt, &p.SortOrder, &p.IsEnabled,
		&p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		return domain.Persona{}, fmt.Errorf("ai_native.scanPersona: %w", err)
	}
	return p, nil
}

// validatePersona enforces what the table also requires (id and label
// non-empty). Done in Go too so HTTP returns 400 with a readable
// message instead of a generic 500 from Postgres.
func validatePersona(p domain.Persona) error {
	if strings.TrimSpace(p.ID) == "" {
		return fmt.Errorf("%w: id is required", domain.ErrPersonaInvalid)
	}
	if strings.TrimSpace(p.Label) == "" {
		return fmt.Errorf("%w: label is required", domain.ErrPersonaInvalid)
	}
	return nil
}

// Interface guard.
var _ domain.PersonaRepo = (*Personas)(nil)
