// Package app — tutor directory use cases: tutor authors profile, student
// browses, student applies, tutor accepts/declines. Free per identity,
// не marketplace.
//
// Authorisation model:
//   • GetMyDirectoryProfile / UpsertDirectoryProfile — caller is the
//     tutor; profile keyed by caller's user_id.
//   • ListDirectoryTutors — any authed user can browse; no role check.
//   • ApplyToTutor — caller is the student; rejected if caller == tutor.
//   • AcceptApplication / DeclineApplication — caller is the tutor; repo
//     gates по tutor_id.
package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// ── GetMyDirectoryProfile ─────────────────────────────────────────────

type GetMyDirectoryProfile struct {
	Repo domain.DirectoryRepo
}

// Do returns the tutor's current directory profile. Missing row is a
// «virgin» state — return a default invisible profile rather than
// surfacing ErrNotFound to the client (UI renders empty form ready to
// fill).
func (uc *GetMyDirectoryProfile) Do(
	ctx context.Context, userID uuid.UUID,
) (domain.DirectoryProfile, error) {
	if userID == uuid.Nil {
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.GetMyDirectoryProfile: %w", domain.ErrInvalidInput)
	}
	p, err := uc.Repo.GetProfile(ctx, userID)
	if err != nil {
		// Treat «no row» as default-state — return zero-value profile
		// keyed to userID so the client UI can render the form.
		if errors.Is(err, domain.ErrNotFound) {
			return domain.DirectoryProfile{
				UserID:        userID,
				Visible:       false,
				ExpertiseTags: []string{},
				Languages:     []string{},
			}, nil
		}
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.GetMyDirectoryProfile: %w", err)
	}
	return p, nil
}

// ── UpsertDirectoryProfile ────────────────────────────────────────────

type UpsertDirectoryProfile struct {
	Repo domain.DirectoryRepo
	Now  func() time.Time
}

type UpsertDirectoryProfileInput struct {
	UserID             uuid.UUID
	Visible            bool
	BioMD              string
	ExpertiseTags      []string
	Languages          []string
	Timezone           string
	AvailabilityMD     string
	LinkedinURL        string
	GithubURL          string
	ApplicationMessage string
}

func (uc *UpsertDirectoryProfile) Do(
	ctx context.Context, in UpsertDirectoryProfileInput,
) (domain.DirectoryProfile, error) {
	if in.UserID == uuid.Nil {
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.UpsertDirectoryProfile: %w: user_id required", domain.ErrInvalidInput)
	}
	// Length validation matches SQL CHECK. Surface as 400 instead of 500.
	if len(in.BioMD) > 2000 {
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.UpsertDirectoryProfile: %w: bio_md too long", domain.ErrInvalidInput)
	}
	if len(in.ApplicationMessage) > 500 {
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.UpsertDirectoryProfile: %w: application_message too long", domain.ErrInvalidInput)
	}
	// Refusing visibility on empty bio prevents accidentally-empty cards
	// in the directory — better to bounce here than to ship blank cards.
	if in.Visible && strings.TrimSpace(in.BioMD) == "" {
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.UpsertDirectoryProfile: %w: visible profile requires bio_md", domain.ErrInvalidInput)
	}

	profile := domain.DirectoryProfile{
		UserID:             in.UserID,
		Visible:            in.Visible,
		BioMD:              in.BioMD,
		ExpertiseTags:      normaliseStringSlice(in.ExpertiseTags),
		Languages:          normaliseStringSlice(in.Languages),
		Timezone:           strings.TrimSpace(in.Timezone),
		AvailabilityMD:     in.AvailabilityMD,
		LinkedinURL:        strings.TrimSpace(in.LinkedinURL),
		GithubURL:          strings.TrimSpace(in.GithubURL),
		ApplicationMessage: in.ApplicationMessage,
	}
	saved, err := uc.Repo.UpsertProfile(ctx, profile)
	if err != nil {
		return domain.DirectoryProfile{}, fmt.Errorf("tutor.UpsertDirectoryProfile: %w", err)
	}
	return saved, nil
}

// ── ListDirectoryTutors ───────────────────────────────────────────────

type ListDirectoryTutors struct {
	Repo domain.DirectoryRepo
}

type ListDirectoryTutorsInput struct {
	ExpertiseTags []string
	Languages     []string
	Limit         int
	Cursor        string
}

