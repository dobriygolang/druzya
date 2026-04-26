// Package app holds the whiteboard_rooms use cases. Thin orchestrators over
// the domain repos — mirrors the editor/podcast split so reviewers can
// move between services without re-learning layout.
package app

import (
	"context"
	"fmt"
	"time"

	"druz9/whiteboard_rooms/domain"

	"github.com/google/uuid"
)

// Handlers bundles the four use cases. Wired in monolith services/.
type Handlers struct {
	Rooms        domain.RoomRepo
	Participants domain.ParticipantRepo
	Now          func() time.Time
}

// NewHandlers — constructor, defaults Now to time.Now.
func NewHandlers(rooms domain.RoomRepo, parts domain.ParticipantRepo) *Handlers {
	return &Handlers{Rooms: rooms, Participants: parts, Now: time.Now}
}

// CreateRoom mints a new room owned by the caller and auto-adds them as
// the first participant.
func (h *Handlers) CreateRoom(ctx context.Context, ownerID uuid.UUID, title string) (domain.Room, error) {
	now := h.Now().UTC()
	room := domain.Room{
		ID:        uuid.New(),
		OwnerID:   ownerID,
		Title:     title,
		ExpiresAt: now.Add(domain.DefaultTTL),
		CreatedAt: now,
		UpdatedAt: now,
	}
	saved, err := h.Rooms.Create(ctx, room)
	if err != nil {
		return domain.Room{}, fmt.Errorf("rooms.Create: %w", err)
	}
	if _, err := h.Participants.Add(ctx, domain.Participant{
		RoomID:   saved.ID,
		UserID:   ownerID,
		JoinedAt: now,
	}); err != nil {
		return domain.Room{}, fmt.Errorf("participants.Add: %w", err)
	}
	return saved, nil
}

// GetRoom returns the room with participants. Auto-joins the caller as a
// participant on first access — matches editor semantics where a room URL
// is the invite.
type RoomWithParticipants struct {
	Room         domain.Room
	Participants []domain.ParticipantWithUsername
}

// GetRoomOpts — caller-side context. callerRole='guest' пропускает
// auto-join (Wave-15: guest user_id transient, FK на users(id) сломал бы
// participants.Add). Прочие role'ы — registered users — auto-join'ятся
// как раньше.
type GetRoomOpts struct {
	CallerRole string
}

// GetRoom — backwards-compatible signature. Использует пустой opts
// (registered user behaviour). Новые call-site'ы должны звать
// GetRoomWithOpts с явной ролью.
func (h *Handlers) GetRoom(ctx context.Context, roomID, callerID uuid.UUID) (RoomWithParticipants, error) {
	return h.GetRoomWithOpts(ctx, roomID, callerID, GetRoomOpts{})
}

// GetRoomWithOpts — основная реализация.
func (h *Handlers) GetRoomWithOpts(ctx context.Context, roomID, callerID uuid.UUID, opts GetRoomOpts) (RoomWithParticipants, error) {
	room, err := h.Rooms.Get(ctx, roomID)
	if err != nil {
		return RoomWithParticipants{}, fmt.Errorf("rooms.Get: %w", err)
	}
	if h.Now().UTC().After(room.ExpiresAt) {
		return RoomWithParticipants{}, domain.ErrExpired
	}
	// Visibility=private gate: только owner может join'иться. Иначе любой со
	// ссылкой автоматически становится participant'ом ниже (auto-join по
	// share-link UX). При private — share-link отключён.
	if room.Visibility == domain.VisibilityPrivate && callerID != room.OwnerID {
		// Если caller уже participant (был invited когда было shared, потом
		// owner flipped private) — не вырезаем его, но guest'ам/новичкам
		// возвращаем 403.
		alreadyMember, existsErr := h.Participants.Exists(ctx, roomID, callerID)
		if existsErr != nil {
			return RoomWithParticipants{}, fmt.Errorf("participants.Exists: %w", existsErr)
		}
		if !alreadyMember {
			return RoomWithParticipants{}, domain.ErrForbidden
		}
	}
	// Auto-join: share-link UX — первый заход === приглашение (только для
	// shared visibility, см. private gate выше).
	//
	// SKIP для guest'ов (Wave-15): guest user_id — transient UUID не из
	// users table; participants.user_id ссылается на users(id) с FK,
	// INSERT падает на FK violation. Гости получают view-only доступ
	// БЕЗ записи в participants — их presence отслеживается через
	// awareness в WS, а не через DB-table.
	if opts.CallerRole != "guest" {
		exists, exErr := h.Participants.Exists(ctx, roomID, callerID)
		if exErr != nil {
			return RoomWithParticipants{}, fmt.Errorf("participants.Exists: %w", exErr)
		}
		if !exists {
			if _, addErr := h.Participants.Add(ctx, domain.Participant{
				RoomID:   roomID,
				UserID:   callerID,
				JoinedAt: h.Now().UTC(),
			}); addErr != nil {
				return RoomWithParticipants{}, fmt.Errorf("participants.Add: %w", addErr)
			}
		}
	}
	parts, err := h.Participants.List(ctx, roomID)
	if err != nil {
		return RoomWithParticipants{}, fmt.Errorf("participants.List: %w", err)
	}
	return RoomWithParticipants{Room: room, Participants: parts}, nil
}

// ListMyRooms returns rooms where the caller participates and which
// haven't expired yet.
func (h *Handlers) ListMyRooms(ctx context.Context, userID uuid.UUID) ([]domain.Room, error) {
	rooms, err := h.Rooms.ListByUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("rooms.ListByUser: %w", err)
	}
	now := h.Now().UTC()
	out := make([]domain.Room, 0, len(rooms))
	for _, r := range rooms {
		if r.ExpiresAt.After(now) {
			out = append(out, r)
		}
	}
	return out, nil
}

// DeleteRoom removes the room. Owner-only.
func (h *Handlers) DeleteRoom(ctx context.Context, roomID, callerID uuid.UUID) error {
	room, err := h.Rooms.Get(ctx, roomID)
	if err != nil {
		return fmt.Errorf("rooms.Get: %w", err)
	}
	if room.OwnerID != callerID {
		return domain.ErrForbidden
	}
	if err := h.Rooms.Delete(ctx, roomID); err != nil {
		return fmt.Errorf("rooms.Delete: %w", err)
	}
	return nil
}

// PersistSnapshot stores the merged Yjs update. Called by the hub on a
// debounce timer — not directly by the API.
func (h *Handlers) PersistSnapshot(ctx context.Context, roomID uuid.UUID, snapshot []byte) error {
	newExpires := h.Now().UTC().Add(domain.DefaultTTL)
	if err := h.Rooms.UpdateSnapshot(ctx, roomID, snapshot, newExpires); err != nil {
		return fmt.Errorf("rooms.UpdateSnapshot: %w", err)
	}
	return nil
}
