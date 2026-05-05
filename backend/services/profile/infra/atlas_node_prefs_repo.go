// atlas_node_prefs_repo.go — Phase 3 per-user atlas overlay (table
// user_atlas_node_prefs, миграция 00064). Read-side only: SetAtlasNodePref
// RPC handler пишет напрямую через pool (см ports/atlas_pref_connect.go),
// чтобы не множить interfaces для тривиального upsert'а.
package infra

import (
	"context"
	"fmt"

	"druz9/profile/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AtlasNodePrefsPostgres struct {
	pool *pgxpool.Pool
}

func NewAtlasNodePrefsPostgres(pool *pgxpool.Pool) *AtlasNodePrefsPostgres {
	if pool == nil {
		panic("profile.NewAtlasNodePrefsPostgres: pool is required")
	}
	return &AtlasNodePrefsPostgres{pool: pool}
}

func (r *AtlasNodePrefsPostgres) ListByUser(ctx context.Context, userID string) ([]domain.AtlasNodePref, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT node_key, pinned, hidden
		   FROM user_atlas_node_prefs
		  WHERE user_id = $1`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("profile.AtlasNodePrefsPostgres.ListByUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AtlasNodePref, 0)
	for rows.Next() {
		var p domain.AtlasNodePref
		if err := rows.Scan(&p.NodeKey, &p.Pinned, &p.Hidden); err != nil {
			return nil, fmt.Errorf("profile.AtlasNodePrefsPostgres.ListByUser: scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.AtlasNodePrefsPostgres.ListByUser: rows: %w", err)
	}
	return out, nil
}

var _ domain.AtlasNodePrefsRepo = (*AtlasNodePrefsPostgres)(nil)
