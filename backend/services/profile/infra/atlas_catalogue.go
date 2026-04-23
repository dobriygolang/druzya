// atlas_catalogue.go — admin-editable atlas (nodes + edges).
//
// Hand-rolled SQL on top of pgxpool — adding a tiny CRUD surface
// through sqlc would force a regen of the whole profile package for
// one auxiliary table. The queries are short and tested through the
// admin handler integration, so the trade-off favours speed.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/profile/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AtlasCataloguePostgres implements domain.AtlasCatalogueRepo.
type AtlasCataloguePostgres struct {
	pool *pgxpool.Pool
}

// NewAtlasCataloguePostgres wires the repo around a pgxpool.
func NewAtlasCataloguePostgres(pool *pgxpool.Pool) *AtlasCataloguePostgres {
	if pool == nil {
		panic("profile.NewAtlasCataloguePostgres: pool is required (anti-fallback)")
	}
	return &AtlasCataloguePostgres{pool: pool}
}

// ListNodes returns every active node (admin sees inactive too — see
// ListAllNodes). Used by the public /profile/me/atlas read path.
func (r *AtlasCataloguePostgres) ListNodes(ctx context.Context) ([]domain.AtlasCatalogueNode, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, title, section, kind, cluster, description, total_count,
		       pos_x, pos_y, sort_order, is_active
		FROM atlas_nodes
		WHERE is_active = TRUE
		ORDER BY sort_order, id
	`)
	if err != nil {
		return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListNodes: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AtlasCatalogueNode, 0, 16)
	for rows.Next() {
		n, err := scanAtlasNode(rows)
		if err != nil {
			return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListNodes: scan: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListNodes: rows: %w", err)
	}
	return out, nil
}

// ListAllNodes returns every node, including inactive ones — admin UI.
func (r *AtlasCataloguePostgres) ListAllNodes(ctx context.Context) ([]domain.AtlasCatalogueNode, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, title, section, kind, cluster, description, total_count,
		       pos_x, pos_y, sort_order, is_active
		FROM atlas_nodes
		ORDER BY sort_order, id
	`)
	if err != nil {
		return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListAllNodes: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AtlasCatalogueNode, 0, 16)
	for rows.Next() {
		n, err := scanAtlasNode(rows)
		if err != nil {
			return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListAllNodes: scan: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListAllNodes: rows: %w", err)
	}
	return out, nil
}

// GetNode loads a single node by id; ErrNotFound when absent.
func (r *AtlasCataloguePostgres) GetNode(ctx context.Context, id string) (domain.AtlasCatalogueNode, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, title, section, kind, cluster, description, total_count,
		       pos_x, pos_y, sort_order, is_active
		FROM atlas_nodes
		WHERE id = $1
	`, id)
	n, err := scanAtlasNode(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.AtlasCatalogueNode{}, fmt.Errorf("profile.AtlasCataloguePostgres.GetNode: %w", domain.ErrNotFound)
		}
		return domain.AtlasCatalogueNode{}, fmt.Errorf("profile.AtlasCataloguePostgres.GetNode: %w", err)
	}
	return n, nil
}

// UpsertNode inserts or fully overwrites a node. id must be non-empty.
func (r *AtlasCataloguePostgres) UpsertNode(ctx context.Context, n domain.AtlasCatalogueNode) error {
	if n.ID == "" {
		return fmt.Errorf("profile.AtlasCataloguePostgres.UpsertNode: id required")
	}
	var posX, posY any
	if n.PosX != nil {
		posX = *n.PosX
	}
	if n.PosY != nil {
		posY = *n.PosY
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO atlas_nodes
		    (id, title, section, kind, cluster, description, total_count, pos_x, pos_y, sort_order, is_active, updated_at)
		VALUES
		    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
		ON CONFLICT (id) DO UPDATE SET
		    title = EXCLUDED.title,
		    section = EXCLUDED.section,
		    kind = EXCLUDED.kind,
		    cluster = EXCLUDED.cluster,
		    description = EXCLUDED.description,
		    total_count = EXCLUDED.total_count,
		    pos_x = EXCLUDED.pos_x,
		    pos_y = EXCLUDED.pos_y,
		    sort_order = EXCLUDED.sort_order,
		    is_active = EXCLUDED.is_active,
		    updated_at = now()
	`, n.ID, n.Title, n.Section, n.Kind, n.Cluster, n.Description, n.TotalCount, posX, posY, n.SortOrder, n.IsActive)
	if err != nil {
		return fmt.Errorf("profile.AtlasCataloguePostgres.UpsertNode: %w", err)
	}
	return nil
}

