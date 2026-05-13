// Package infra — zero-knowledge vault persistence.
package infra

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/hone/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VaultRepoPG — Postgres impl of domain.VaultRepo.
type VaultRepoPG struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

// NewVaultRepo wraps pool + logger. log опционален.
func NewVaultRepo(pool *pgxpool.Pool, log *slog.Logger) *VaultRepoPG {
	if log == nil {
		log = slog.Default()
	}
	return &VaultRepoPG{pool: pool, log: log}
}

// EnsureSalt — atomic: WHERE … vault_kdf_salt IS NULL → set newSalt;
// если RowsAffected=0 → reread existing. Один TX, race-safe.
func (r *VaultRepoPG) EnsureSalt(ctx context.Context, userID uuid.UUID, newSalt []byte) ([]byte, bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("hone.VaultRepoPG.EnsureSalt: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cmd, err := tx.Exec(ctx,
		`UPDATE users SET vault_kdf_salt = $1
		  WHERE id = $2 AND vault_kdf_salt IS NULL`,
		newSalt, userID,
	)
	if err != nil {
		return nil, false, fmt.Errorf("hone.VaultRepoPG.EnsureSalt: update: %w", err)
	}

	var existing []byte
	wasInitialized := cmd.RowsAffected() == 0
	if wasInitialized {
		if qErr := tx.QueryRow(ctx,
			`SELECT vault_kdf_salt FROM users WHERE id = $1`, userID,
		).Scan(&existing); qErr != nil {
			return nil, false, fmt.Errorf("hone.VaultRepoPG.EnsureSalt: reread: %w", qErr)
		}
	} else {
		existing = newSalt
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("hone.VaultRepoPG.EnsureSalt: commit: %w", err)
	}
	return existing, wasInitialized, nil
}

// GetSalt — read-only. ErrNoRows → ErrNotFound; salt nil → возвращаем (nil, nil).
func (r *VaultRepoPG) GetSalt(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	var salt []byte
	err := r.pool.QueryRow(ctx,
		`SELECT vault_kdf_salt FROM users WHERE id = $1`, userID,
	).Scan(&salt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("hone.VaultRepoPG.GetSalt: %w", err)
	}
	return salt, nil
}

// EncryptNote — atomic: replace body, mark encrypted, wipe embedding,
// force-unpublish. RowsAffected=0 → ErrNotFound.
func (r *VaultRepoPG) EncryptNote(ctx context.Context, userID, noteID uuid.UUID, ciphertextB64 string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("hone.VaultRepoPG.EncryptNote: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cmd, err := tx.Exec(ctx,
		`UPDATE hone_notes
		    SET body_md       = $3,
		        size_bytes    = LENGTH($3),
		        encrypted     = TRUE,
		        embedding     = NULL,
		        embedding_model_id = NULL,
		        embedded_at   = NULL,
		        public_slug   = NULL,
		        published_at  = NULL,
		        updated_at    = now()
		  WHERE id = $1 AND user_id = $2`,
		noteID, userID, ciphertextB64,
	)
	if err != nil {
		return fmt.Errorf("hone.VaultRepoPG.EncryptNote: update: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("hone.VaultRepoPG.EncryptNote: commit: %w", err)
	}
	return nil
}

// DecryptNote — single UPDATE (без TX, decrypt не trigger'ит ничего secondary).
func (r *VaultRepoPG) DecryptNote(ctx context.Context, userID, noteID uuid.UUID, plaintextMD string) error {
	cmd, err := r.pool.Exec(ctx,
		`UPDATE hone_notes
		    SET body_md   = $3,
		        size_bytes = LENGTH($3),
		        encrypted = FALSE,
		        updated_at = now()
		  WHERE id = $1 AND user_id = $2`,
		noteID, userID, plaintextMD,
	)
	if err != nil {
		return fmt.Errorf("hone.VaultRepoPG.DecryptNote: update: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

var _ domain.VaultRepo = (*VaultRepoPG)(nil)
