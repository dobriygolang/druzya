package infra

import (
	"context"
	"fmt"

	"druz9/slot/domain"

	"github.com/google/uuid"
)

// MockMeetRoom is the STUB implementation of domain.MeetRoomProvider.
// It returns a deterministic mock URL of the shape
// `https://meet.google.com/mock-{slotID}`.
//
// STUB: the real implementation will exchange the interviewer's Google OAuth
// token for a Google Calendar event with an auto-generated Meet link. The
// interface contract — one call per booking, idempotent on slotID — is
// designed to accommodate that future work without churning callers.
type MockMeetRoom struct{}

// NewMockMeetRoom returns the stub provider.
func NewMockMeetRoom() *MockMeetRoom { return &MockMeetRoom{} }

// GenerateMeetURL returns a deterministic URL for the slot.
func (*MockMeetRoom) GenerateMeetURL(_ context.Context, slotID uuid.UUID) (string, error) {
	return fmt.Sprintf("https://meet.google.com/mock-%s", slotID.String()), nil
}

var _ domain.MeetRoomProvider = (*MockMeetRoom)(nil)
