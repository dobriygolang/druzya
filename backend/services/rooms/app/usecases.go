// Package app holds the room use cases: create / list / extend / delete /
// restore plus the SweepExpired cron. All UCs are pure functional and
// repo-abstracted so they can be exercised without a database.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/rooms/domain"

	"github.com/google/uuid"
)

// defaultSweepLimit caps rows touched per SweepExpired tick. Keeps each cron
// run bounded so a backlog cannot block the daemon, and the next tick picks
// up the rest.
const defaultSweepLimit = 500

// CreateRoom mints a new room for the caller after running quota and abuse
// gates. ShareURL is built from PublicBaseURL, which must be configured.
type CreateRoom struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
	// PublicBaseURL is the origin used to build share links (e.g.
	// https://druz9.online). Must be non-empty.
	PublicBaseURL string
	// Abuse optionally rejects banned users before quota work. Nil = no check.
	Abuse domain.AbuseChecker
}

type CreateRoomInput struct {
	UserID uuid.UUID
	Kind   domain.Kind
	Title  string
	// TTLOverride lets tutor/mock workflows extend rooms past the free 24h cap.
	TTLOverride *time.Duration
	// BypassQuota skips the free-tier counter when callers (tutor / mock /
	// club) already account for the room elsewhere.
	BypassQuota bool
}

type CreateRoomOutput struct {
	Room     domain.Room
	ShareURL string
}

func (uc *CreateRoom) Do(ctx context.Context, in CreateRoomInput) (CreateRoomOutput, error) {
	if !in.Kind.IsValid() {
		return CreateRoomOutput{}, fmt.Errorf("rooms.CreateRoom: %w", domain.ErrInvalidKind)
	}
	now := uc.now()

	// Reject banned users before any quota work so the cheap check fails fast.
	if uc.Abuse != nil {
		blocked, err := uc.Abuse.IsUserBlocked(ctx, in.UserID)
		if err == nil && blocked {
			return CreateRoomOutput{}, domain.ErrUserBlocked
		}
	}

	if !in.BypassQuota {
		q, err := uc.Quota.Get(ctx, in.UserID)
		if err != nil {
			return CreateRoomOutput{}, fmt.Errorf("rooms.CreateRoom quota.Get: %w", err)
		}
		if q.Tier == "free" && q.ActiveCount >= domain.FreeMaxActive {
			return CreateRoomOutput{}, domain.ErrQuotaExceeded
		}
	}

	ttl := domain.FreeTTL
	if in.TTLOverride != nil {
		ttl = *in.TTLOverride
	}

	r := domain.Room{
		OwnerID:    in.UserID,
		Kind:       in.Kind,
		Title:      in.Title,
		Visibility: "shared",
		FreeTier:   !in.BypassQuota,
		ExpiresAt:  now.Add(ttl),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	saved, err := uc.Repo.Create(ctx, r)
	if err != nil {
		return CreateRoomOutput{}, fmt.Errorf("rooms.CreateRoom repo: %w", err)
	}

	share, shareErr := uc.shareURL(saved)
	if shareErr != nil {
		return CreateRoomOutput{}, fmt.Errorf("rooms.CreateRoom share: %w", shareErr)
	}

	if !in.BypassQuota {
		// Best-effort: a transient increment failure is recovered by the
		// daily QuotaRepo.Recompute pass, so we log and keep the create
		// response intact rather than poisoning a successful insert.
		if incErr := uc.Quota.Increment(ctx, in.UserID, "free"); incErr != nil {
			slog.Default().WarnContext(ctx, "rooms.CreateRoom quota.Increment failed",
				slog.String("user_id", in.UserID.String()),
				slog.Any("err", incErr))
		}
	}

	return CreateRoomOutput{Room: saved, ShareURL: share}, nil
}

func (uc *CreateRoom) shareURL(r domain.Room) (string, error) {
	if uc.PublicBaseURL == "" {
		return "", errors.New("rooms: PublicBaseURL not configured")
	}
	base := strings.TrimRight(uc.PublicBaseURL, "/")
	switch r.Kind {
	case domain.KindCode:
		return base + "/editor/room/" + r.ID.String(), nil
	case domain.KindWhiteboard:
		return base + "/whiteboard/room/" + r.ID.String(), nil
	}
	return "", fmt.Errorf("rooms: %w", domain.ErrInvalidKind)
}

func (uc *CreateRoom) now() time.Time {
	if uc.Now != nil {
		return uc.Now().UTC()
	}
	return time.Now().UTC()
}

type ListMyRooms struct {
	Repo domain.Repo
}

func (uc *ListMyRooms) Do(ctx context.Context, userID uuid.UUID, status domain.Status) ([]domain.Room, error) {
	out, err := uc.Repo.ListMy(ctx, userID, status)
	if err != nil {
		return nil, fmt.Errorf("rooms.ListMyRooms: %w", err)
	}
	return out, nil
}

type ExtendRoom struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
}

