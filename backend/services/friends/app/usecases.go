// Package app — use cases для friends.
//
// Тонкие сервисы: каждый класс/struct = один use case, конструктор
// принимает interface'ы (testable). Никаких HTTP-знаний внутри — это
// чистая бизнес-логика.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/friends/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// Bus — узкий интерфейс publisher'а (избегаем импорта eventbus в app).
type Bus interface {
	Publish(ctx context.Context, e sharedDomain.Event) error
}

// Now — функция возвращающая текущее время; testable.
type Now func() time.Time

// AddFriend — POST /friends/request.
type AddFriend struct {
	Repo  domain.FriendRepo
	Codes domain.FriendCodeRepo
	Bus   Bus
	Log   *slog.Logger
	Now   Now
}

// AddInput — варианты способа подружиться: либо UserID, либо Code.
type AddInput struct {
	UserID *uuid.UUID
	Code   string
}

// Do выполняет добавление в друзья. Возвращает Friendship и (если новая) —
// publish'ит RequestReceived.
func (uc *AddFriend) Do(ctx context.Context, requester uuid.UUID, in AddInput) (domain.Friendship, error) {
	target, err := uc.resolve(ctx, in)
	if err != nil {
		return domain.Friendship{}, err
	}
	if target == requester {
		return domain.Friendship{}, domain.ErrSelfFriendship
	}
	f, err := uc.Repo.Add(ctx, requester, target)
	if err != nil {
		// уже существует — это не fatal: фронт показывает «вы уже друзья» /
		// «вы уже отправляли запрос».
		if errors.Is(err, domain.ErrAlreadyExists) {
			return f, fmt.Errorf("AddFriend.Add: %w", err)
		}
		return domain.Friendship{}, fmt.Errorf("AddFriend.Add: %w", err)
	}
	if uc.Bus != nil {
		now := time.Now().UTC()
		if uc.Now != nil {
			now = uc.Now()
		}
		_ = uc.Bus.Publish(ctx, domain.FriendRequestReceived{
			At:              now,
			RequesterID:     requester,
			AddresseeID:     target,
			FriendshipIDVal: f.ID,
		})
	}
	return f, nil
}

func (uc *AddFriend) resolve(ctx context.Context, in AddInput) (uuid.UUID, error) {
	if in.UserID != nil {
		return *in.UserID, nil
	}
	if in.Code == "" {
		return uuid.Nil, errors.New("AddFriend: need user_id or code")
	}
	if uc.Codes == nil {
		return uuid.Nil, errors.New("AddFriend: codes repo not wired")
	}
	uid, err := uc.Codes.Resolve(ctx, in.Code)
	if err != nil {
		return uuid.Nil, fmt.Errorf("AddFriend.Resolve: %w", err)
	}
	return uid, nil
}

// AcceptFriend — POST /friends/{id}/accept.
type AcceptFriend struct {
	Repo domain.FriendRepo
	Bus  Bus
	Log  *slog.Logger
	Now  Now
}

// Do принимает заявку. Возвращает обновлённую friendship.
func (uc *AcceptFriend) Do(ctx context.Context, id int64, byUser uuid.UUID) (domain.Friendship, error) {
	f, err := uc.Repo.Accept(ctx, id, byUser)
	if err != nil {
		return domain.Friendship{}, fmt.Errorf("AcceptFriend.Accept: %w", err)
	}
	if uc.Bus != nil {
		now := time.Now().UTC()
		if uc.Now != nil {
			now = uc.Now()
		}
		_ = uc.Bus.Publish(ctx, domain.FriendRequestAccepted{
			At: now, RequesterID: f.RequesterID, AddresseeID: f.AddresseeID,
		})
	}
	return f, nil
}

// DeclineFriend — POST /friends/{id}/decline.
type DeclineFriend struct {
	Repo domain.FriendRepo
}

// Do отклоняет заявку.
func (uc *DeclineFriend) Do(ctx context.Context, id int64, byUser uuid.UUID) error {
	if err := uc.Repo.Decline(ctx, id, byUser); err != nil {
		return fmt.Errorf("DeclineFriend.Decline: %w", err)
	}
	return nil
}

// BlockUser — POST /friends/{user_id}/block.
type BlockUser struct {
	Repo domain.FriendRepo
}

// Do блокирует пользователя.
func (uc *BlockUser) Do(ctx context.Context, byUser, target uuid.UUID) error {
	if err := uc.Repo.Block(ctx, byUser, target); err != nil {
		return fmt.Errorf("BlockUser.Block: %w", err)
	}
	return nil
}

// UnblockUser — DELETE /friends/{user_id}/block.
type UnblockUser struct {
	Repo domain.FriendRepo
}

// Do разблокирует.
func (uc *UnblockUser) Do(ctx context.Context, byUser, target uuid.UUID) error {
	if err := uc.Repo.Unblock(ctx, byUser, target); err != nil {
		return fmt.Errorf("UnblockUser.Unblock: %w", err)
	}
	return nil
}

