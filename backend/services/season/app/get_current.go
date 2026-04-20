// Package app contains season use cases + event handlers. One use-case file per
// REST endpoint; event handlers collected in handlers.go.
package app

import (
	"context"
	"fmt"
	"time"

	"druz9/season/domain"

	"github.com/google/uuid"
)

// WeeklyChallengeView is a per-challenge projection for the HTTP layer.
type WeeklyChallengeView struct {
	Key          string
	Title        string
	Target       int
	Progress     int
	PointsReward int
}

// TierView is a single rung on a track ladder in the response.
type TierView struct {
	Tier           int
	RequiredPoints int
	RewardKey      string
	Claimed        bool
}

// TrackView bundles a track kind with its tier ladder.
type TrackView struct {
	Kind  domain.TrackKind
	Tiers []TierView
}

// SeasonView is the serialisable response for GET /season/current.
type SeasonView struct {
	Season           domain.Season
	MyPoints         int
	Tier             int
	IsPremium        bool
	Tracks           []TrackView
	WeeklyChallenges []WeeklyChallengeView
}

// GetCurrent is the single use case behind GET /season/current.
type GetCurrent struct {
	Seasons    domain.SeasonRepo
	Tiers      domain.TierRepo
	Challenges domain.ChallengeRepo
	Claims     domain.ClaimRepo
	Now        func() time.Time
}

// NewGetCurrent wires the use case.
func NewGetCurrent(s domain.SeasonRepo, t domain.TierRepo, c domain.ChallengeRepo, claims domain.ClaimRepo) *GetCurrent {
	return &GetCurrent{
		Seasons:    s,
		Tiers:      t,
		Challenges: c,
		Claims:     claims,
		Now:        func() time.Time { return time.Now().UTC() },
	}
}

// Do loads the current season, the user's progress, both tier tracks, and the
// challenges active this ISO week. Weekly challenge progress is returned at 0
// today — the per-user tally lives in-memory and is not wired into this
// endpoint yet (STUB: the event handlers increment a local map that is out of
// scope for MVP persistence).
func (uc *GetCurrent) Do(ctx context.Context, userID uuid.UUID) (SeasonView, error) {
	s, err := uc.Seasons.GetCurrent(ctx)
	if err != nil {
		return SeasonView{}, fmt.Errorf("season.GetCurrent: %w", err)
	}
	p, err := uc.Seasons.GetProgress(ctx, userID, s.ID)
	if err != nil {
		return SeasonView{}, fmt.Errorf("season.GetCurrent: %w", err)
	}

	freeLadder, err := uc.Tiers.Tracks(ctx, s.ID, domain.TrackFree)
	if err != nil {
		return SeasonView{}, fmt.Errorf("season.GetCurrent: %w", err)
	}
	premiumLadder, err := uc.Tiers.Tracks(ctx, s.ID, domain.TrackPremium)
	if err != nil {
		return SeasonView{}, fmt.Errorf("season.GetCurrent: %w", err)
	}

	state, err := uc.Claims.Get(ctx, userID, s.ID)
	if err != nil {
		return SeasonView{}, fmt.Errorf("season.GetCurrent: %w", err)
	}

	isoWeek := domain.IsoWeekOf(uc.Now())
	challenges, err := uc.Challenges.Active(ctx, s.ID, isoWeek)
	if err != nil {
		return SeasonView{}, fmt.Errorf("season.GetCurrent: %w", err)
	}

	view := SeasonView{
		Season:    s,
		MyPoints:  p.Points,
		Tier:      domain.ComputeTier(p.Points, freeLadder),
		IsPremium: p.IsPremium,
		Tracks: []TrackView{
			buildTrack(domain.TrackFree, freeLadder, state.FreeClaimed),
			buildTrack(domain.TrackPremium, premiumLadder, state.PremiumClaimed),
		},
		WeeklyChallenges: make([]WeeklyChallengeView, 0, len(challenges)),
	}
	for _, c := range challenges {
		view.WeeklyChallenges = append(view.WeeklyChallenges, WeeklyChallengeView{
			Key:          c.Key,
			Title:        c.Title,
			Target:       c.Target,
			Progress:     0, // STUB: per-user challenge progress persistence lands in m2.
			PointsReward: c.PointsReward,
		})
	}
	return view, nil
}

func buildTrack(kind domain.TrackKind, ladder []domain.TierDef, claimed map[int]bool) TrackView {
	tiers := make([]TierView, 0, len(ladder))
	for _, t := range ladder {
		tiers = append(tiers, TierView{
			Tier:           t.Tier,
			RequiredPoints: t.RequiredPoints,
			RewardKey:      t.RewardKey,
			Claimed:        claimed[t.Tier],
		})
	}
	return TrackView{Kind: kind, Tiers: tiers}
}
