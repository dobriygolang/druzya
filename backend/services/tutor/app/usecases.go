// Package app contains tutor use cases. Each is a thin orchestrator —
// validation in domain, persistence in infra. The four orientations
// (CreateInvite / RevokeInvite / AcceptInvite / ListStudents) cover
// Tier 1 of docs/feature/tutor.md; full snapshot aggregator and
// pre-session brief land later.
package app

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// CreateInvite — tutor mints a new invitation code.
type CreateInvite struct {
	Repo domain.Repo
	Now  func() time.Time
}

type CreateInviteInput struct {
	TutorID uuid.UUID
	Note    string
}

func (uc *CreateInvite) Do(ctx context.Context, in CreateInviteInput) (domain.Invite, error) {
	if in.TutorID == uuid.Nil {
		return domain.Invite{}, fmt.Errorf("tutor.CreateInvite: %w: tutor_id required", domain.ErrInvalidInput)
	}
	now := uc.now()
	code, err := newInviteCode(domain.InviteCodeLength)
	if err != nil {
		return domain.Invite{}, fmt.Errorf("tutor.CreateInvite: code: %w", err)
	}
	inv := domain.Invite{
		TutorID:   in.TutorID,
		Code:      code,
		Note:      in.Note,
		CreatedAt: now,
		ExpiresAt: now.Add(domain.DefaultInviteTTL),
	}
	saved, err := uc.Repo.CreateInvite(ctx, inv)
	if err != nil {
		return domain.Invite{}, fmt.Errorf("tutor.CreateInvite: %w", err)
	}
	return saved, nil
}

func (uc *CreateInvite) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now().UTC()
}

// RevokeInvite — tutor cancels an outstanding invite.
type RevokeInvite struct {
	Repo domain.Repo
	Now  func() time.Time
}

type RevokeInviteInput struct {
	TutorID  uuid.UUID
	InviteID uuid.UUID
}

func (uc *RevokeInvite) Do(ctx context.Context, in RevokeInviteInput) error {
	if in.TutorID == uuid.Nil || in.InviteID == uuid.Nil {
		return fmt.Errorf("tutor.RevokeInvite: %w", domain.ErrInvalidInput)
	}
	now := nowOr(uc.Now)
	if err := uc.Repo.RevokeInvite(ctx, in.TutorID, in.InviteID, now); err != nil {
		return fmt.Errorf("tutor.RevokeInvite: %w", err)
	}
	return nil
}

// AcceptInvite — student opens /invite/{code} and accepts.
type AcceptInvite struct {
	Repo domain.Repo
	Now  func() time.Time
}

type AcceptInviteInput struct {
	StudentID uuid.UUID
	Code      string
}

func (uc *AcceptInvite) Do(ctx context.Context, in AcceptInviteInput) (domain.Relationship, error) {
	if in.StudentID == uuid.Nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w: student_id required", domain.ErrInvalidInput)
	}
	if strings.TrimSpace(in.Code) == "" {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w: code required", domain.ErrInvalidInput)
	}
	rel, err := uc.Repo.AcceptInvite(ctx, in.Code, in.StudentID, nowOr(uc.Now))
	if err != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptInvite: %w", err)
	}
	return rel, nil
}

// ListInvites — tutor's recent invites for the dashboard.
type ListInvites struct {
	Repo domain.Repo
}

func (uc *ListInvites) Do(ctx context.Context, tutorID uuid.UUID, limit int) ([]domain.Invite, error) {
	if tutorID == uuid.Nil {
		return nil, fmt.Errorf("tutor.ListInvites: %w", domain.ErrInvalidInput)
	}
	if limit <= 0 || limit > 200 {
		limit = 50 // sensible default for the dashboard widget
	}
	out, err := uc.Repo.ListTutorInvites(ctx, tutorID, limit)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListInvites: %w", err)
	}
	return out, nil
}

// ListStudents — tutor's active students.
type ListStudents struct {
	Repo domain.Repo
}

func (uc *ListStudents) Do(ctx context.Context, tutorID uuid.UUID) ([]domain.Relationship, error) {
	if tutorID == uuid.Nil {
		return nil, fmt.Errorf("tutor.ListStudents: %w", domain.ErrInvalidInput)
	}
	out, err := uc.Repo.ListTutorStudents(ctx, tutorID)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListStudents: %w", err)
	}
	return out, nil
}

// PeekInvite — public landing «what does this code open?». Returns
// the invite + a derived status. Used by the /invite/{code} page to
// decide whether to render «Accept» CTA, «expired», or «already
// accepted». Doesn't require the viewer to be the eventual student
// (ноль auth gate в порту тоже — landing public).
type PeekInvite struct {
	Repo domain.Repo
	Now  func() time.Time
}

type PeekInviteResult struct {
	Invite domain.Invite
	Status domain.InviteStatus
}

func (uc *PeekInvite) Do(ctx context.Context, code string) (PeekInviteResult, error) {
	if strings.TrimSpace(code) == "" {
		return PeekInviteResult{}, fmt.Errorf("tutor.PeekInvite: %w", domain.ErrInvalidInput)
	}
	inv, err := uc.Repo.GetInviteByCode(ctx, code)
	if err != nil {
		return PeekInviteResult{}, fmt.Errorf("tutor.PeekInvite: %w", err)
	}
	return PeekInviteResult{Invite: inv, Status: inv.Status(nowOr(uc.Now))}, nil
}

// EndRelationship — tutor «I'm no longer working with this student».
type EndRelationship struct {
	Repo domain.Repo
	Now  func() time.Time
}

type EndRelationshipInput struct {
	TutorID   uuid.UUID
	StudentID uuid.UUID
}

func (uc *EndRelationship) Do(ctx context.Context, in EndRelationshipInput) error {
	if in.TutorID == uuid.Nil || in.StudentID == uuid.Nil {
		return fmt.Errorf("tutor.EndRelationship: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.EndRelationship(ctx, in.TutorID, in.StudentID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.EndRelationship: %w", err)
	}
	return nil
}

// ── helpers ──────────────────────────────────────────────────────────

func nowOr(fn func() time.Time) time.Time {
	if fn != nil {
		return fn()
	}
	return time.Now().UTC()
}

// inviteCodeAlphabet is base32 without padding, lowered, with confusing
// pairs (0/O, 1/I/L) excluded — easier to read off a phone screen.
const inviteCodeAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

// newInviteCode generates a `length`-char code from the alphabet
// using crypto/rand. Errors are propagated; collision handling is the
// repo's job (UNIQUE constraint → ErrInvalidInput → caller can retry).
func newInviteCode(length int) (string, error) {
	if length <= 0 {
		length = domain.InviteCodeLength
	}
	// Use base32 of crypto/rand bytes, then map into our alphabet.
	// 5 bits per output char ⇒ ceil(length * 5 / 8) bytes of entropy.
	raw := make([]byte, (length*5+7)/8)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("tutor.generateInviteCode: %w", err)
	}
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	encoded = strings.ToLower(encoded)
	out := make([]byte, 0, length)
	// Map base32 chars to our reduced alphabet. Drop ambiguous chars
	// rather than substitute — keeps the reverse lookup unambiguous.
	for i := 0; i < len(encoded) && len(out) < length; i++ {
		c := encoded[i]
		if strings.IndexByte(inviteCodeAlphabet, c) >= 0 {
			out = append(out, c)
		}
	}
	if len(out) < length {
		// Statistically rare (we drop only 5 of 32 chars), but
		// possible — re-roll instead of returning a short code.
		return newInviteCode(length)
	}
	return string(out), nil
}
