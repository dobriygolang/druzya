// user_atlas_repo.go — pgx-based impl of domain.UserAtlasRepo.
//
// Tiny CRUD on user_atlas_nodes (migration 00044). Hand-rolled SQL —
// see atlas_catalogue.go header for the rationale (no sqlc regen for
// auxiliary tables).
package infra

import (
	"context"
	"fmt"

	"druz9/profile/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type UserAtlasPostgres struct {
	pool *pgxpool.Pool
}

func NewUserAtlasPostgres(pool *pgxpool.Pool) *UserAtlasPostgres {
	if pool == nil {
		panic("profile.NewUserAtlasPostgres: pool is required (anti-fallback)")
	}
	return &UserAtlasPostgres{pool: pool}
}

func (r *UserAtlasPostgres) ListByUser(ctx context.Context, userID string) ([]domain.UserAtlasNode, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT node_key, title, description, section, kind, cluster, source_text, created_at
		FROM user_atlas_nodes
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("profile.UserAtlasPostgres.ListByUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.UserAtlasNode, 0)
	for rows.Next() {
		var n domain.UserAtlasNode
		if err := rows.Scan(&n.NodeKey, &n.Title, &n.Description, &n.Section, &n.Kind, &n.Cluster, &n.SourceText, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("profile.UserAtlasPostgres.ListByUser: scan: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.UserAtlasPostgres.ListByUser: rows: %w", err)
	}
	return out, nil
}

func (r *UserAtlasPostgres) UpsertNode(ctx context.Context, userID string, n domain.UserAtlasNode) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_atlas_nodes
			(user_id, node_key, title, description, section, kind, cluster, source_text)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id, node_key) DO UPDATE
			SET title       = EXCLUDED.title,
			    description = EXCLUDED.description,
			    section     = EXCLUDED.section,
			    kind        = EXCLUDED.kind,
			    cluster     = EXCLUDED.cluster,
			    source_text = EXCLUDED.source_text
	`, userID, n.NodeKey, n.Title, n.Description, n.Section, n.Kind, n.Cluster, n.SourceText)
	if err != nil {
		return fmt.Errorf("profile.UserAtlasPostgres.UpsertNode: %w", err)
	}
	return nil
}

func (r *UserAtlasPostgres) DeleteNode(ctx context.Context, userID, nodeKey string) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM user_atlas_nodes
		WHERE user_id = $1 AND node_key = $2
	`, userID, nodeKey)
	if err != nil {
		return fmt.Errorf("profile.UserAtlasPostgres.DeleteNode: %w", err)
	}
	return nil
}