// UpdateNodePosition writes only pos_x/pos_y (NULL clears).
func (r *AtlasCataloguePostgres) UpdateNodePosition(ctx context.Context, id string, posX, posY *int) error {
	var px, py any
	if posX != nil {
		px = *posX
	}
	if posY != nil {
		py = *posY
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE atlas_nodes
		SET pos_x = $2, pos_y = $3, updated_at = now()
		WHERE id = $1
	`, id, px, py)
	if err != nil {
		return fmt.Errorf("profile.AtlasCataloguePostgres.UpdateNodePosition: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("profile.AtlasCataloguePostgres.UpdateNodePosition: %w", domain.ErrNotFound)
	}
	return nil
}

// DeleteNode hard-deletes a node and CASCADEs its edges.
func (r *AtlasCataloguePostgres) DeleteNode(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM atlas_nodes WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("profile.AtlasCataloguePostgres.DeleteNode: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("profile.AtlasCataloguePostgres.DeleteNode: %w", domain.ErrNotFound)
	}
	return nil
}

// CountEdgesFor returns the number of edges attached to id (either side).
// Used by admin UI to warn the operator before a CASCADE delete.
func (r *AtlasCataloguePostgres) CountEdgesFor(ctx context.Context, id string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM atlas_edges WHERE from_id = $1 OR to_id = $1
	`, id).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("profile.AtlasCataloguePostgres.CountEdgesFor: %w", err)
	}
	return n, nil
}

// ListEdges returns every edge (both directions are stored verbatim;
// the read path treats edges as undirected by symmetry in BFS).
func (r *AtlasCataloguePostgres) ListEdges(ctx context.Context) ([]domain.AtlasCatalogueEdge, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, from_id, to_id, kind FROM atlas_edges ORDER BY id
	`)
	if err != nil {
		return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListEdges: %w", err)
	}
	defer rows.Close()
	out := make([]domain.AtlasCatalogueEdge, 0, 16)
	for rows.Next() {
		var e domain.AtlasCatalogueEdge
		if err := rows.Scan(&e.ID, &e.From, &e.To, &e.Kind); err != nil {
			return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListEdges: scan: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile.AtlasCataloguePostgres.ListEdges: rows: %w", err)
	}
	return out, nil
}

// CreateEdge inserts (from, to). Returns the new id. Duplicates are
// rejected by the UNIQUE(from_id, to_id) constraint, which we surface
// as a domain.ErrConflict for the admin handler to map to 409.
func (r *AtlasCataloguePostgres) CreateEdge(ctx context.Context, from, to, kind string) (int64, error) {
	if from == "" || to == "" {
		return 0, fmt.Errorf("profile.AtlasCataloguePostgres.CreateEdge: from and to required")
	}
	if from == to {
		return 0, fmt.Errorf("profile.AtlasCataloguePostgres.CreateEdge: self-edge not allowed")
	}
	switch kind {
	case "prereq", "suggested", "crosslink":
	case "":
		kind = "prereq" // default — preserves Wave-9 semantics for callers that don't pass kind yet
	default:
		return 0, fmt.Errorf("profile.AtlasCataloguePostgres.CreateEdge: invalid kind %q", kind)
	}
	var id int64
	err := r.pool.QueryRow(ctx, `
		INSERT INTO atlas_edges (from_id, to_id, kind)
		VALUES ($1, $2, $3)
		RETURNING id
	`, from, to, kind).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("profile.AtlasCataloguePostgres.CreateEdge: %w", err)
	}
	return id, nil
}

// DeleteEdge removes an edge by primary key.
func (r *AtlasCataloguePostgres) DeleteEdge(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM atlas_edges WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("profile.AtlasCataloguePostgres.DeleteEdge: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("profile.AtlasCataloguePostgres.DeleteEdge: %w", domain.ErrNotFound)
	}
	return nil
}

// scanner is the small interface satisfied by *pgx.Row and pgx.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanAtlasNode(s scanner) (domain.AtlasCatalogueNode, error) {
	var n domain.AtlasCatalogueNode
	var posX, posY *int
	if err := s.Scan(
		&n.ID, &n.Title, &n.Section, &n.Kind, &n.Cluster, &n.Description, &n.TotalCount,
		&posX, &posY, &n.SortOrder, &n.IsActive,
	); err != nil {
		return domain.AtlasCatalogueNode{}, err
	}
	n.PosX = posX
	n.PosY = posY
	return n, nil
}
