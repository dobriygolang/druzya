package app

import (
	"context"
	"fmt"
	"time"

	"druz9/editor/domain"

	"github.com/google/uuid"
)

// CreateInvite implements POST /api/v1/editor/room/{roomId}/invite.
//
// Invites are HMAC-signed tokens (stateless) — see domain.GenerateInviteToken.
// Only the owner can mint an invite.
type CreateInvite struct {
	Rooms  domain.RoomRepo
	Secret []byte
	TTL    time.Duration
	// BaseURL is the frontend origin; the invite URL has the shape
	// `{BaseURL}/editor/{roomID}/join?token={tok}`.
	BaseURL string
	Now     func() time.Time
}

// CreateInviteInput is the payload.
type CreateInviteInput struct {
	RoomID  uuid.UUID
	CallerID uuid.UUID
}

// Do validates caller ownership and returns an invite link + expiry.
func (uc *CreateInvite) Do(ctx context.Context, in CreateInviteInput) (domain.InviteLink, error) {
	room, err := uc.Rooms.Get(ctx, in.RoomID)
	if err != nil {
		return domain.InviteLink{}, fmt.Errorf("editor.CreateInvite: %w", err)
	}
	if room.OwnerID != in.CallerID {
		return domain.InviteLink{}, fmt.Errorf("editor.CreateInvite: %w", domain.ErrForbidden)
	}
	ttl := uc.TTL
	if ttl <= 0 {
		ttl = domain.DefaultInviteTTL
	}
	now := uc.now()
	tok, expires, err := domain.GenerateInviteToken(in.RoomID, ttl, uc.Secret, now)
	if err != nil {
		return domain.InviteLink{}, fmt.Errorf("editor.CreateInvite: %w", err)
	}
	base := uc.BaseURL
	if base == "" {
		base = "https://druz9.online"
	}
	url := fmt.Sprintf("%s/editor/%s/join?token=%s", base, in.RoomID, tok)
	return domain.InviteLink{URL: url, Token: tok, ExpiresAt: expires}, nil
}

func (uc *CreateInvite) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}
