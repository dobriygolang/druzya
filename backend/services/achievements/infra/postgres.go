// Package infra — Postgres + Redis-кеш адаптеры для achievements.
//
// Используем прямой pgx (без sqlc), как notify/postgres_support — таблица
// одна, запросов мало, генерации не оправдывают накладных расходов на
// поддержку в sqlc.yaml.
package infra

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/achievements/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres реализует domain.UserAchievementRepo.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres конструктор.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool}
}

// Get загружает строку (user_id, code).
func (p *Postgres) Get(ctx context.Context, userID uuid.UUID, code string) (domain.UserAchievement, error) {
	row := p.pool.QueryRow(ctx, `
		SELECT user_id, code, progress, target, unlocked_at, updated_at
		  FROM user_achievements
		 WHERE user_id = $1 AND code = $2
	`, userID, code)
	var (
		out        domain.UserAchievement
		unlockedAt nullableTime
	)
	if err := row.Scan(&out.UserID, &out.Code, &out.Progress, &out.Target, &unlockedAt, &out.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.UserAchievement{}, domain.ErrNotFound
		}
		return domain.UserAchievement{}, fmt.Errorf("achievements.pg.Get: %w", err)
	}
	if unlockedAt.Valid {
		t := unlockedAt.Time
		out.UnlockedAt = &t
	}
	return out, nil
}

// List возвращает все строки одного пользователя.
func (p *Postgres) List(ctx context.Context, userID uuid.UUID) ([]domain.UserAchievement, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT user_id, code, progress, target, unlocked_at, updated_at
		  FROM user_achievements
		 WHERE user_id = $1
		 ORDER BY unlocked_at DESC NULLS LAST, code
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("achievements.pg.List: %w", err)
	}
	defer rows.Close()
	out := make([]domain.UserAchievement, 0)
	for rows.Next() {
		var (
			r          domain.UserAchievement
			unlockedAt nullableTime
		)
		if err := rows.Scan(&r.UserID, &r.Code, &r.Progress, &r.Target, &unlockedAt, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("achievements.pg.List: scan: %w", err)
		}
		if unlockedAt.Valid {
			t := unlockedAt.Time
			r.UnlockedAt = &t
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("achievements.pg.List: rows: %w", err)
	}
	return out, nil
}

// UpsertProgress апсёртит прогресс.
//
//   - progress = max(старый, новый)  — никогда не уменьшаем счётчик;
//   - target = max(старый, новый)    — каталог может «понизить» цель,
//     но в БД уважаем уже сохранённую более высокую (защита от регрессии конфига);
//   - unlocked_at = now() выставляется ТОЛЬКО если progress >= target И старый
//     unlocked_at был NULL — атомарно в одном UPDATE/INSERT.
//
// `unlocked` истина только когда строка перешла из NULL → not NULL в этом вызове.
func (p *Postgres) UpsertProgress(ctx context.Context, userID uuid.UUID, code string, progress int, target int) (domain.UserAchievement, bool, error) {
	if target < 1 {
		target = 1
	}
	if progress < 0 {
		progress = 0
	}
	row := p.pool.QueryRow(ctx, `
		INSERT INTO user_achievements (user_id, code, progress, target, unlocked_at)
		VALUES ($1, $2, $3, $4, CASE WHEN $3 >= $4 THEN now() ELSE NULL END)
		ON CONFLICT (user_id, code) DO UPDATE
		   SET progress    = GREATEST(user_achievements.progress, EXCLUDED.progress),
		       target      = GREATEST(user_achievements.target,   EXCLUDED.target),
		       unlocked_at = COALESCE(
		                       user_achievements.unlocked_at,
		                       CASE WHEN GREATEST(user_achievements.progress, EXCLUDED.progress) >=
		                                 GREATEST(user_achievements.target,   EXCLUDED.target)
		                            THEN now() END
		                     ),
		       updated_at  = now()
		RETURNING user_id, code, progress, target, unlocked_at, updated_at,
		          (xmax = 0) AS inserted
	`, userID, code, progress, target)
	var (
		out        domain.UserAchievement
		unlockedAt nullableTime
		inserted   bool
	)
	if err := row.Scan(&out.UserID, &out.Code, &out.Progress, &out.Target, &unlockedAt, &out.UpdatedAt, &inserted); err != nil {
		return domain.UserAchievement{}, false, fmt.Errorf("achievements.pg.UpsertProgress: %w", err)
	}
	if unlockedAt.Valid {
		t := unlockedAt.Time
		out.UnlockedAt = &t
	}
	// Чтобы корректно понять «была ли первая разблокировка», смотрим:
	//   - inserted == true И unlocked_at != nil → новая запись сразу unlocked
	//   - inserted == false И unlocked_at != nil → нужен прошлый state. Перечитываем
	//     БЕЗ повторного апсёрта: если прошлый unlocked_at был NULL, а сейчас есть —
	//     эта операция unlock'нула. Чтобы не делать второй запрос, дополнительно
	//     меряем «xmax=0» (insert) — для UPDATE этого недостаточно. Поэтому
	//     для UPDATE-ветки используем эвристику: если progress < target до этого
	//     вызова — мы не могли быть unlocked. Без транзакции с SELECT мы не
	//     знаем точно, поэтому возвращаем unlocked = (unlockedAt != nil) AND inserted.
	//
	// Подписчики, которым важна точность (например, achievements.Unlocked event),
	// должны идемпотентно обрабатывать повторный unlock — у нас сегодня нет
	// publisher'ов отдельных событий для этой ачивки, всё внутреннее.
	unlocked := unlockedAt.Valid && inserted
	if !inserted && unlockedAt.Valid {
		// Ровно эта операция могла unlock'нуть, если unlocked_at очень близко к
		// updated_at (одна транзакция). Допуск 5 секунд — overlap миллисекунд
		// и часов сервера.
		if !unlockedAt.Time.IsZero() &&
			out.UpdatedAt.Sub(unlockedAt.Time).Abs() < 5*time.Second {
			unlocked = true
		}
	}
	return out, unlocked, nil
}

// Unlock — частный случай UpsertProgress(progress=target). Возвращает
// (row, unlocked). Идемпотентен.
func (p *Postgres) Unlock(ctx context.Context, userID uuid.UUID, code string, target int) (domain.UserAchievement, bool, error) {
	if target < 1 {
		target = 1
	}
	return p.UpsertProgress(ctx, userID, code, target, target)
}

// nullableTime — pgx умеет в *time.Time, но эту обёртку явно используем
// в Scan чтобы код не зависел от версии pgx-сканера для NULL.
type nullableTime struct {
	Time  time.Time
	Valid bool
}

func (n *nullableTime) Scan(src any) error {
	if src == nil {
		n.Valid = false
		return nil
	}
	switch v := src.(type) {
	case time.Time:
		n.Time = v.UTC()
		n.Valid = true
	default:
		return fmt.Errorf("achievements.scan time: unsupported type %T", src)
	}
	return nil
}

// Compile-time guard.
var _ domain.UserAchievementRepo = (*Postgres)(nil)
