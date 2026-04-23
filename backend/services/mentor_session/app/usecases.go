// Package app holds use case stubs for mentor_session.
//
// STRATEGIC SCAFFOLD: every use case returns domain.ErrNotImplemented;
// escrow operations panic to make the missing payment plumbing loud.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/mentor_session/domain"

	"github.com/google/uuid"
)

// RequestSession use case stub.
type RequestSession struct {
	Sessions domain.SessionRepo
	Log      *slog.Logger
}

// NewRequestSession constructs the use case. Panics on nil logger.
func NewRequestSession(r domain.SessionRepo, log *slog.Logger) *RequestSession {
	if log == nil {
		panic("mentor_session/app: nil logger passed to NewRequestSession")
	}
	return &RequestSession{Sessions: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md
func (uc *RequestSession) Do(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ time.Time, _ int) (uuid.UUID, error) {
	return uuid.Nil, domain.ErrNotImplemented
}

// AcceptSession use case stub.
type AcceptSession struct {
	Sessions domain.SessionRepo
	Log      *slog.Logger
}

// NewAcceptSession constructs the use case.
func NewAcceptSession(r domain.SessionRepo, log *slog.Logger) *AcceptSession {
	if log == nil {
		panic("mentor_session/app: nil logger passed to NewAcceptSession")
	}
	return &AcceptSession{Sessions: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md
func (uc *AcceptSession) Do(_ context.Context, _ uuid.UUID) error {
	return domain.ErrNotImplemented
}

// CompleteSession use case stub.
type CompleteSession struct {
	Sessions domain.SessionRepo
	Log      *slog.Logger
}

// NewCompleteSession constructs the use case.
func NewCompleteSession(r domain.SessionRepo, log *slog.Logger) *CompleteSession {
	if log == nil {
		panic("mentor_session/app: nil logger passed to NewCompleteSession")
	}
	return &CompleteSession{Sessions: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md
func (uc *CompleteSession) Do(_ context.Context, _ uuid.UUID) error {
	return domain.ErrNotImplemented
}

// ReleaseEscrow — Phase 2 only. Panics in Phase 1 to fail loudly if a
// caller mistakenly thinks the marketplace is monetised.
//
// STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md §4
func ReleaseEscrow(_ context.Context, _ uuid.UUID) error {
	panic("mentor_session: escrow not implemented; see docs/strategic/mentor-marketplace.md Phase 2")
}

// RefundEscrow — Phase 2 only. Panics in Phase 1.
//
// STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md §4
func RefundEscrow(_ context.Context, _ uuid.UUID) error {
	panic("mentor_session: escrow not implemented; see docs/strategic/mentor-marketplace.md Phase 2")
}

// ListMentors directory use case stub.
type ListMentors struct {
	Dir domain.DirectoryRepo
	Log *slog.Logger
}

// NewListMentors constructs the use case.
func NewListMentors(d domain.DirectoryRepo, log *slog.Logger) *ListMentors {
	if log == nil {
		panic("mentor_session/app: nil logger passed to NewListMentors")
	}
	return &ListMentors{Dir: d, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/mentor-marketplace.md
func (uc *ListMentors) Do(_ context.Context, _ string, _ int) ([]domain.MentorCard, error) {
	return nil, domain.ErrNotImplemented
}
