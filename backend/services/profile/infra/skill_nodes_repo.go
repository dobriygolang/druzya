package infra

import (
	"context"
	"fmt"

	"druz9/profile/domain"
	"druz9/shared/enums"

	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ListSkillNodes via sqlc.
func (p *Postgres) ListSkillNodes(ctx context.Context, userID uuid.UUID) ([]domain.SkillNode, error) {
	rows, err := p.q.ListSkillNodes(ctx, sharedpg.UUID(userID))
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListSkillNodes: %w", err)
	}
	out := make([]domain.SkillNode, 0, len(rows))
	for _, r := range rows {
		n := domain.SkillNode{
			NodeKey:   r.NodeKey,
			Progress:  int(r.Progress),
			UpdatedAt: r.UpdatedAt.Time,
		}
		if r.UnlockedAt.Valid {
			t := r.UnlockedAt.Time
			n.UnlockedAt = &t
		}
		if r.DecayedAt.Valid {
			t := r.DecayedAt.Time
			n.DecayedAt = &t
		}
		out = append(out, n)
	}
	return out, nil
}

// UpsertSkillNode upserts (user_id, node_key) into skill_nodes with the
// given progress. Validates the node exists in atlas_nodes (returns
// ErrNotFound if not). On conflict, progress = GREATEST(stored, incoming)
// — re-allocating the same skill never regresses an in-progress node.
func (p *Postgres) UpsertSkillNode(ctx context.Context, userID uuid.UUID, nodeKey string, progress int) (domain.SkillNode, error) {
	if nodeKey == "" {
		return domain.SkillNode{}, fmt.Errorf("profile.Postgres.UpsertSkillNode: node_key is required")
	}
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	// Existence check against atlas_nodes — anti-fallback: do not silently
	// create orphan skill_nodes rows that point at a missing catalogue id.
	var exists bool
	if err := p.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM atlas_nodes WHERE id = $1 AND is_active = TRUE)`,
		nodeKey,
	).Scan(&exists); err != nil {
		return domain.SkillNode{}, fmt.Errorf("profile.Postgres.UpsertSkillNode: check node: %w", err)
	}
	if !exists {
		return domain.SkillNode{}, fmt.Errorf("profile.Postgres.UpsertSkillNode: %w", domain.ErrNotFound)
	}
	const q = `
		INSERT INTO skill_nodes (user_id, node_key, progress, unlocked_at, updated_at)
		VALUES ($1, $2, $3, now(), now())
		ON CONFLICT (user_id, node_key) DO UPDATE SET
		    progress    = GREATEST(skill_nodes.progress, EXCLUDED.progress),
		    unlocked_at = COALESCE(skill_nodes.unlocked_at, EXCLUDED.unlocked_at),
		    updated_at  = now()
		RETURNING progress, unlocked_at, decayed_at, updated_at`
	var sn domain.SkillNode
	sn.NodeKey = nodeKey
	var unlocked, decayed pgtype.Timestamptz
	var updated pgtype.Timestamptz
	if err := p.pool.QueryRow(ctx, q, sharedpg.UUID(userID), nodeKey, int32(progress)).Scan(
		&sn.Progress, &unlocked, &decayed, &updated,
	); err != nil {
		return domain.SkillNode{}, fmt.Errorf("profile.Postgres.UpsertSkillNode: %w", err)
	}
	if unlocked.Valid {
		t := unlocked.Time
		sn.UnlockedAt = &t
	}
	if decayed.Valid {
		t := decayed.Time
		sn.DecayedAt = &t
	}
	if updated.Valid {
		sn.UpdatedAt = updated.Time
	}
	return sn, nil
}

// ListRatings via sqlc.
func (p *Postgres) ListRatings(ctx context.Context, userID uuid.UUID) ([]domain.SectionRating, error) {
	rows, err := p.q.ListRatings(ctx, sharedpg.UUID(userID))
	if err != nil {
		return nil, fmt.Errorf("profile.Postgres.ListRatings: %w", err)
	}
	out := make([]domain.SectionRating, 0, len(rows))
	for _, r := range rows {
		sr := domain.SectionRating{
			Section:      enums.Section(r.Section),
			Elo:          int(r.Elo),
			MatchesCount: int(r.MatchesCount),
		}
		if r.LastMatchAt.Valid {
			t := r.LastMatchAt.Time
			sr.LastMatchAt = &t
		}
		out = append(out, sr)
	}
	return out, nil
}
