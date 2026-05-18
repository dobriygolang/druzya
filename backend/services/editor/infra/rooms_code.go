package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/editor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// GetCode returns the saved code blob for a solo editor room. Empty string
// is a valid value (fresh rooms) — only missing rooms surface ErrNotFound.
func (r *Rooms) GetCode(ctx context.Context, id uuid.UUID) (string, error) {
	var code string
	err := r.pool.QueryRow(ctx,
		`SELECT code FROM editor_rooms WHERE id = $1`,
		id,
	).Scan(&code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", domain.ErrNotFound
		}
		return "", fmt.Errorf("editor.Rooms.GetCode: %w", err)
	}
	return code, nil
}

// SaveCode upserts the code TEXT column for a solo editor room. Caller is
// responsible for owner-check before calling this — repo layer just writes.
func (r *Rooms) SaveCode(ctx context.Context, id uuid.UUID, code string) error {
	tag, err := r.pool.Exec(ctx,
		`UPDATE editor_rooms SET code = $2 WHERE id = $1`,
		id, code,
	)
	if err != nil {
		return fmt.Errorf("editor.Rooms.SaveCode: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
