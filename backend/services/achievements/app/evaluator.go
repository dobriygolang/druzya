// Package app — use cases для achievements.
//
// Evaluator — central place where we map текущее user-state в прогресс
// каталога. Подключаем минимально-нужные интерфейсы соседних доменов
// (см. ports.go), чтобы не трогать чужие репозитории напрямую.
//
// Каталог фиксирован в domain/catalogue.go, поэтому evaluator знает code'ы
// напрямую — это явная связь content↔code, которую мы принимаем (см.
// TODO admin-cms в catalogue.go).
package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/achievements/domain"

	"github.com/google/uuid"
)

// UserState — снимок данных пользователя, по которому считаем прогресс.
//
// Поля — number-only / strings, чтобы любые reader'ы могли заполнить структуру
// (тесты, реальные адаптеры, подписчики событий с частичными данными).
type UserState struct {
	// XPTotal — суммарное количество XP пользователя.
	XPTotal int
	// Level — текущий уровень.
	Level int
	// AtlasPercent — % разблокированных узлов Atlas (0..100).
	AtlasPercent int

	// ArenaWins — общее количество побед в Ranked 1v1.
	ArenaWins int
	// MaxELO — пиковый ELO в любой секции (для promotion ачивок).
	MaxELO int
	// CurrentWinStreak — текущая серия побед в Ranked.
	CurrentWinStreak int
	// TournamentWins — победы в турнирах.
	TournamentWins int

	// DailyTotalDone — total решённых daily.
	DailyTotalDone int
	// CurrentStreak — текущий streak (consecutive days).
	CurrentStreak int

	// FriendsCount — принятых дружб.
	FriendsCount int
	// ChallengesSent — challenges sent.
	ChallengesSent int

	// CohortJoined — true если состоит в когорты.
	CohortJoined bool
	// CohortWarsWon — побед когорты.
	CohortWarsWon int
	// HardSolved — solved Hard-задач.
	HardSolved int
	// MediumSolved — solved Medium-задач.
	MediumSolved int
	// AnySolved — total решённых задач любых уровней.
	AnySolved int
}

// Evaluator считает прогресс по каталогу и пишет в repo.
type Evaluator struct {
	Repo  domain.UserAchievementRepo
	Log   *slog.Logger
	Now   func() time.Time
	State UserStateProvider
}

// UserStateProvider — порт, через который evaluator получает state.
type UserStateProvider interface {
	Snapshot(ctx context.Context, userID uuid.UUID) (UserState, error)
}

// EvaluateUserProgress — пересчитывает все прогрессы по каталогу для одного
// пользователя. Идемпотентно: повторный запуск без изменений данных не
// переисчисляет unlocked_at (UpsertProgress в БД хранит COALESCE(unlocked_at)).
//
// Возвращает список code'ов, которые впервые stали unlocked в этой операции —
// caller (см. wiring) может публиковать events / слать notify.
func (e *Evaluator) EvaluateUserProgress(ctx context.Context, userID uuid.UUID) ([]string, error) {
	if e.Repo == nil {
		return nil, fmt.Errorf("achievements.Evaluator: nil Repo")
	}
	if e.State == nil {
		return nil, fmt.Errorf("achievements.Evaluator: nil State")
	}
	st, err := e.State.Snapshot(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("achievements.Evaluator.Snapshot: %w", err)
	}

	var newlyUnlocked []string
	for _, ach := range domain.Catalogue() {
		progress := scoreForCode(ach.Code, st)
		if progress < 0 {
			// нет данных для этой ачивки — пропускаем
			continue
		}
		// никогда не уменьшаем target — UpsertProgress сам делает GREATEST.
		_, unlocked, err := e.Repo.UpsertProgress(ctx, userID, ach.Code, progress, ach.Target)
		if err != nil {
			if e.Log != nil {
				e.Log.WarnContext(ctx, "achievements.Evaluator: upsert failed",
					slog.String("code", ach.Code),
					slog.Any("err", err),
					slog.Any("user_id", userID),
				)
			}
			continue
		}
		if unlocked {
			newlyUnlocked = append(newlyUnlocked, ach.Code)
		}
	}
	return newlyUnlocked, nil
}

// scoreForCode возвращает текущий прогресс по коду. -1 → нет данных,
// caller skips.
func scoreForCode(code string, st UserState) int {
	switch code {
	// Combat
	case "first-blood":
		if st.ArenaWins >= 1 {
			return 1
		}
		return 0
	case "arena-veteran":
		return st.ArenaWins
	case "arena-master":
		return st.ArenaWins
	case "speed-demon":
		// рассчитывается отдельным publisher'ом в будущем; пока — нет данных.
		return -1
	case "ranked-promotion-platinum":
		if st.MaxELO >= 2000 {
			return 1
		}
		return 0
	case "ranked-promotion-diamond":
		if st.MaxELO >= 2400 {
			return 1
		}
		return 0
	case "ranked-promotion-master":
		if st.MaxELO >= 2800 {
			return 1
		}
		return 0
	case "champion":
		if st.TournamentWins >= 1 {
			return 1
		}
		return 0
	case "iron-defender":
		return st.CurrentWinStreak

	// Consistency / daily
	case "daily-first":
		if st.DailyTotalDone >= 1 {
			return 1
		}
		return 0
	case "streak-7":
		return clamp(st.CurrentStreak, 0, 7)
	case "streak-30":
		return clamp(st.CurrentStreak, 0, 30)
	case "streak-100":
		return clamp(st.CurrentStreak, 0, 100)
	case "cursed-friday", "boss-kata", "early-bird", "night-owl":
		// бинарные ачивки, специально publish'аются. snapshot не знает.
		return -1

	// Mastery / XP
	case "xp-1k":
		return clamp(st.XPTotal, 0, 1000)
	case "xp-10k":
		return clamp(st.XPTotal, 0, 10000)
	case "xp-50k":
		return clamp(st.XPTotal, 0, 50000)
	case "xp-100k":
		return clamp(st.XPTotal, 0, 100000)
	case "atlas-half":
		return clamp(st.AtlasPercent, 0, 50)
	case "atlas-full":
		return clamp(st.AtlasPercent, 0, 100)
	case "level-10":
		return clamp(st.Level, 0, 10)
	case "level-25":
		return clamp(st.Level, 0, 25)
	case "level-50":
		return clamp(st.Level, 0, 50)
	case "algo-sage":
		return st.HardSolved
	case "code-warrior":
		return st.AnySolved

	// Social / friends / cohort
	case "first-friend":
		if st.FriendsCount >= 1 {
			return 1
		}
		return 0
	case "social-five":
		return st.FriendsCount
	case "social-twenty":
		return st.FriendsCount
	case "challenger":
		return st.ChallengesSent
	case "cohort-joined":
		if st.CohortJoined {
			return 1
		}
		return 0
	case "cohort-war-won":
		return st.CohortWarsWon
	case "cohort-war-mvp":
		// не агрегируется в snapshot — отдельный publisher.
		return -1
	}

	// secret / hidden — only publishers, не от snapshot.
	if strings.HasPrefix(code, "secret-") {
		return -1
	}
	return -1
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
