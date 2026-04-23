// Package app holds use case stubs for the orgs bounded context.
//
// STRATEGIC SCAFFOLD: every method returns domain.ErrNotImplemented.
// See ../README.md and docs/strategic/b2b-hrtech.md.
package app

import (
	"context"
	"log/slog"

	"druz9/orgs/domain"

	"github.com/google/uuid"
)

// CreateOrg use case stub.
type CreateOrg struct {
	Repo domain.OrgRepo
	Log  *slog.Logger
}

// NewCreateOrg constructs the use case. Panics if Log is nil — anti-fallback
// policy: nil logger means a wiring bug, never silently use slog.Default().
func NewCreateOrg(r domain.OrgRepo, log *slog.Logger) *CreateOrg {
	if log == nil {
		panic("orgs/app: nil logger passed to NewCreateOrg")
	}
	return &CreateOrg{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (uc *CreateOrg) Do(_ context.Context, _ string, _ string, _ uuid.UUID) (uuid.UUID, error) {
	return uuid.Nil, domain.ErrNotImplemented
}

// AssignSeat use case stub.
type AssignSeat struct {
	Repo domain.OrgRepo
	Log  *slog.Logger
}

// NewAssignSeat constructs the use case.
func NewAssignSeat(r domain.OrgRepo, log *slog.Logger) *AssignSeat {
	if log == nil {
		panic("orgs/app: nil logger passed to NewAssignSeat")
	}
	return &AssignSeat{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (uc *AssignSeat) Do(_ context.Context, _ uuid.UUID, _ string) (uuid.UUID, error) {
	return uuid.Nil, domain.ErrNotImplemented
}

// RevokeSeat use case stub.
type RevokeSeat struct {
	Repo domain.OrgRepo
	Log  *slog.Logger
}

// NewRevokeSeat constructs the use case.
func NewRevokeSeat(r domain.OrgRepo, log *slog.Logger) *RevokeSeat {
	if log == nil {
		panic("orgs/app: nil logger passed to NewRevokeSeat")
	}
	return &RevokeSeat{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (uc *RevokeSeat) Do(_ context.Context, _ uuid.UUID) error {
	return domain.ErrNotImplemented
}

// GetDashboard use case stub.
type GetDashboard struct {
	Repo domain.OrgRepo
	Log  *slog.Logger
}

// NewGetDashboard constructs the use case.
func NewGetDashboard(r domain.OrgRepo, log *slog.Logger) *GetDashboard {
	if log == nil {
		panic("orgs/app: nil logger passed to NewGetDashboard")
	}
	return &GetDashboard{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/b2b-hrtech.md
func (uc *GetDashboard) Do(_ context.Context, _ uuid.UUID, _ string) (domain.DashboardSnapshot, error) {
	return domain.DashboardSnapshot{}, domain.ErrNotImplemented
}
