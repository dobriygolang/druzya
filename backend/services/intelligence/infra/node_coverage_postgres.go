// node_coverage_postgres.go — R3 per-node coverage reader.
//
// Aggregates user_resource_log за окно 30d, фильтрует по atlas_node_id IN (...)
// + kind в наборе positive engagement events (clicked|finished|reflection_submitted).
// Возвращает per-node {state, count30d, count7d, last_match_at}.
//
// State derivation делегируется app.DeriveCoverageState чтобы держать heuristic
// в одном месте + тестируемой без БД.
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/intelligence/app"
	"druz9/intelligence/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NodeCoveragePostgres — pgx-backed NodeCoverageReader.
type NodeCoveragePostgres struct{ pool *pgxpool.Pool }

// NewNodeCoveragePostgres wires the adapter.
func NewNodeCoveragePostgres(pool *pgxpool.Pool) *NodeCoveragePostgres {
	return &NodeCoveragePostgres{pool: pool}
}

// CoverageForNodes returns per-node coverage for the given keys.
//
// Single GROUP BY query: считаем events за 30d window, plus subset за 7d через
// FILTER (WHERE ...). Nodes без events возвращаются с not_yet state — caller
// получает stable order по input nodeKeys.
func (r *NodeCoveragePostgres) CoverageForNodes(ctx context.Context, userID uuid.UUID, nodeKeys []string) ([]domain.NodeCoverage, error) {
	if len(nodeKeys) == 0 {
		return nil, nil
	}
	now := time.Now().UTC()
	since30 := now.Add(-30 * 24 * time.Hour)
	since7 := now.Add(-7 * 24 * time.Hour)

	rows, err := r.pool.Query(ctx, `
		SELECT atlas_node_id,
		       COUNT(*) FILTER (WHERE occurred_at >= $2)::int AS c30,
		       COUNT(*) FILTER (WHERE occurred_at >= $3)::int AS c7,
		       MAX(occurred_at) AS last_at
		  FROM user_resource_log
		 WHERE user_id = $1
		   AND atlas_node_id = ANY($4::text[])
		   AND kind IN ('clicked', 'finished', 'reflection_submitted')
		   AND occurred_at >= $2
		 GROUP BY atlas_node_id`,
		sharedpg.UUID(userID), since30, since7, nodeKeys,
	)
	if err != nil {
		return nil, fmt.Errorf("intelligence.NodeCoveragePostgres.CoverageForNodes: %w", err)
	}
	defer rows.Close()

	agg := make(map[string]domain.NodeCoverage, len(nodeKeys))
	for rows.Next() {
		var (
			nodeKey string
			c30     int
			c7      int
			lastAt  time.Time
		)
		if err := rows.Scan(&nodeKey, &c30, &c7, &lastAt); err != nil {
			return nil, fmt.Errorf("intelligence.NodeCoveragePostgres.CoverageForNodes scan: %w", err)
		}
		agg[nodeKey] = domain.NodeCoverage{
			NodeKey:       nodeKey,
			State:         app.DeriveCoverageState(c30, c7),
			MatchCount30d: c30,
			MatchCount7d:  c7,
			LastMatchAt:   lastAt,
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.NodeCoveragePostgres.CoverageForNodes rows: %w", err)
	}

	// Stable order по input nodeKeys + default not_yet entry for missing nodes.
	out := make([]domain.NodeCoverage, 0, len(nodeKeys))
	for _, k := range nodeKeys {
		if cov, ok := agg[k]; ok {
			out = append(out, cov)
			continue
		}
		out = append(out, domain.NodeCoverage{
			NodeKey: k,
			State:   domain.NodeCoverageNotYet,
		})
	}
	return out, nil
}

// Compile-time guard.
var _ domain.NodeCoverageReader = (*NodeCoveragePostgres)(nil)
