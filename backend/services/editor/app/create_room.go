// Package app contains the editor use cases. Each handler is a thin
// orchestrator — persistence lives in infra/, rules in domain/.
//
// The domain does NOT import other domains' packages; inter-domain needs
// (e.g. task lookup) go through the narrow TaskRepo interface defined in
// domain/repo.go.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/editor/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// CreateRoom implements POST /api/v1/editor/room.
type CreateRoom struct {
	Rooms        domain.RoomRepo
	Participants domain.ParticipantRepo
	Log          *slog.Logger
	Now          func() time.Time
	// RoomTTL is how long until the room expires by default.
	RoomTTL time.Duration
}

// CreateRoomInput is the use-case payload.
type CreateRoomInput struct {
	OwnerID  uuid.UUID
	Type     domain.RoomType
	TaskID   *uuid.UUID
	Language enums.Language
}

// CreateRoomOutput is the result of a successful create.
type CreateRoomOutput struct {
	Room         domain.Room
	Participants []domain.Participant
}

// Do creates a room, inserts the caller as owner + interviewer, and returns
// the hydrated state. "Interview"-type rooms treat the caller as the
// interviewer role directly; practice/pair_mock use owner for the first
// row (enums.EditorRole can carry only one value per participant).
func (uc *CreateRoom) Do(ctx context.Context, in CreateRoomInput) (CreateRoomOutput, error) {
	roomType := in.Type
	if roomType == "" {
		roomType = domain.RoomTypePractice
	}
	if err := domain.ValidateCreate(roomType, in.Language); err != nil {
		return CreateRoomOutput{}, fmt.Errorf("editor.CreateRoom: %w", err)
	}

	ttl := uc.RoomTTL
	if ttl <= 0 {
		ttl = domain.DefaultRoomTTL
	}
	now := uc.now()
	r := domain.Room{
		OwnerID:   in.OwnerID,
		Type:      roomType,
		TaskID:    in.TaskID,
		Language:  in.Language,
		IsFrozen:  false,
		ExpiresAt: now.Add(ttl),
	}
	created, err := uc.Rooms.Create(ctx, r)
	if err != nil {
		return CreateRoomOutput{}, fmt.Errorf("editor.CreateRoom: persist: %w", err)
	}

	// Seed participant rows. The creator always lands as owner; for an
	// interview-type room they also fill the interviewer slot implicitly via
	// the role-check in CanEdit (owner bypasses freeze the same way).
	ownerRow, err := uc.Participants.Add(ctx, domain.Participant{
		RoomID: created.ID,
		UserID: in.OwnerID,
		Role:   enums.EditorRoleOwner,
	})
	if err != nil {
		return CreateRoomOutput{}, fmt.Errorf("editor.CreateRoom: seed owner: %w", err)
	}

	return CreateRoomOutput{Room: created, Participants: []domain.Participant{ownerRow}}, nil
}

func (uc *CreateRoom) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}
