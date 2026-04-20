package domain

import (
	"strings"
	"testing"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ─────────────────────────────────────────────────────────────────────────
// Freeze gate — the single most load-bearing predicate for WS op dispatch.
// ─────────────────────────────────────────────────────────────────────────

func TestCanEdit_FreezeGateByRole(t *testing.T) {
	t.Parallel()
	cases := []struct {
		role    enums.EditorRole
		frozen  bool
		canEdit bool
	}{
		{enums.EditorRoleOwner, false, true},
		{enums.EditorRoleOwner, true, true}, // owner bypasses freeze
		{enums.EditorRoleInterviewer, false, true},
		{enums.EditorRoleInterviewer, true, true}, // interviewer bypasses freeze
		{enums.EditorRoleParticipant, false, true},
		{enums.EditorRoleParticipant, true, false}, // participant blocked when frozen
		{enums.EditorRoleViewer, false, false},     // viewer never writes
		{enums.EditorRoleViewer, true, false},
	}
	for _, c := range cases {
		got := CanEdit(c.role, c.frozen)
		if got != c.canEdit {
			t.Fatalf("CanEdit(%q, frozen=%v) = %v, want %v", c.role, c.frozen, got, c.canEdit)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Invite token round-trip.
// ─────────────────────────────────────────────────────────────────────────

func TestInviteToken_RoundTrip(t *testing.T) {
	t.Parallel()
	secret := []byte("THE-SERVER-INVITE-SECRET")
	room := uuid.New()
	now := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)

	tok, exp, err := GenerateInviteToken(room, 2*time.Hour, secret, now)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if !exp.After(now) {
		t.Fatalf("expires_at must be after now")
	}
	if strings.Count(tok, ".") != 2 {
		t.Fatalf("token should have three segments, got %q", tok)
	}

	gotRoom, err := ValidateInviteToken(tok, secret, now.Add(30*time.Minute))
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if gotRoom != room {
		t.Fatalf("validate returned %v, want %v", gotRoom, room)
	}
}

func TestInviteToken_ExpiredRejected(t *testing.T) {
	t.Parallel()
	secret := []byte("S")
	room := uuid.New()
	now := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)

	tok, _, err := GenerateInviteToken(room, 10*time.Minute, secret, now)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	// 11 minutes later: expired.
	if _, err := ValidateInviteToken(tok, secret, now.Add(11*time.Minute)); err == nil {
		t.Fatalf("expected expiry error, got nil")
	}
}

func TestInviteToken_TamperedRejected(t *testing.T) {
	t.Parallel()
	secret := []byte("S")
	room := uuid.New()
	now := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)

	tok, _, err := GenerateInviteToken(room, 1*time.Hour, secret, now)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	// Flip one byte of the signature segment.
	if len(tok) < 2 {
		t.Fatalf("token too short")
	}
	bad := tok[:len(tok)-1] + "A"
	if bad == tok {
		bad = tok[:len(tok)-1] + "B"
	}
	if _, err := ValidateInviteToken(bad, secret, now); err == nil {
		t.Fatalf("expected tamper rejection, got nil")
	}
}

func TestInviteToken_DifferentSecretRejected(t *testing.T) {
	t.Parallel()
	room := uuid.New()
	now := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)

	tok, _, err := GenerateInviteToken(room, 1*time.Hour, []byte("secretA"), now)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if _, err := ValidateInviteToken(tok, []byte("secretB"), now); err == nil {
		t.Fatalf("expected signature mismatch")
	}
}

func TestInviteToken_EmptySecretRefused(t *testing.T) {
	t.Parallel()
	room := uuid.New()
	now := time.Now()
	if _, _, err := GenerateInviteToken(room, 1*time.Hour, nil, now); err == nil {
		t.Fatalf("expected refusal to mint without secret")
	}
	if _, err := ValidateInviteToken("x.y.z", nil, now); err == nil {
		t.Fatalf("expected refusal to validate without secret")
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Role promotion on invite accept.
// ─────────────────────────────────────────────────────────────────────────

func TestRoleForInvitee_InterviewRoomPromotesFirst(t *testing.T) {
	t.Parallel()
	room := Room{Type: RoomTypeInterview}
	// No existing interviewer → first invitee becomes interviewer.
	role := RoleForInvitee(room, enums.EditorRoleOwner, nil)
	if role != enums.EditorRoleInterviewer {
		t.Fatalf("first invitee should be interviewer, got %v", role)
	}
	// Second invitee joins once interviewer slot is filled → participant.
	existing := []Participant{{Role: enums.EditorRoleInterviewer}}
	role = RoleForInvitee(room, enums.EditorRoleOwner, existing)
	if role != enums.EditorRoleParticipant {
		t.Fatalf("second invitee should be participant, got %v", role)
	}
}

func TestRoleForInvitee_PracticeAlwaysParticipant(t *testing.T) {
	t.Parallel()
	room := Room{Type: RoomTypePractice}
	for i := 0; i < 3; i++ {
		role := RoleForInvitee(room, enums.EditorRoleOwner, nil)
		if role != enums.EditorRoleParticipant {
			t.Fatalf("practice invitee should be participant, got %v", role)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────
// ValidateCreate — input hygiene.
// ─────────────────────────────────────────────────────────────────────────

func TestValidateCreate(t *testing.T) {
	t.Parallel()
	// happy path.
	if err := ValidateCreate(RoomTypePractice, enums.LanguageGo); err != nil {
		t.Fatalf("valid input should pass, got %v", err)
	}
	// empty type = practice default; still fine.
	if err := ValidateCreate("", enums.LanguageGo); err != nil {
		t.Fatalf("empty type should be accepted, got %v", err)
	}
	// invalid language must fail.
	if err := ValidateCreate(RoomTypePractice, enums.Language("cobol")); err == nil {
		t.Fatalf("expected language rejection")
	}
	// invalid type must fail.
	if err := ValidateCreate(RoomType("nope"), enums.LanguageGo); err == nil {
		t.Fatalf("expected type rejection")
	}
}
