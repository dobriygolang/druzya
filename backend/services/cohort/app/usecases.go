// Package app holds use case stubs for cohorts.
package app

import (
	"context"
	"log/slog"
	"time"

	"druz9/cohort/domain"

	"github.com/google/uuid"
)

// CreateCohort use case stub.
type CreateCohort struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewCreateCohort constructs the use case. Panics on nil logger.
func NewCreateCohort(r domain.Repo, log *slog.Logger) *CreateCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewCreateCohort")
	}
	return &CreateCohort{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/cohorts.md
func (uc *CreateCohort) Do(_ context.Context, _ uuid.UUID, _ string, _ time.Time) (uuid.UUID, error) {
	return uuid.Nil, domain.ErrNotImplemented
}

// JoinCohort use case stub (invite-token entry).
type JoinCohort struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewJoinCohort constructs the use case.
func NewJoinCohort(r domain.Repo, log *slog.Logger) *JoinCohort {
	if log == nil {
		panic("cohort/app: nil logger passed to NewJoinCohort")
	}
	return &JoinCohort{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/cohorts.md
func (uc *JoinCohort) Do(_ context.Context, _ uuid.UUID, _ string) (uuid.UUID, error) {
	return uuid.Nil, domain.ErrNotImplemented
}

// GetLeaderboard use case stub.
type GetLeaderboard struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewGetLeaderboard constructs the use case.
func NewGetLeaderboard(r domain.Repo, log *slog.Logger) *GetLeaderboard {
	if log == nil {
		panic("cohort/app: nil logger passed to NewGetLeaderboard")
	}
	return &GetLeaderboard{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/cohorts.md
//
// Anti-fallback: when implemented, MUST return [] for empty cohorts; do
// NOT pad with platform averages or auto-injected sample members.
func (uc *GetLeaderboard) Do(_ context.Context, _ uuid.UUID, _ string) ([]domain.MemberStanding, error) {
	return nil, domain.ErrNotImplemented
}

// IssueInvite use case stub.
type IssueInvite struct {
	Repo domain.Repo
	Log  *slog.Logger
}

// NewIssueInvite constructs the use case.
func NewIssueInvite(r domain.Repo, log *slog.Logger) *IssueInvite {
	if log == nil {
		panic("cohort/app: nil logger passed to NewIssueInvite")
	}
	return &IssueInvite{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/cohorts.md
func (uc *IssueInvite) Do(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ int, _ time.Duration) (string, error) {
	return "", domain.ErrNotImplemented
}
