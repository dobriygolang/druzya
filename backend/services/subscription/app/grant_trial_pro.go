// Package app — first-install trial Pro reward.
//
// Triggered by the profile bounded context the very first time a user
// heartbeats from ANY surface (web/hone/cue). Grants a 7-day Pro trial
// via a regular Upsert into subscriptions with provider='admin', plan=
// 'pro', current_period_end = now() + 7d. The existing MarkExpired cron
// auto-reverts the row at period_end+grace, so we don't need a dedicated
// expiry mechanism.
//
// Idempotency: a user who already has Pro (paid or trial) is left alone
// — granted=false, no DB write. This makes the use-case safe to call
// many times (e.g. if the user signs up + installs Hone immediately,
// the second heartbeat won't re-issue or extend the trial).
//
// Anti-fallback: any DB error propagates; we never silently turn a
// trial-grant failure into a "yeah it worked" response.

package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// TrialProDuration — 7 days, baked into the use case so neither the
// caller nor a config flag can mis-tune the reward. Bump deliberately
// if product wants a different window.
const TrialProDuration = 7 * 24 * time.Hour

// GrantFirstInstallTrial — UC for the trial-grant gate.
type GrantFirstInstallTrial struct {
	Repo  domain.Repo
	Clock domain.Clock
	Log   *slog.Logger
}

// NewGrantFirstInstallTrial — constructor with nil-safe defaults. Log is
// required (anti-fallback policy — we want to see every grant in logs).
func NewGrantFirstInstallTrial(repo domain.Repo, clk domain.Clock, log *slog.Logger) *GrantFirstInstallTrial {
	if log == nil {
		panic("subscription.NewGrantFirstInstallTrial: logger is required")
	}
	if clk == nil {
		clk = domain.RealClock{}
	}
	return &GrantFirstInstallTrial{Repo: repo, Clock: clk, Log: log}
}

// Do issues the trial when the user is on free. Returns (granted, until,
// err). granted=false with err=nil means «user already had Pro / trial,
// nothing to do» — caller should NOT treat that as an error.
func (uc *GrantFirstInstallTrial) Do(ctx context.Context, userID uuid.UUID) (bool, time.Time, error) {
	now := uc.Clock.Now()

	existing, err := uc.Repo.Get(ctx, userID)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		return false, time.Time{}, fmt.Errorf("subscription.GrantFirstInstallTrial: lookup: %w", err)
	}

	// Anyone already on Pro (paid or admin grant) is left alone. We compare
	// the effective tier, not the stored field, so an expired trial that
	// hasn't been swept yet falls back to TierFree and re-qualifies.
	if err == nil && existing.ActiveAt(now) != domain.TierFree {
		return false, time.Time{}, nil
	}

	until := now.Add(TrialProDuration)
	grace := until.Add(24 * time.Hour)

	sub := domain.Subscription{
		UserID:           userID,
		Tier:             domain.TierPro,
		Status:           domain.StatusActive,
		Provider:         domain.ProviderAdmin,
		StartedAt:        &now,
		CurrentPeriodEnd: &until,
		GraceUntil:       &grace,
		UpdatedAt:        now,
	}
	if err := uc.Repo.Upsert(ctx, sub); err != nil {
		return false, time.Time{}, fmt.Errorf("subscription.GrantFirstInstallTrial: upsert: %w", err)
	}
	uc.Log.InfoContext(ctx, "subscription.first_install_trial_granted",
		slog.String("user_id", userID.String()),
		slog.Time("until", until))
	return true, until, nil
}
