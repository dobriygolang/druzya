package domain

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestInvite_Status(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	expires := now.Add(24 * time.Hour)
	tutorID := uuid.New()
	studentID := uuid.New()

	cases := []struct {
		name string
		inv  Invite
		at   time.Time
		want InviteStatus
	}{
		{
			name: "active within ttl",
			inv:  Invite{TutorID: tutorID, ExpiresAt: expires},
			at:   now,
			want: InviteStatusActive,
		},
		{
			name: "expired past ttl",
			inv:  Invite{TutorID: tutorID, ExpiresAt: now.Add(-time.Hour)},
			at:   now,
			want: InviteStatusExpired,
		},
		{
			name: "accepted wins over expired",
			inv: Invite{
				TutorID:    tutorID,
				ExpiresAt:  now.Add(-time.Hour), // would be expired
				AcceptedAt: ptrTime(now.Add(-30 * time.Minute)),
				AcceptedBy: &studentID,
			},
			at:   now,
			want: InviteStatusAccepted,
		},
		{
			name: "revoked wins over active",
			inv: Invite{
				TutorID:   tutorID,
				ExpiresAt: expires,
				RevokedAt: ptrTime(now.Add(-time.Minute)),
			},
			at:   now,
			want: InviteStatusRevoked,
		},
		{
			name: "accepted wins over revoked (rare race-state)",
			inv: Invite{
				TutorID:    tutorID,
				ExpiresAt:  expires,
				AcceptedAt: ptrTime(now.Add(-time.Hour)),
				RevokedAt:  ptrTime(now.Add(-30 * time.Minute)),
			},
			at:   now,
			want: InviteStatusAccepted,
		},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := c.inv.Status(c.at); got != c.want {
				t.Errorf("Status = %v, want %v", got, c.want)
			}
		})
	}
}

func TestInvite_IsActive(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	if !(Invite{ExpiresAt: now.Add(time.Hour)}).IsActive(now) {
		t.Error("fresh invite must be active")
	}
	if (Invite{ExpiresAt: now.Add(-time.Hour)}).IsActive(now) {
		t.Error("expired must not be active")
	}
	if (Invite{ExpiresAt: now.Add(time.Hour), RevokedAt: ptrTime(now)}).IsActive(now) {
		t.Error("revoked must not be active")
	}
	if (Invite{ExpiresAt: now.Add(time.Hour), AcceptedAt: ptrTime(now)}).IsActive(now) {
		t.Error("accepted must not be active")
	}
}

func TestRelationship_IsActive(t *testing.T) {
	t.Parallel()
	now := time.Now()
	if !(Relationship{}).IsActive() {
		t.Error("relationship with no ended_at must be active")
	}
	if (Relationship{EndedAt: &now}).IsActive() {
		t.Error("relationship with ended_at must NOT be active")
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