// Unfriend — DELETE /friends/{user_id}.
type Unfriend struct {
	Repo domain.FriendRepo
}

// Do удаляет дружбу.
func (uc *Unfriend) Do(ctx context.Context, byUser, friend uuid.UUID) error {
	if err := uc.Repo.Remove(ctx, byUser, friend); err != nil {
		return fmt.Errorf("Unfriend.Remove: %w", err)
	}
	return nil
}

// GetMyCode — GET /friends/code.
type GetMyCode struct {
	Codes domain.FriendCodeRepo
}

// Do генерирует/возвращает.
func (uc *GetMyCode) Do(ctx context.Context, uid uuid.UUID) (domain.FriendCode, error) {
	c, err := uc.Codes.Generate(ctx, uid)
	if err != nil {
		return c, fmt.Errorf("GetMyCode.Generate: %w", err)
	}
	return c, nil
}

// FriendList — DTO для GET /friends.
type FriendList struct {
	Accepted    []FriendDTO
	OnlineCount int
	Total       int
}

// FriendDTO — обогащённая запись с online-флагом.
type FriendDTO struct {
	UserID       uuid.UUID
	Username     string
	DisplayName  string
	AvatarURL    string
	Tier         string
	Online       bool
	LastMatchAt  *time.Time
	FriendshipID int64 // 0 для accepted (id не нужен), >0 для pending (для accept/decline)
}

// ListFriends — GET /friends. Подмешивает presence.
type ListFriends struct {
	Repo     domain.FriendRepo
	Presence domain.PresenceProvider
}

// Do возвращает merged DTO.
func (uc *ListFriends) Do(ctx context.Context, uid uuid.UUID) (FriendList, error) {
	rows, err := uc.Repo.ListAccepted(ctx, uid)
	if err != nil {
		return FriendList{}, fmt.Errorf("ListFriends: %w", err)
	}
	out := FriendList{Accepted: make([]FriendDTO, 0, len(rows))}
	for _, r := range rows {
		dto := toFriendDTO(r, uc.Presence, ctx)
		out.Accepted = append(out.Accepted, dto)
		if dto.Online {
			out.OnlineCount++
		}
	}
	out.Total = len(out.Accepted)
	return out, nil
}

// ListIncoming — GET /friends/incoming.
type ListIncoming struct {
	Repo     domain.FriendRepo
	Presence domain.PresenceProvider
}

// Do возвращает входящие.
func (uc *ListIncoming) Do(ctx context.Context, uid uuid.UUID) ([]FriendDTO, error) {
	rows, err := uc.Repo.ListIncoming(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("ListIncoming: %w", err)
	}
	out := make([]FriendDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, toFriendDTO(r, uc.Presence, ctx))
	}
	return out, nil
}

// ListOutgoing — GET /friends/outgoing.
type ListOutgoing struct {
	Repo     domain.FriendRepo
	Presence domain.PresenceProvider
}

// Do возвращает исходящие.
func (uc *ListOutgoing) Do(ctx context.Context, uid uuid.UUID) ([]FriendDTO, error) {
	rows, err := uc.Repo.ListOutgoing(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("ListOutgoing: %w", err)
	}
	out := make([]FriendDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, toFriendDTO(r, uc.Presence, ctx))
	}
	return out, nil
}

// ListBlocked — GET /friends/blocked.
type ListBlocked struct {
	Repo domain.FriendRepo
}

// Do возвращает blocked.
func (uc *ListBlocked) Do(ctx context.Context, uid uuid.UUID) ([]FriendDTO, error) {
	rows, err := uc.Repo.ListBlocked(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("ListBlocked: %w", err)
	}
	out := make([]FriendDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, toFriendDTO(r, domain.AlwaysOffline{}, ctx))
	}
	return out, nil
}

// ListSuggestions — POST /friends/suggestions.
type ListSuggestions struct {
	Repo domain.FriendRepo
}

// Do возвращает suggestions (без presence — они не в friends list).
func (uc *ListSuggestions) Do(ctx context.Context, uid uuid.UUID) ([]FriendDTO, error) {
	rows, err := uc.Repo.Suggestions(ctx, uid, 5)
	if err != nil {
		return nil, fmt.Errorf("ListSuggestions: %w", err)
	}
	out := make([]FriendDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, toFriendDTO(r, domain.AlwaysOffline{}, ctx))
	}
	return out, nil
}

func toFriendDTO(r domain.FriendListEntry, pres domain.PresenceProvider, ctx context.Context) FriendDTO {
	online := false
	if pres != nil {
		online = pres.IsOnline(ctx, r.UserID)
	}
	dto := FriendDTO{
		UserID:      r.UserID,
		Username:    r.Username,
		DisplayName: r.DisplayName,
		AvatarURL:   r.AvatarFrame, // Frame — самое близкое к аватарке в profiles
		Tier:        r.Tier,
		Online:      online,
		LastMatchAt: r.LastMatchAt,
	}
	return dto
}
