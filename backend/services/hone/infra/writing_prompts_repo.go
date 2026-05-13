// writing_prompts_repo.go — Phase K Wave 11 (2026-05-13)
//
// Postgres impl of domain.WritingPromptRepo. Sibling of speaking_repo.go;
// same hand-rolled pgx pattern.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/hone/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WritingPromptRepoPG — Postgres impl. Reads + writes writing_prompts.
type WritingPromptRepoPG struct {
	pool *pgxpool.Pool
}

// NewWritingPromptRepo constructs the repo.
func NewWritingPromptRepo(pool *pgxpool.Pool) *WritingPromptRepoPG {
	return &WritingPromptRepoPG{pool: pool}
}

// List active (non-archived) rows. Empty level = all.
func (r *WritingPromptRepoPG) List(ctx context.Context, level domain.WritingPromptLevel) ([]domain.WritingPrompt, error) {
	var rows pgx.Rows
	var err error
	if level == "" {
		const q = `
			SELECT id, level, topic, prompt, rubric_md, created_at, updated_at
			FROM writing_prompts
			WHERE archived_at IS NULL
			ORDER BY level ASC, id ASC`
		rows, err = r.pool.Query(ctx, q)
	} else {
		const q = `
			SELECT id, level, topic, prompt, rubric_md, created_at, updated_at
			FROM writing_prompts
			WHERE archived_at IS NULL AND level = $1
			ORDER BY id ASC`
		rows, err = r.pool.Query(ctx, q, string(level))
	}
	if err != nil {
		return nil, fmt.Errorf("hone.ListWritingPrompts: %w", err)
	}
	defer rows.Close()

	out := make([]domain.WritingPrompt, 0, 16)
	for rows.Next() {
		var p domain.WritingPrompt
		var lvl string
		var createdAt, updatedAt pgtype.Timestamptz
		if err := rows.Scan(&p.ID, &lvl, &p.Topic, &p.Prompt, &p.RubricMD, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.ListWritingPrompts: scan: %w", err)
		}
		p.Level = domain.WritingPromptLevel(lvl)
		if createdAt.Valid {
			p.CreatedAt = createdAt.Time
		}
		if updatedAt.Valid {
			p.UpdatedAt = updatedAt.Time
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.ListWritingPrompts: rows: %w", err)
	}
	return out, nil
}

// Add inserts. PK conflict ⇒ ErrAlreadyExists (use case maps to 409).
func (r *WritingPromptRepoPG) Add(ctx context.Context, p domain.WritingPrompt) (domain.WritingPrompt, error) {
	const q = `
		INSERT INTO writing_prompts (id, level, topic, prompt, rubric_md)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING created_at, updated_at`
	var createdAt, updatedAt pgtype.Timestamptz
	err := r.pool.QueryRow(ctx, q, p.ID, string(p.Level), p.Topic, p.Prompt, p.RubricMD).
		Scan(&createdAt, &updatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" { // unique_violation
			return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: %w", domain.ErrAlreadyExists)
		}
		return domain.WritingPrompt{}, fmt.Errorf("hone.AddWritingPrompt: %w", err)
	}
	if createdAt.Valid {
		p.CreatedAt = createdAt.Time
	}
	if updatedAt.Valid {
		p.UpdatedAt = updatedAt.Time
	}
	return p, nil
}

// Archive flips archived_at to NOW(). One-way. ErrNotFound when id
// absent or already archived (admin can't double-archive).
func (r *WritingPromptRepoPG) Archive(ctx context.Context, id string) error {
	const q = `
		UPDATE writing_prompts
		SET archived_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND archived_at IS NULL`
	tag, err := r.pool.Exec(ctx, q, id)
	if err != nil {
		return fmt.Errorf("hone.ArchiveWritingPrompt: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("hone.ArchiveWritingPrompt: %w", domain.ErrNotFound)
	}
	return nil
}