func (uc *ExtendRoom) Do(ctx context.Context, userID uuid.UUID, kind domain.Kind, id uuid.UUID, hours int) error {
	q, err := uc.Quota.Get(ctx, userID)
	if err != nil {
		return fmt.Errorf("rooms.ExtendRoom quota: %w", err)
	}
	if q.Tier != "pro" {
		return domain.ErrProRequired
	}
	r, err := uc.Repo.Get(ctx, kind, id)
	if err != nil {
		return fmt.Errorf("rooms.ExtendRoom: %w", err)
	}
	if r.OwnerID != userID {
		return domain.ErrNotOwner
	}
	now := uc.nowOrDefault()
	newExpiry := r.ExpiresAt.Add(time.Duration(hours) * time.Hour)
	// If the room already expired, anchor the extension to "now" so the user
	// gets the full window they paid for instead of a date in the past.
	if newExpiry.Before(now) {
		newExpiry = now.Add(time.Duration(hours) * time.Hour)
	}
	if err := uc.Repo.ExtendExpiry(ctx, kind, id, newExpiry); err != nil {
		return fmt.Errorf("rooms.ExtendRoom: %w", err)
	}
	return nil
}

func (uc *ExtendRoom) nowOrDefault() time.Time {
	if uc.Now != nil {
		return uc.Now().UTC()
	}
	return time.Now().UTC()
}

type DeleteRoom struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
}

func (uc *DeleteRoom) Do(ctx context.Context, userID uuid.UUID, kind domain.Kind, id uuid.UUID) error {
	r, err := uc.Repo.Get(ctx, kind, id)
	if err != nil {
		return fmt.Errorf("rooms.DeleteRoom: %w", err)
	}
	if r.OwnerID != userID {
		return domain.ErrNotOwner
	}
	if r.ArchivedAt != nil {
		return domain.ErrAlreadyArchived
	}
	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now().UTC()
	}
	if err := uc.Repo.Archive(ctx, kind, id, now); err != nil {
		return fmt.Errorf("rooms.DeleteRoom archive: %w", err)
	}
	if r.FreeTier {
		// Daily Recompute reconciles any drift if the decrement fails.
		if err := uc.Quota.Decrement(ctx, userID); err != nil {
			return fmt.Errorf("rooms.DeleteRoom quota.Decrement: %w", err)
		}
	}
	return nil
}

type RestoreRoom struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
}

func (uc *RestoreRoom) Do(ctx context.Context, userID uuid.UUID, kind domain.Kind, id uuid.UUID) error {
	r, err := uc.Repo.Get(ctx, kind, id)
	if err != nil {
		return fmt.Errorf("rooms.RestoreRoom: %w", err)
	}
	if r.OwnerID != userID {
		return domain.ErrNotOwner
	}
	if r.ArchivedAt == nil {
		return nil
	}
	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now().UTC()
	}
	if now.Sub(*r.ArchivedAt) > domain.RestoreWindow {
		return fmt.Errorf("rooms.RestoreRoom: outside %dd restore window", int(domain.RestoreWindow/(24*time.Hour)))
	}
	// Restoring re-occupies a free slot, so re-run the quota gate here too.
	if r.FreeTier {
		q, qerr := uc.Quota.Get(ctx, userID)
		if qerr == nil && q.Tier == "free" && q.ActiveCount >= domain.FreeMaxActive {
			return domain.ErrQuotaExceeded
		}
	}
	if err := uc.Repo.Restore(ctx, kind, id); err != nil {
		return fmt.Errorf("rooms.RestoreRoom restore: %w", err)
	}
	if r.FreeTier {
		if err := uc.Quota.Increment(ctx, userID, "free"); err != nil {
			return fmt.Errorf("rooms.RestoreRoom quota.Increment: %w", err)
		}
	}
	return nil
}

// SweepExpired is the daily cron tick: archives expired non-archived rooms and
// decrements quota counters for free-tier rows.
type SweepExpired struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
	Limit int // 0 = defaultSweepLimit
}

func (uc *SweepExpired) Run(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now().UTC()
	}
	limit := uc.Limit
	if limit <= 0 {
		limit = defaultSweepLimit
	}
	candidates, err := uc.Repo.ListExpiredCandidates(ctx, now, limit)
	if err != nil {
		return 0, fmt.Errorf("rooms.SweepExpired list: %w", err)
	}
	archived := 0
	for _, r := range candidates {
		// Best-effort: a transient archive failure is retried next tick rather
		// than aborting the whole sweep.
		if err := uc.Repo.Archive(ctx, r.Kind, r.ID, now); err != nil {
			continue
		}
		if r.FreeTier {
			// Decrement errors are tolerated for the same reason; daily
			// Recompute is the source of truth for active_count.
			if decErr := uc.Quota.Decrement(ctx, r.OwnerID); decErr != nil {
				slog.Default().WarnContext(ctx, "rooms.SweepExpired quota.Decrement failed",
					slog.String("user_id", r.OwnerID.String()),
					slog.Any("err", decErr))
			}
		}
		archived++
	}
	return archived, nil
}
