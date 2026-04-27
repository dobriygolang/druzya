// dyn_config_repo.go — Postgres implementation of subApp.ConfigReader.
//
// Reads from `dynamic_config` (table owned by the admin domain). Cross-domain
// seam: subscription does NOT import admin/infra to avoid the cycle. Row-
// missing → empty string + nil error so the policy resolver fallback'ает на
// hardcoded defaults без шума в логах.
package infra

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DynConfigRepo reads dynamic_config rows by key.
type DynConfigRepo struct {
	pool *pgxpool.Pool
}

// NewDynConfigRepo wraps a pool.
func NewDynConfigRepo(pool *pgxpool.Pool) *DynConfigRepo {
	return &DynConfigRepo{pool: pool}
}

// GetConfig returns the raw value for the given key, or "" + nil when the
// row is absent.
func (r *DynConfigRepo) GetConfig(ctx context.Context, key string) (string, error) {
	const q = `SELECT value FROM dynamic_config WHERE key = $1`
	var raw string
	if err := r.pool.QueryRow(ctx, q, key).Scan(&raw); err != nil {
		// Row missing → empty string + nil error. Resolver fallback'ает на
		// hardcoded defaults в этом случае.
		return "", nil
	}
	return raw, nil
}