type ListDirectoryTutorsResult struct {
	Items      []domain.DirectoryEntry
	NextCursor string
}

func (uc *ListDirectoryTutors) Do(
	ctx context.Context, in ListDirectoryTutorsInput,
) (ListDirectoryTutorsResult, error) {
	items, next, err := uc.Repo.ListVisible(ctx, domain.DirectoryFilter{
		ExpertiseTags: normaliseStringSlice(in.ExpertiseTags),
		Languages:     normaliseStringSlice(in.Languages),
	}, in.Limit, in.Cursor)
	if err != nil {
		return ListDirectoryTutorsResult{}, fmt.Errorf("tutor.ListDirectoryTutors: %w", err)
	}
	return ListDirectoryTutorsResult{Items: items, NextCursor: next}, nil
}

// ── ApplyToTutor ──────────────────────────────────────────────────────

type ApplyToTutor struct {
	Repo domain.DirectoryRepo
	Now  func() time.Time
}

type ApplyToTutorInput struct {
	StudentID uuid.UUID
	TutorID   uuid.UUID
	Message   string
}

func (uc *ApplyToTutor) Do(
	ctx context.Context, in ApplyToTutorInput,
) (domain.Application, error) {
	if in.StudentID == uuid.Nil || in.TutorID == uuid.Nil {
		return domain.Application{}, fmt.Errorf("tutor.ApplyToTutor: %w", domain.ErrInvalidInput)
	}
	if in.StudentID == in.TutorID {
		return domain.Application{}, fmt.Errorf("tutor.ApplyToTutor: %w: cannot apply to self", domain.ErrSelfInvite)
	}
	if len(in.Message) > 500 {
		return domain.Application{}, fmt.Errorf("tutor.ApplyToTutor: %w: message too long", domain.ErrInvalidInput)
	}
	app := domain.Application{
		TutorID:   in.TutorID,
		StudentID: in.StudentID,
		Message:   strings.TrimSpace(in.Message),
	}
	saved, err := uc.Repo.CreateApplication(ctx, app)
	if err != nil {
		return domain.Application{}, fmt.Errorf("tutor.ApplyToTutor: %w", err)
	}
	return saved, nil
}

// ── List/Accept/Decline applications (tutor-side) ─────────────────────

type ListPendingApplications struct {
	Repo domain.DirectoryRepo
}

func (uc *ListPendingApplications) Do(
	ctx context.Context, tutorID uuid.UUID,
) ([]domain.ApplicationWithStudent, error) {
	if tutorID == uuid.Nil {
		return nil, fmt.Errorf("tutor.ListPendingApplications: %w", domain.ErrInvalidInput)
	}
	items, err := uc.Repo.ListApplicationsForTutor(ctx, tutorID)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListPendingApplications: %w", err)
	}
	return items, nil
}

type AcceptApplication struct {
	Repo domain.DirectoryRepo
	Now  func() time.Time
}

type AcceptApplicationInput struct {
	TutorID       uuid.UUID
	ApplicationID uuid.UUID
}

func (uc *AcceptApplication) Do(
	ctx context.Context, in AcceptApplicationInput,
) (domain.Relationship, error) {
	if in.TutorID == uuid.Nil || in.ApplicationID == uuid.Nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: %w", domain.ErrInvalidInput)
	}
	rel, err := uc.Repo.AcceptApplication(ctx, in.TutorID, in.ApplicationID, nowOr(uc.Now))
	if err != nil {
		return domain.Relationship{}, fmt.Errorf("tutor.AcceptApplication: %w", err)
	}
	return rel, nil
}

type DeclineApplication struct {
	Repo domain.DirectoryRepo
	Now  func() time.Time
}

type DeclineApplicationInput struct {
	TutorID       uuid.UUID
	ApplicationID uuid.UUID
}

func (uc *DeclineApplication) Do(ctx context.Context, in DeclineApplicationInput) error {
	if in.TutorID == uuid.Nil || in.ApplicationID == uuid.Nil {
		return fmt.Errorf("tutor.DeclineApplication: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.DeclineApplication(ctx, in.TutorID, in.ApplicationID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.DeclineApplication: %w", err)
	}
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────

// normaliseStringSlice trims + de-duplicates a string slice, dropping
// empty entries. Returns a non-nil slice even on empty input so the
// SQL layer gets an empty array rather than NULL.
func normaliseStringSlice(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		t := strings.TrimSpace(s)
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}

