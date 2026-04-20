package domain

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// CanEdit returns true when the given role is allowed to mutate the CRDT
// state of a room.
//
// Rules (bible §3.1):
//   - viewer    — read-only; never edits.
//   - owner     — can always edit.
//   - interviewer — can always edit (they drive the interview, even while frozen).
//   - participant — can edit only when the room is NOT frozen.
//
// `exhaustive` over enums.EditorRole.
func CanEdit(role enums.EditorRole, frozen bool) bool {
	switch role {
	case enums.EditorRoleOwner, enums.EditorRoleInterviewer:
		return true
	case enums.EditorRoleParticipant:
		return !frozen
	case enums.EditorRoleViewer:
		return false
	}
	return false
}

// RoleForInvitee decides the role the invitee receives when they accept.
// Rules mirror the bible:
//   - practice rooms: everyone is a participant.
//   - interview rooms: first non-owner is interviewer, others are participant.
//   - pair_mock rooms: both sides are participant.
//
// `inviterRole` is the role of the caller creating the invite — reserved for
// future "viewer invites" (spectator STUB).
func RoleForInvitee(room Room, inviterRole enums.EditorRole, existing []Participant) enums.EditorRole {
	switch room.Type {
	case RoomTypeInterview:
		// First non-owner slot becomes interviewer.
		hasInterviewer := false
		for _, p := range existing {
			if p.Role == enums.EditorRoleInterviewer {
				hasInterviewer = true
				break
			}
		}
		if !hasInterviewer {
			return enums.EditorRoleInterviewer
		}
		return enums.EditorRoleParticipant
	case RoomTypePairMock, RoomTypePractice:
		return enums.EditorRoleParticipant
	}
	// Defensive fallback: viewer. STUB — spectator role is scope-cut for MVP
	// but the enum value is reserved here.
	_ = inviterRole
	return enums.EditorRoleViewer
}

// ─────────────────────────────────────────────────────────────────────────
// Invite token — HMAC-SHA256, stateless.
//
// Format (base64url, no padding): roomID "." expiresUnix "." signature
//
//   sig = HMAC_SHA256(secret, roomID "." expiresUnix)
//
// This keeps the invite stateless (no Redis round-trip on accept) while
// still cryptographically bound to the room + TTL.
// ─────────────────────────────────────────────────────────────────────────

// GenerateInviteToken HMAC-signs a token for the given room + TTL.
//
// Empty secret yields ErrInvalidInvite — we refuse to mint tokens without a
// server secret to avoid trivially-forgeable links in misconfigured envs.
func GenerateInviteToken(roomID uuid.UUID, ttl time.Duration, secret []byte, now time.Time) (string, time.Time, error) {
	if len(secret) == 0 {
		return "", time.Time{}, ErrInvalidInvite
	}
	if ttl <= 0 {
		return "", time.Time{}, fmt.Errorf("editor.GenerateInviteToken: %w", errors.New("ttl must be positive"))
	}
	exp := now.Add(ttl)
	raw := roomID.String() + "." + strconv.FormatInt(exp.Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(raw))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return raw + "." + sig, exp, nil
}

// ValidateInviteToken verifies the HMAC and expiry of an invite token.
// Returns the room id it's bound to. Constant-time compare on the signature
// avoids timing leaks.
func ValidateInviteToken(token string, secret []byte, now time.Time) (uuid.UUID, error) {
	if len(secret) == 0 || token == "" {
		return uuid.Nil, ErrInvalidInvite
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return uuid.Nil, ErrInvalidInvite
	}
	rid, err := uuid.Parse(parts[0])
	if err != nil {
		return uuid.Nil, ErrInvalidInvite
	}
	expUnix, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return uuid.Nil, ErrInvalidInvite
	}
	if now.Unix() >= expUnix {
		return uuid.Nil, ErrInvalidInvite
	}
	raw := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(raw))
	wantSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(wantSig), []byte(parts[2])) {
		return uuid.Nil, ErrInvalidInvite
	}
	return rid, nil
}

// ValidateCreate enforces the openapi constraints before the use case
// touches the DB.
func ValidateCreate(roomType RoomType, lang enums.Language) error {
	// roomType is optional in the openapi — empty means "practice".
	if roomType != "" && !roomType.IsValid() {
		return fmt.Errorf("editor.ValidateCreate: invalid room type %q", roomType)
	}
	if !lang.IsValid() {
		return fmt.Errorf("editor.ValidateCreate: invalid language %q", lang)
	}
	return nil
}

// DefaultRoomTTL is the lifespan of a fresh room before it expires.
// Bible §5: "долгоживущие соединения (30-60 мин)". Rooms outlive any single
// connection — we give 6 hours so users can come back after a break.
const DefaultRoomTTL = 6 * time.Hour

// DefaultInviteTTL is how long an invite URL remains valid.
const DefaultInviteTTL = 24 * time.Hour

// DefaultReplayTTL matches MinIO presigned URL TTL for replays.
// Bible §3.1: "TTL 1h".
const DefaultReplayTTL = 1 * time.Hour
