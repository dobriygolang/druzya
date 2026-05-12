// Package app — Phase J / X1 (P0) install-tracking + trial-Pro grant.
//
// Heartbeat lifecycle:
//
//   web   → fires once after signup (post-auth bootstrap).
//   hone  → fires on launch after the keychain restores the session.
//   cue   → same — main process, after getValidSession() succeeds.
//
// First-install reward: when CountUserAppInstalls == 0 BEFORE this call
// AND the user is on the free tier, we grant a 7-day Pro trial. The grant
// runs via an injected hook so the profile UC stays free of cross-service
// imports (subscription wirer sets it up in cmd/monolith).
//
// Failure semantics: if the trial grant hook errors, we log and return
// success on the heartbeat itself — the install row is the source of
// truth; the trial is a side-effect that retries via support if it ever
// matters. Anti-fallback: we DO NOT silently swallow the upsert error
// itself; that surfaces to the caller as Internal.

package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/profile/domain"

	"github.com/google/uuid"
)

// TrialProGranter is the hook signature for «first install across all
// surfaces → grant 7d Pro». Implementation lives in the monolith wirer
// where it can import the subscription service safely.
type TrialProGranter interface {
	GrantFirstInstallTrial(ctx context.Context, userID uuid.UUID) (granted bool, until time.Time, err error)
}

// RecordAppInstall — UC for the eponymous RPC.
type RecordAppInstall struct {
	Repo  domain.ProfileRepo
	Trial TrialProGranter // optional; nil → no trial side-effect
	Log   *slog.Logger
	Clock func() time.Time // test seam
}

// RecordAppInstallInput is what the ports layer passes through.
type RecordAppInstallInput struct {
	UserID     uuid.UUID
	App        domain.AppSurface
	AppVersion string
}

// RecordAppInstallOutput surfaces the trial-grant outcome so the wire layer
// can render a celebratory toast without a follow-up RPC.
type RecordAppInstallOutput struct {
	Install      domain.AppInstall
	TrialGranted bool
	TrialUntil   time.Time
}

// Do persists the heartbeat and (if first install) issues a 7d Pro trial.
// Idempotent: replays of the same call after the first install simply
// refresh last_seen_at and skip the trial branch (count is non-zero).
func (uc *RecordAppInstall) Do(ctx context.Context, in RecordAppInstallInput) (RecordAppInstallOutput, error) {
	if !in.App.IsValid() {
		return RecordAppInstallOutput{}, fmt.Errorf("profile.RecordAppInstall: invalid app %q", in.App)
	}
	install, _, before, err := uc.Repo.UpsertAppInstall(ctx, in.UserID, in.App, in.AppVersion)
	if err != nil {
		return RecordAppInstallOutput{}, fmt.Errorf("profile.RecordAppInstall: upsert: %w", err)
	}

	out := RecordAppInstallOutput{Install: install}

	// Trial-grant gate: only the very first install row across all 3
	// surfaces triggers the 7d Pro reward. `before == 0` is the precise
	// condition (count was zero before this upsert wrote a row).
	if before == 0 && uc.Trial != nil {
		granted, until, gerr := uc.Trial.GrantFirstInstallTrial(ctx, in.UserID)
		if gerr != nil {
			// Best-effort: log + continue. Heartbeat itself succeeded.
			if uc.Log != nil {
				uc.Log.WarnContext(ctx, "profile.record_app_install: trial grant failed",
					slog.String("user_id", in.UserID.String()),
					slog.String("app", string(in.App)),
					slog.Any("err", gerr))
			}
		} else {
			out.TrialGranted = granted
			out.TrialUntil = until
		}
	}

	if uc.Log != nil {
		uc.Log.InfoContext(ctx, "profile.record_app_install",
			slog.String("user_id", in.UserID.String()),
			slog.String("app", string(in.App)),
			slog.String("version", in.AppVersion),
			slog.Bool("first_install", before == 0),
			slog.Bool("trial_granted", out.TrialGranted))
	}
	return out, nil
}
