// Resistance repository — moved out of postgres.go (Wave 10 split).
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Resistance implements domain.ResistanceRepo.
type Resistance struct {
	pool *pgxpool.Pool
}

// NewResistance wraps a pool.
func NewResistance(pool *pgxpool.Pool) *Resistance { return &Resistance{pool: pool} }

// Record пишет dismiss-event. Идемпотентен: PRIMARY KEY гарантирует, что
// повторный dismiss того же item'а в тот же день — nop (ON CONFLICT DO NOTHING).
func (r *Resistance) Record(ctx context.Context, userID uuid.UUID, skillKey, itemID string, planDate time.Time) error {
	if skillKey == "" || itemID == "" {
		return nil
	}
	_, err := r.pool.Exec(ctx,
		`INSERT INTO hone_plan_skips (user_id, skill_key, item_id, plan_date)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, skill_key, item_id, plan_date) DO NOTHING`,
		sharedpg.UUID(userID), skillKey, itemID, pgtype.Date{Time: planDate.UTC().Truncate(24 * time.Hour), Valid: true},
	)
	if err != nil {
		return fmt.Errorf("hone.Resistance.Record: %w", err)
	}
	return nil
}

// ChronicSkills возвращает скиллы, skip'ы по которым за `window` превышают
// `minCount`. HAVING COUNT(DISTINCT item_id) — уникальные task'и, не
// повторный dismiss того же item'а (дубли защищает PK, но item можно
// dismiss'ить, потом undismiss через новый AI-план, и снова dismiss — это
// уже два разных plan_date, посчитаем).
func (r *Resistance) ChronicSkills(ctx context.Context, userID uuid.UUID, window time.Duration, minCount int) ([]domain.ChronicSkill, error) {
	since := time.Now().UTC().Add(-window)
	rows, err := r.pool.Query(ctx,
		`SELECT skill_key, COUNT(*)::int, MAX(dismissed_at)
		   FROM hone_plan_skips
		  WHERE user_id=$1 AND dismissed_at >= $2
		  GROUP BY skill_key
		 HAVING COUNT(*) >= $3
		  ORDER BY COUNT(*) DESC, MAX(dismissed_at) DESC`,
		sharedpg.UUID(userID), since, int32(minCount),
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Resistance.ChronicSkills: %w", err)
	}
	defer rows.Close()
	out := make([]domain.ChronicSkill, 0, 4)
	for rows.Next() {
		var (
			skill    string
			count    int32
			lastSkip time.Time
		)
		if err := rows.Scan(&skill, &count, &lastSkip); err != nil {
			return nil, fmt.Errorf("hone.Resistance.ChronicSkills: scan: %w", err)
		}
		out = append(out, domain.ChronicSkill{
			SkillKey:  skill,
			SkipCount: int(count),
			LastSkip:  lastSkip,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Resistance.ChronicSkills: rows: %w", err)
	}
	return out, nil
}
