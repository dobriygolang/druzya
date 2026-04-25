package infra

import (
	"context"
	"fmt"

	"druz9/mock_interview/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Leaderboard implements domain.LeaderboardRepo against Postgres.
//
// Fairness watermark: WHERE ai_assist = false. Pipelines run with the AI
// assistant ON are excluded from the ranking entirely so the score is a
// signal of unaided performance.
type Leaderboard struct{ pool *pgxpool.Pool }

func NewLeaderboard(pool *pgxpool.Pool) *Leaderboard { return &Leaderboard{pool: pool} }

func (r *Leaderboard) Top(ctx context.Context, companyID *uuid.UUID, limit int) ([]domain.LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var cid pgtype.UUID
	if companyID != nil && *companyID != uuid.Nil {
		cid = sharedpg.UUID(*companyID)
	}
	rows, err := r.pool.Query(ctx, `
		SELECT
			u.id,
			COALESCE(NULLIF(u.display_name, ''), u.username) AS display_name,
			u.avatar_url,
			COUNT(*)::int                                    AS finished,
			COUNT(*) FILTER (WHERE p.verdict = 'pass')::int  AS passed,
			COALESCE(AVG(p.total_score), 0)::real            AS avg_score
		FROM mock_pipelines p
		JOIN users u ON u.id = p.user_id
		WHERE p.ai_assist = false
		  AND p.verdict IN ('pass','fail')
		  AND ($1::uuid IS NULL OR p.company_id = $1)
		GROUP BY u.id, u.display_name, u.username, u.avatar_url
		ORDER BY avg_score DESC, passed DESC, finished DESC
		LIMIT $2`, cid, limit)
	if err != nil {
		return nil, fmt.Errorf("mock_interview.Leaderboard.Top: %w", err)
	}
	defer rows.Close()
	var out []domain.LeaderboardEntry
	for rows.Next() {
		var (
			uid              pgtype.UUID
			name, avatar     string
			finished, passed int
			avgScore         float32
		)
		if err := rows.Scan(&uid, &name, &avatar, &finished, &passed, &avgScore); err != nil {
			return nil, fmt.Errorf("rows.Scan leaderboard: %w", err)
		}
		out = append(out, domain.LeaderboardEntry{
			UserID:            sharedpg.UUIDFrom(uid),
			DisplayName:       name,
			AvatarURL:         avatar,
			PipelinesFinished: finished,
			PipelinesPassed:   passed,
			AvgScore:          avgScore,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows.Err leaderboard: %w", err)
	}
	return out, nil
}

var _ domain.LeaderboardRepo = (*Leaderboard)(nil)
