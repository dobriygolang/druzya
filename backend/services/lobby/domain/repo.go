package domain

import (
	"context"

	"github.com/google/uuid"
)

// ListFilter — параметры фильтрации публичного списка лобби.
type ListFilter struct {
	Visibility Visibility // by default — public
	Mode       Mode       // optional ("" → no filter)
	Section    string     // optional
	Limit      int        // 1..50, default 20
}

// Repo — порт хранилища лобби.
type Repo interface {
	// Create вставляет лобби и owner-запись участника одной транзакцией.
	// Реализация сама подбирает уникальный 4-буквенный code (с retry до
	// MaxCodeRetries); если коллизия не разрешилась — ErrCodeExhausted.
	Create(ctx context.Context, l Lobby) (Lobby, error)

	Get(ctx context.Context, id uuid.UUID) (Lobby, error)
	GetByCode(ctx context.Context, code string) (Lobby, error)

	ListPublic(ctx context.Context, f ListFilter) ([]Lobby, error)

	AddMember(ctx context.Context, m Member) error
	RemoveMember(ctx context.Context, lobbyID, userID uuid.UUID) error
	ListMembers(ctx context.Context, lobbyID uuid.UUID) ([]Member, error)
	CountMembers(ctx context.Context, lobbyID uuid.UUID) (int, error)
	HasMember(ctx context.Context, lobbyID, userID uuid.UUID) (bool, error)

	SetStatus(ctx context.Context, lobbyID uuid.UUID, status Status) error
	SetMatchID(ctx context.Context, lobbyID uuid.UUID, matchID uuid.UUID) error
}

// MatchCreator — узкий cross-context порт в arena. cmd/monolith реализует
// его, оборачивая arena.MatchRepo.CreateMatch + участников.
type MatchCreator interface {
	// CreateMatch создаёт arena_match со списком user_id и возвращает его id.
	// Lobby сама не знает про team-распределение arena — это забота адаптера.
	CreateMatch(
		ctx context.Context,
		mode Mode,
		section, difficulty string,
		userIDs []uuid.UUID,
	) (uuid.UUID, error)
}
