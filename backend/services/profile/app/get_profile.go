// Package app contains the profile use cases: GetMe, GetPublic, GetAtlas,
// GetReport, UpdateSettings, and the event handlers for UserRegistered /
// XPGained / RatingChanged.
package app

import (
	"context"
	"fmt"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// GetProfile returns the rich profile for the authenticated user.
type GetProfile struct {
	Repo domain.ProfileRepo
}

// Do joins users + profiles + subscriptions + ai_credits and derives
// global_power_score from current ratings.
func (uc *GetProfile) Do(ctx context.Context, userID uuid.UUID) (ProfileView, error) {
	b, err := uc.Repo.GetByUserID(ctx, userID)
	if err != nil {
		return ProfileView{}, fmt.Errorf("profile.GetProfile: load: %w", err)
	}
	score := domain.GlobalPowerScore(b.Ratings)
	attrs := domain.DeriveAttributes(b.Ratings)
	xpToNext := domain.XPToNext(b.Profile.Level)
	return ProfileView{
		Bundle:           b,
		GlobalPowerScore: score,
		Attributes:       attrs,
		XPToNext:         xpToNext,
	}, nil
}

// ProfileView is the computed shape passed back to ports.
type ProfileView struct {
	Bundle           domain.Bundle
	GlobalPowerScore int
	Attributes       domain.Attributes
	XPToNext         int64
}

// GetPublic returns the public profile for username-based lookups.
type GetPublic struct {
	Repo domain.ProfileRepo
}

// Do loads PublicBundle and derives score/attrs.
func (uc *GetPublic) Do(ctx context.Context, username string) (PublicView, error) {
	b, err := uc.Repo.GetPublic(ctx, username)
	if err != nil {
		return PublicView{}, fmt.Errorf("profile.GetPublic: %w", err)
	}
	score := domain.GlobalPowerScore(b.Ratings)
	attrs := domain.DeriveAttributes(b.Ratings)
	return PublicView{
		PublicBundle:     b,
		GlobalPowerScore: score,
		Attributes:       attrs,
	}, nil
}

// PublicView is the derived shape of a public profile.
type PublicView struct {
	PublicBundle     domain.PublicBundle
	GlobalPowerScore int
	Attributes       domain.Attributes
}
