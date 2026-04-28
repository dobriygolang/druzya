// streak_reader.go — реализация domain.StreakReader через прямой pgx.
//
// Используется командой /streak бота: резолвит telegram_chat_id в user_id
// через notification_preferences, затем читает daily_streaks в одном JOIN.
// Не использует sqlc, т.к. это единственный cross-domain запрос в notify
// и плодить отдельный sql-файл не стоит.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/notify/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StreakPostgres implements domain.StreakReader.
type StreakPostgres struct {
	pool *pgxpool.Pool
}

// NewStreakPostgres constructs the adapter.
func NewStreakPostgres(pool *pgxpool.Pool) *StreakPostgres {
	return &StreakPostgres{pool: pool}
}

// GetStreakByChatID resolves a Telegram chat_id to the owner's streak data
// via a single JOIN across notification_preferences and daily_streaks.
// Returns domain.ErrNotFound when the chat_id is unknown or the user has
// no streak row yet.
func (s *StreakPostgres) GetStreakByChatID(ctx context.Context, chatID int64) (domain.StreakInfo, error) {
	chatIDStr := fmt.Sprintf("%d", chatID)
	row := s.pool.QueryRow(ctx, `
		SELECT ds.current_streak,
		       ds.longest_streak,
		       ds.freeze_tokens,
		       ds.last_kata_date
		  FROM notification_preferences np
		  JOIN daily_streaks ds ON ds.user_id = np.user_id
		 WHERE np.telegram_chat_id = $1
		 LIMIT 1
	`, chatIDStr)

	var (
		current, longest, freeze int
		lastDate                 *time.Time
	)
	if err := row.Scan(&current, &longest, &freeze, &lastDate); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.StreakInfo{}, domain.ErrNotFound
		}
		return domain.StreakInfo{}, fmt.Errorf("notify.streak.GetByChatID: %w", err)
	}

	info := domain.StreakInfo{
		CurrentStreak: current,
		LongestStreak: longest,
		FreezeTokens:  freeze,
	}
	if lastDate != nil {
		info.LastKataDate = lastDate.Format("2006-01-02")
	}
	return info, nil
}

// Compile-time assertion.
var _ domain.StreakReader = (*StreakPostgres)(nil)
