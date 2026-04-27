// skill_atlas_reader.go — adapter, читающий profile-сервисные таблицы
// (skill_nodes + atlas_nodes) для hone'ского plan_generator'а. Перенесён
// дословно из cmd/monolith/services/adapters.go (honeSkillAtlasAdapter).
//
// Cross-domain boundary preserved: hone никогда не импортирует profile,
// — adapter говорит raw SQL по таблицам, которые public by virtue of
// living in the shared Postgres instance.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SkillAtlasReader — Postgres impl of domain.SkillAtlasReader.
type SkillAtlasReader struct {
	pool *pgxpool.Pool
}

// NewSkillAtlasReader wraps pool.
func NewSkillAtlasReader(pool *pgxpool.Pool) domain.SkillAtlasReader {
	return &SkillAtlasReader{pool: pool}
}

// WeakestNodes queries the bottom-N by progress, joined with atlas_nodes.title.
// Priority: progress < 30 → high, 30-60 → medium, 60+ → low.
func (a *SkillAtlasReader) WeakestNodes(ctx context.Context, userID uuid.UUID, limit int) ([]domain.WeakNode, error) {
	if limit <= 0 || limit > 20 {
		limit = 5
	}
	rows, err := a.pool.Query(ctx,
		`SELECT sn.node_key, COALESCE(an.title, sn.node_key), sn.progress
		   FROM skill_nodes sn
		   LEFT JOIN atlas_nodes an ON an.id = sn.node_key AND an.is_active = TRUE
		  WHERE sn.user_id = $1
		  ORDER BY sn.progress ASC, sn.updated_at DESC
		  LIMIT $2`,
		sharedpg.UUID(userID), int32(limit),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("hone.SkillAtlasReader.WeakestNodes: %w", err)
	}
	defer rows.Close()
	out := make([]domain.WeakNode, 0, limit)
	for rows.Next() {
		var (
			nodeKey  string
			title    string
			progress int32
		)
		if err := rows.Scan(&nodeKey, &title, &progress); err != nil {
			return nil, fmt.Errorf("hone.SkillAtlasReader.WeakestNodes: scan: %w", err)
		}
		out = append(out, domain.WeakNode{
			NodeKey:     nodeKey,
			DisplayName: title,
			Progress:    int(progress),
			Priority:    priorityForProgress(int(progress)),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.SkillAtlasReader.WeakestNodes: rows: %w", err)
	}
	return out, nil
}

func priorityForProgress(p int) string {
	switch {
	case p < 30:
		return "high"
	case p < 60:
		return "medium"
	default:
		return "low"
	}
}
