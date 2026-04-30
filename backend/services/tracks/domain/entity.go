// Package domain — Tracks bounded context.
//
// A Track is a curated programme of preparation: an ordered sequence of
// steps the user works through, each step a (skill_keys, kind, count)
// tuple. Tracks replace the previous skill-graph navigation as the
// catalogue's primary entry point; the Atlas graph stays as the visual
// core of the track-detail page.
//
// Single source of truth for "what is the user training right now?".
// Read by:
//   - web /atlas + /atlas/track/:slug
//   - intelligence (track_stalled severity, step-aware recommendations)
//   - lobby (custom solo lobbies seeded from a step's skill_keys)
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Difficulty mirrors the SQL CHECK constraint.
type Difficulty string

const (
	DifficultyEasy   Difficulty = "easy"
	DifficultyMedium Difficulty = "medium"
	DifficultyHard   Difficulty = "hard"
)

// IsValid returns true for known difficulties.
func (d Difficulty) IsValid() bool {
	switch d {
	case DifficultyEasy, DifficultyMedium, DifficultyHard:
		return true
	}
	return false
}

// StepKind mirrors the track_step_kind SQL enum. Each kind maps to a
// concrete signal the orchestrator can read from existing tables —
// nothing in track_steps writes its own progress row.
type StepKind string

const (
	StepKindKata       StepKind = "kata"
	StepKindArena      StepKind = "arena"
	StepKindMock       StepKind = "mock"
	StepKindCodexRead  StepKind = "codex_read"
	StepKindFocusBlock StepKind = "focus_block"
)

// IsValid returns true for known step kinds.
func (k StepKind) IsValid() bool {
	switch k {
	case StepKindKata, StepKindArena, StepKindMock, StepKindCodexRead, StepKindFocusBlock:
		return true
	}
	return false
}

// Track is one row of the curated catalogue.
type Track struct {
	ID             uuid.UUID
	Slug           string
	Name           string
	Tagline        string
	DescriptionMD  string
	CoverImageURL  string
	AccentColor    string
	CuratorID      *uuid.UUID
	EstimatedWeeks int
	Difficulty     Difficulty
	IsCurated      bool
	IsActive       bool
	Tags           []string
	CompanyFocus   []string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// Step is one row of track_steps.
type Step struct {
	TrackID            uuid.UUID
	StepIndex          int
	Title              string
	DescriptionMD      string
	SkillKeys          []string
	RequiredKind       StepKind
	RequiredCount      int
	RecommendedReading []string
	EstimatedMinutes   int
}

// TrackWithSteps is the read projection used by Track-detail page.
type TrackWithSteps struct {
	Track Track
	Steps []Step
}

// UserTrack is per-user enrolment + progress.
type UserTrack struct {
	UserID      uuid.UUID
	TrackID     uuid.UUID
	JoinedAt    time.Time
	CurrentStep int
	Progress    map[string]any
	PausedAt    *time.Time
	CompletedAt *time.Time
}

// IsActive returns true when the user is enrolled and the track is
// neither completed nor paused.
func (u UserTrack) IsActive() bool {
	return u.CompletedAt == nil && u.PausedAt == nil
}

// UserTrackProgress is the read projection joined with the parent
// track row — saves a fan-out fetch when the UI lists "my tracks".
type UserTrackProgress struct {
	UserTrack
	Track      Track
	StepsTotal int
}

// Domain errors.
var (
	ErrNotFound      = errors.New("tracks: not found")
	ErrAlreadyJoined = errors.New("tracks: already joined")
	ErrInvalidInput  = errors.New("tracks: invalid input")
)
