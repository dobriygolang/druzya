package domain

import (
	"context"

	"github.com/google/uuid"
)

// FriendRepo инкапсулирует CRUD по friendships.
//
// Methods returning Friendship мутируют те поля, которые БД переписывает
// (CreatedAt/AcceptedAt). Sentinel errors из ErrXxx — для всех not-found /
// transition ошибок.
type FriendRepo interface {
	// Add создаёт pending-запрос. ErrSelfFriendship / ErrAlreadyExists на
	// дублях — caller должен решить (например, при уже existing accepted —
	// не мешать).
	Add(ctx context.Context, requester, addressee uuid.UUID) (Friendship, error)
	// Accept переводит pending → accepted. Только addressee может accept.
	Accept(ctx context.Context, id int64, byUser uuid.UUID) (Friendship, error)
	// Decline удаляет pending-строку. Только addressee.
	Decline(ctx context.Context, id int64, byUser uuid.UUID) error
	// Block помечает (byUser, target) как blocked. Идемпотентен.
	Block(ctx context.Context, byUser, target uuid.UUID) error
	// Unblock снимает blocked.
	Unblock(ctx context.Context, byUser, target uuid.UUID) error
	// Remove убирает дружбу (любую сторону).
	Remove(ctx context.Context, byUser, friend uuid.UUID) error

	// ListAccepted возвращает обогащённые DTO (друг + username/avatar/tier).
	ListAccepted(ctx context.Context, uid uuid.UUID) ([]FriendListEntry, error)
	// ListIncoming возвращает pending-заявки, где uid — addressee.
	ListIncoming(ctx context.Context, uid uuid.UUID) ([]FriendListEntry, error)
	// ListOutgoing возвращает pending, где uid — requester.
	ListOutgoing(ctx context.Context, uid uuid.UUID) ([]FriendListEntry, error)
	// ListBlocked возвращает blocked-список (uid blocked target).
	ListBlocked(ctx context.Context, uid uuid.UUID) ([]FriendListEntry, error)

	// GetIDByPair находит friendship.id по паре (requester|addressee, friend).
	// Используется handler'ами accept/decline когда фронт передал user_id.
	GetIDByPair(ctx context.Context, a, b uuid.UUID) (int64, error)

	// Suggestions возвращает 3-5 пользователей: tier-match (rating-bucket),
	// нет существующей дружбы. Простой baseline; дальше — recsys.
	Suggestions(ctx context.Context, uid uuid.UUID, limit int) ([]FriendListEntry, error)
}

// FriendCodeRepo — короткие invite-коды.
type FriendCodeRepo interface {
	// Generate либо возвращает текущий не-истёкший код, либо создаёт новый.
	Generate(ctx context.Context, uid uuid.UUID) (FriendCode, error)
	// Resolve возвращает (uid, nil) если код валиден; (zero, ErrNotFound) если
	// не найден; (zero, ErrCodeExpired) если просрочен.
	Resolve(ctx context.Context, code string) (uuid.UUID, error)
}

// PresenceProvider — узкий порт «онлайн или нет». Реализация может быть
// stub-ом (всегда false) или адаптером к существующему ws-presence
// (если такой есть).
type PresenceProvider interface {
	IsOnline(ctx context.Context, uid uuid.UUID) bool
}

// AlwaysOffline — fallback presence, если presence-провайдер ещё не реализован.
type AlwaysOffline struct{}

// IsOnline всегда false.
func (AlwaysOffline) IsOnline(context.Context, uuid.UUID) bool { return false }
