//go:generate go run go.uber.org/mock/mockgen -package mocks -destination mocks/repo_mock.go -source repo.go
package domain

import (
	"context"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// MatchRepo сохраняет arena_matches и arena_participants.
type MatchRepo interface {
	// CreateMatch вставляет матч и стартовые строки участников (status=confirming).
	CreateMatch(ctx context.Context, m Match, parts []Participant) (Match, error)

	// Get загружает матч по ID.
	Get(ctx context.Context, id uuid.UUID) (Match, error)

	// ListParticipants возвращает участников матча, упорядоченных по команде.
	ListParticipants(ctx context.Context, matchID uuid.UUID) ([]Participant, error)

	// UpdateStatus меняет статус матча и при необходимости проставляет started_at/finished_at.
	UpdateStatus(ctx context.Context, id uuid.UUID, status enums.MatchStatus, startedAt, finishedAt *time.Time) error

	// SetWinner записывает победителя и finished_at.
	SetWinner(ctx context.Context, id uuid.UUID, winner uuid.UUID, finishedAt time.Time) error

	// SetWinningTeam записывает team_id победителя 2v2-матча (1 или 2),
	// переводит статус в 'finished' и проставляет finished_at. winner_id
	// остаётся NULL для team-матчей.
	SetWinningTeam(ctx context.Context, id uuid.UUID, team int, finishedAt time.Time) error

	// SetTask проставляет выбранную задачу на матч (после матчмейкинга).
	SetTask(ctx context.Context, id uuid.UUID, taskID uuid.UUID, taskVersion int) error

	// UpsertParticipantResult записывает solve_time_ms, suspicion_score и submitted_at.
	UpsertParticipantResult(ctx context.Context, p Participant) error

	// ListByUser возвращает страницу истории матчей пользователя (только статусы
	// finished/cancelled), отсортированную по finished_at DESC, и общее число
	// строк под фильтром (для пагинации). modeFilter / sectionFilter = "" → без
	// фильтрации по этому полю. limit/offset должны быть уже нормализованы
	// вызывающей стороной.
	ListByUser(
		ctx context.Context,
		userID uuid.UUID,
		limit, offset int,
		modeFilter enums.ArenaMode,
		sectionFilter enums.Section,
	) (items []MatchHistoryEntry, total int, err error)

	// FindCurrentMatch возвращает последний незавершённый матч пользователя
	// (status IN searching|confirming|active). SPA опрашивает этот endpoint,
	// пока пользователь в очереди, чтобы в момент появления матча перейти
	// на /arena/match/:id. Возвращает ErrNotFound, если такого матча нет.
	FindCurrentMatch(ctx context.Context, userID uuid.UUID) (Match, error)
}

// MatchHistoryEntry — плоская проекция одной строки истории, готовая к
// рендерингу: с противником, итогом, дельтой LP и длительностью. Считается
// в SQL одним запросом, чтобы фронт не дёргал отдельные ручки на каждую строку.
type MatchHistoryEntry struct {
	MatchID           uuid.UUID
	FinishedAt        time.Time
	Mode              enums.ArenaMode
	Section           enums.Section
	OpponentUserID    uuid.UUID
	OpponentUsername  string
	OpponentAvatarURL string
	// Result — "win" | "loss" | "draw" | "abandoned". Хранится строкой ради
	// прямого совпадения с OpenAPI / wire-форматом.
	Result          string
	LPChange        int
	DurationSeconds int
}

// TaskRepo предоставляет минимальный интерфейс выборки задач, нужный арене:
// фильтр по секции/сложности и поиск по id. STUB: для MVP возвращаем
// одну случайную активную задачу.
type TaskRepo interface {
	PickBySectionDifficulty(ctx context.Context, section enums.Section, diff enums.Difficulty) (TaskPublic, error)
	GetByID(ctx context.Context, id uuid.UUID) (TaskPublic, error)
}

// TaskPublic — клиентское представление задачи: solution_hint НИКОГДА не заполняется.
type TaskPublic struct {
	ID            uuid.UUID
	Version       int
	Slug          string
	Title         string
	Description   string
	Difficulty    enums.Difficulty
	Section       enums.Section
	TimeLimitSec  int
	MemoryLimitMB int
	StarterCode   map[string]string
}

// QueueRepo — абстракция над очередью матчмейкинга в Redis.
type QueueRepo interface {
	// Enqueue добавляет тикет в очередь section+mode по ключу ELO.
	// Возвращает ErrAlreadyInQueue, если у пользователя уже есть запись.
	Enqueue(ctx context.Context, t QueueTicket) error

	// Remove удаляет запись пользователя из всех ключей, которые ведёт реализация
	// (no-op, если записи нет).
	Remove(ctx context.Context, userID uuid.UUID, section enums.Section, mode enums.ArenaMode) error

	// Snapshot возвращает все ожидающие тикеты для пары (section, mode),
	// упорядоченные по ELO ASC, чтобы matchmaker мог пройти соседними парами.
	Snapshot(ctx context.Context, section enums.Section, mode enums.ArenaMode) ([]QueueTicket, error)

	// AcquireLock пытается SETNX поставить короткоживущий лок на user id;
	// возвращает ok=true, если лок взят. Используется, чтобы не сматчить
	// одного пользователя дважды на параллельных тиках диспетчера.
	AcquireLock(ctx context.Context, userID uuid.UUID, ttl time.Duration) (bool, error)

	// ReleaseLock снимает ключ лока.
	ReleaseLock(ctx context.Context, userID uuid.UUID) error

	// Position возвращает 1-based позицию пользователя в очереди (по ELO,
	// тай-брейк по enqueued_at). Ноль означает отсутствие.
	Position(ctx context.Context, userID uuid.UUID, section enums.Section, mode enums.ArenaMode) (int, error)

	// Waiting возвращает количество ожидающих тикетов в очереди (section, mode).
	// Дешёвый O(1) ZCard — используется лендинг-страницей /arena чтобы показать
	// "X в очереди" живыми числами вместо хардкода.
	Waiting(ctx context.Context, section enums.Section, mode enums.ArenaMode) (int, error)
}

// ReadyCheckRepo отслеживает состояние ready-check по каждому матчу.
type ReadyCheckRepo interface {
	// Start запускает новое 10-секундное окно для матча.
	Start(ctx context.Context, matchID uuid.UUID, userIDs []uuid.UUID, deadline time.Time) error

	// Confirm помечает одного пользователя подтвердившимся. Возвращает
	// everyoneConfirmed=true в момент, когда подтвердился последний.
	Confirm(ctx context.Context, matchID, userID uuid.UUID) (everyone bool, err error)

	// Get возвращает текущее состояние (отсутствует = не запущен).
	Get(ctx context.Context, matchID uuid.UUID) (ReadyCheckState, bool, error)

	// Clear очищает запись ready-check после перехода.
	Clear(ctx context.Context, matchID uuid.UUID) error
}

// ReadyCheckState — то, что возвращает ReadyCheckRepo.Get.
type ReadyCheckState struct {
	MatchID   uuid.UUID
	UserIDs   []uuid.UUID
	Confirmed map[uuid.UUID]bool
	Deadline  time.Time
}

// AnticheatRepo отслеживает suspicion scores по участникам и счётчики по матчу.
type AnticheatRepo interface {
	// AddSuspicion увеличивает score участника на delta и возвращает новое значение.
	AddSuspicion(ctx context.Context, matchID, userID uuid.UUID, delta float64) (float64, error)

	// GetSuspicion возвращает текущий score.
	GetSuspicion(ctx context.Context, matchID, userID uuid.UUID) (float64, error)

	// IncrTabSwitch инкрементирует счётчик tab-switch и возвращает новое значение.
	IncrTabSwitch(ctx context.Context, matchID, userID uuid.UUID) (int, error)
}

// Judge0Client отправляет код на проверку. STUB-реализация в infra/judge0.go всегда проходит.
//
// STUB: настоящий Judge0-клиент. Будет жить в отдельном пакете после интеграции.
type Judge0Client interface {
	Submit(ctx context.Context, code, language string, task TaskPublic) (Judge0Result, error)
}

// Judge0Result — минимальная форма результата, которая интересна арене.
type Judge0Result struct {
	Passed      bool
	TestsTotal  int
	TestsPassed int
	RuntimeMs   int
	MemoryKB    int
}
