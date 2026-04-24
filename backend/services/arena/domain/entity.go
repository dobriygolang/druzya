// Package domain содержит сущности bounded-контекста арены, логику матчмейкинга
// и интерфейсы репозиториев. Импорты фреймворков сюда не допускаются.
package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Sentinel-ошибки.
var (
	ErrNotFound        = errors.New("arena: not found")
	ErrAlreadyInQueue  = errors.New("arena: already in queue")
	ErrNotParticipant  = errors.New("arena: not a match participant")
	ErrMatchStateWrong = errors.New("arena: match not in the required state")
	ErrCodeTooLarge    = errors.New("arena: code exceeds 50KB limit")
)

// MaxCodeSizeBytes — жёсткий лимит размера одной отправки кода (bible §11).
const MaxCodeSizeBytes = 50 * 1024

// InitialELO — стартовый рейтинг для игрока без истории. Хранится здесь, чтобы
// matchmaker не зависел от домена rating.
const InitialELO = 1000

// Match — доменная сущность одного PvP-матча.
//
// 1v1-матчи проставляют WinnerID и оставляют WinningTeamID == 0. 2v2-матчи
// проставляют WinningTeamID (1 или 2) и оставляют WinnerID == nil. Ничья
// оставляет оба поля нулевыми / nil.
type Match struct {
	ID            uuid.UUID
	TaskID        uuid.UUID
	TaskVersion   int
	Section       enums.Section
	Mode          enums.ArenaMode
	Status        enums.MatchStatus
	WinnerID      *uuid.UUID
	WinningTeamID int // 0 = не задано / ничья / 1v1; 1 или 2 для 2v2.
	StartedAt     *time.Time
	FinishedAt    *time.Time
	CreatedAt     time.Time
}

// Participant отражает строку таблицы arena_participants.
type Participant struct {
	MatchID        uuid.UUID
	UserID         uuid.UUID
	Team           int
	EloBefore      int
	EloAfter       *int
	SuspicionScore *float64
	SolveTimeMs    *int64
	SubmittedAt    *time.Time
}

// QueueTicket — ожидающая запись в очереди матчмейкинга, хранится в Redis.
type QueueTicket struct {
	UserID     uuid.UUID
	Section    enums.Section
	Mode       enums.ArenaMode
	Elo        int
	EnqueuedAt time.Time
}

// Pair — два тикета, которые matchmaker решил свести в матч.
type Pair struct {
	A QueueTicket
	B QueueTicket
}

// ReadyCheckWindow — сколько времени даётся обоим игрокам на подтверждение
// готовности до отмены матча (bible §3.4). Экспортируется для тестов.
const ReadyCheckWindow = 10 * time.Second

// PasteSuspicionBump — прибавка к suspicion_score участника за каждое событие
// paste_attempt.
const PasteSuspicionBump = 25.0

// SuspicionHighThreshold — порог suspicion_score, выше которого нужно поднять
// антифрод-сигнал severity=High.
const SuspicionHighThreshold = 75.0

// AnomalousSpeedSuspicion — базовый score, начисляемый, когда решение быстрее
// исторического p5.
const AnomalousSpeedSuspicion = 40.0

// ── Match history pagination ───────────────────────────────────────────────

// HistoryDefaultLimit — page size, который вернётся, если клиент не передал
// явный limit (или передал 0/отрицательное).
const HistoryDefaultLimit = 20

// HistoryMaxLimit — потолок per_page, чтобы один запрос не съел весь Postgres.
const HistoryMaxLimit = 100

// ClampHistoryLimit нормализует limit к [1, HistoryMaxLimit] с дефолтом
// HistoryDefaultLimit для нулевых значений.
func ClampHistoryLimit(limit int) int {
	if limit <= 0 {
		return HistoryDefaultLimit
	}
	if limit > HistoryMaxLimit {
		return HistoryMaxLimit
	}
	return limit
}

// ClampHistoryOffset не даёт offset уйти в минус (Postgres всё равно отвергнет).
func ClampHistoryOffset(offset int) int {
	if offset < 0 {
		return 0
	}
	return offset
}

// MatchResultLabel — строковые константы итога матча для одного игрока.
const (
	MatchResultWin       = "win"
	MatchResultLoss      = "loss"
	MatchResultDraw      = "draw"
	MatchResultAbandoned = "abandoned"
)

// ResultFor возвращает результат матча с точки зрения userID. winnerID == nil
// и status=cancelled → "abandoned"; winnerID == nil и status=finished → "draw"
// (когда матч закончился без явного победителя — например ничья по таймауту).
func ResultFor(userID uuid.UUID, winnerID *uuid.UUID, status enums.MatchStatus) string {
	if status == enums.MatchStatusCancelled {
		return MatchResultAbandoned
	}
	if winnerID == nil {
		return MatchResultDraw
	}
	if *winnerID == userID {
		return MatchResultWin
	}
	return MatchResultLoss
}
