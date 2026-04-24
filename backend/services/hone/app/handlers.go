// Package app is the use-case layer for Hone. Each exported struct is one
// wire-addressable operation; Handler bundles them so the ports package
// can depend on a single struct.
package app

import (
	"log/slog"
	"time"

	"druz9/hone/domain"
)

// ChronicSkipWindow / ChronicSkipMinCount — порог «chronic skip» для
// resistance-tracker'а. 14 дней — достаточный lookback чтобы отловить
// устойчивое избегание, и достаточно короткий чтобы «починенный» skill
// (пользователь наконец-то сделал задачу) быстро выпал. 2 — минимальная
// повторность, отличающая «не успел сегодня» от «активно отмахивается».
const (
	ChronicSkipWindow   = 14 * 24 * time.Hour
	ChronicSkipMinCount = 2
)

// Handler bundles all Hone use cases. Constructed in
// cmd/monolith/services/hone.go and handed to ports.NewHoneServer.
type Handler struct {
	// Plan
	GeneratePlan     *GeneratePlan
	GetPlan          *GetPlan
	DismissPlanItem  *DismissPlanItem
	CompletePlanItem *CompletePlanItem

	// Focus
	StartFocus *StartFocus
	EndFocus   *EndFocus
	GetStats   *GetStats

	// Notes
	CreateNote         *CreateNote
	UpdateNote         *UpdateNote
	GetNote            *GetNote
	ListNotes          *ListNotes
	DeleteNote         *DeleteNote
	GetNoteConnections *GetNoteConnections

	// Whiteboards
	CreateWhiteboard   *CreateWhiteboard
	UpdateWhiteboard   *UpdateWhiteboard
	GetWhiteboard      *GetWhiteboard
	ListWhiteboards    *ListWhiteboards
	DeleteWhiteboard   *DeleteWhiteboard
	CritiqueWhiteboard *CritiqueWhiteboard
	SaveCritiqueAsNote *SaveCritiqueAsNote

	// Standup
	RecordStandup *RecordStandup

	Log *slog.Logger
	Now func() time.Time
}

// NewHandler copies the fields — no side-effects. Caller owns lifetime.
func NewHandler(in Handler) *Handler {
	h := in
	if h.Now == nil {
		h.Now = time.Now
	}
	return &h
}

// MinQualifyingFocusSeconds is the per-day threshold for streak contribution.
// A day counts toward streak only when aggregate focused_seconds crosses
// this line. Ten minutes is the current floor — low enough that "showing
// up" counts, high enough that opening the app briefly doesn't.
const MinQualifyingFocusSeconds = 600

// MaxPlanItems caps AI-generated plan length. More items → less focus;
// Winter-style minimalism pushes us toward a tight list. 4 is the MVP
// default, bumped to 5 if calendar has a mock today (auto-inserted).
const MaxPlanItems = 5

// PlanItemIDSeed is the entropy source used by plan_generator to mint
// item IDs. Deliberately short and stable so dismiss/complete clicks
// don't confuse the UI when ids are long opaque strings.
const PlanItemIDSeed = "hone-plan"

// Ensure domain is referenced at compile time — guards against import
// pruning when early app files don't yet touch domain types.
var _ = domain.PlanItemSolve
