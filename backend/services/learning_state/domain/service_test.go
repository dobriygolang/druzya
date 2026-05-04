package domain

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestApplyMode_ExploreClearsTrack(t *testing.T) {
	tid := uuid.New()
	now := time.Now()
	prev := Default(uuid.New(), now.Add(-time.Hour))
	prev.Mode = ModeCommit
	prev.CommittedTrackID = &tid
	committedAt := now.Add(-30 * time.Minute)
	prev.CommittedAt = &committedAt

	out, err := ApplyMode(prev, ModeExplore, nil, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.CommittedTrackID != nil || out.CommittedAt != nil {
		t.Fatalf("explore must clear track fields, got %+v", out)
	}
}

func TestApplyMode_CommitRequiresTrack(t *testing.T) {
	prev := Default(uuid.New(), time.Now())
	_, err := ApplyMode(prev, ModeCommit, nil, time.Now())
	if !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("expected ErrInvalidTransition, got %v", err)
	}
}

func TestApplyMode_PreservesCommittedAtOnSameTrack(t *testing.T) {
	tid := uuid.New()
	earlier := time.Now().Add(-24 * time.Hour)
	prev := Default(uuid.New(), earlier)
	prev.Mode = ModeCommit
	prev.CommittedTrackID = &tid
	prev.CommittedAt = &earlier

	now := time.Now()
	out, err := ApplyMode(prev, ModeDeep, &tid, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.CommittedAt == nil || !out.CommittedAt.Equal(earlier) {
		t.Fatalf("expected committed_at preserved, got %v", out.CommittedAt)
	}
}

func TestApplyFork_NilClears(t *testing.T) {
	now := time.Now()
	branch := ForkDE
	prev := Default(uuid.New(), now)
	prev.ForkBranch = &branch

	out, err := ApplyFork(prev, nil, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.ForkBranch != nil {
		t.Fatalf("fork must be nil, got %v", *out.ForkBranch)
	}
}

func TestApplyFork_BadValue(t *testing.T) {
	prev := Default(uuid.New(), time.Now())
	bad := ForkBranch("data_eng")
	_, err := ApplyFork(prev, &bad, time.Now())
	if !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("expected ErrInvalidTransition, got %v", err)
	}
}

func TestValidateState_TrackAtMismatch(t *testing.T) {
	tid := uuid.New()
	s := Default(uuid.New(), time.Now())
	s.Mode = ModeCommit
	s.CommittedTrackID = &tid
	// committed_at left nil — must fail
	if err := ValidateState(s); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("expected mismatch error, got %v", err)
	}
}
