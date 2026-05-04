// Package app — Phase 9a rooms UCs.
//
//   CreateRoom    — free-tier guard + INSERT в editor_rooms / whiteboard_rooms
//                   (выбор по kind) + INCREMENT quota. Returns share URL.
//   ListMyRooms   — split active vs past.
//   ExtendRoom    — pro-only.
//   RestoreRoom   — undelete если в 30d window.
//   DeleteRoom    — soft-delete (archived_at).
//
// Все UCs — pure functional, repo-abstracted.
package app

import (
	"context"
	"fmt"
	"time"

	"druz9/rooms/domain"

	"github.com/google/uuid"
)

// CreateRoom UC.
type CreateRoom struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
	// PublicBaseURL — origin для share-link (e.g. https://druz9.online).
	PublicBaseURL string
	// Abuse — optional spam-mitigation gate (Phase 9a). nil → no-check.
	// Реализация может проверять user_id (admin ban) или host (когда есть
	// share-link signal). Создаёт ErrUserBlocked при positive match.
	Abuse domain.AbuseChecker
}

type CreateRoomInput struct {
	UserID uuid.UUID
	Kind   domain.Kind
	Title  string
	// TTLOverride — для tutor/mock workflows. Если nil → free-tier 24h.
	TTLOverride *time.Duration
	// Bypass quota когда UC вызван из tutor/mock/club контекста (НЕ
	// standalone create). Phase 9a §7a Settings → free_tier=true.
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

	// Abuse gate (Phase 9a §spam). Blocked users — reject before quota
	// check (cheaper). nil-safe.
	if uc.Abuse != nil {
		blocked, err := uc.Abuse.IsUserBlocked(ctx, in.UserID)
		if err == nil && blocked {
			return CreateRoomOutput{}, domain.ErrUserBlocked
		}
	}

	// Quota check (free-tier only).
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

	if !in.BypassQuota {
		_ = uc.Quota.Increment(ctx, in.UserID, "free")
	}

	share := uc.shareURL(saved)
	return CreateRoomOutput{Room: saved, ShareURL: share}, nil
}

func (uc *CreateRoom) shareURL(r domain.Room) string {
	base := uc.PublicBaseURL
	if base == "" {
		base = ""
	}
	switch r.Kind {
	case domain.KindCode:
		return base + "/editor/room/" + r.ID.String()
	case domain.KindWhiteboard:
		return base + "/whiteboard/room/" + r.ID.String()
	}
	return ""
}

func (uc *CreateRoom) now() time.Time {
	if uc.Now != nil {
		return uc.Now().UTC()
	}
	return time.Now().UTC()
}

// ─── ListMyRooms ──────────────────────────────────────────────────────────

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

// ─── ExtendRoom (pro-only) ────────────────────────────────────────────────

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
		return err
	}
	if r.OwnerID != userID {
		return domain.ErrNotOwner
	}
	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now().UTC()
	}
	newExpiry := r.ExpiresAt.Add(time.Duration(hours) * time.Hour)
	if newExpiry.Before(now) {
		newExpiry = now.Add(time.Duration(hours) * time.Hour)
	}
	return uc.Repo.ExtendExpiry(ctx, kind, id, newExpiry)
}

// ─── DeleteRoom (soft-delete) ─────────────────────────────────────────────

type DeleteRoom struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
}

func (uc *DeleteRoom) Do(ctx context.Context, userID uuid.UUID, kind domain.Kind, id uuid.UUID) error {
	r, err := uc.Repo.Get(ctx, kind, id)
	if err != nil {
		return err
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
		return err
	}
	if r.FreeTier {
		_ = uc.Quota.Decrement(ctx, userID)
	}
	return nil
}

// ─── RestoreRoom ──────────────────────────────────────────────────────────

type RestoreRoom struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
}

func (uc *RestoreRoom) Do(ctx context.Context, userID uuid.UUID, kind domain.Kind, id uuid.UUID) error {
	r, err := uc.Repo.Get(ctx, kind, id)
	if err != nil {
		return err
	}
	if r.OwnerID != userID {
		return domain.ErrNotOwner
	}
	if r.ArchivedAt == nil {
		return nil // already active
	}
	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now().UTC()
	}
	if now.Sub(*r.ArchivedAt) > domain.RestoreWindow {
		return fmt.Errorf("rooms.RestoreRoom: outside %dd restore window", int(domain.RestoreWindow/(24*time.Hour)))
	}
	// Free-tier quota check на restore — ресторе тоже выжирает slot.
	if r.FreeTier {
		q, qerr := uc.Quota.Get(ctx, userID)
		if qerr == nil && q.Tier == "free" && q.ActiveCount >= domain.FreeMaxActive {
			return domain.ErrQuotaExceeded
		}
	}
	if err := uc.Repo.Restore(ctx, kind, id); err != nil {
		return err
	}
	if r.FreeTier {
		_ = uc.Quota.Increment(ctx, userID, "free")
	}
	return nil
}

// ─── TTL daemon (cron) ────────────────────────────────────────────────────

// SweepExpired — daily cron-tick. Archives expired non-archived rooms +
// decrements quota counters for free-tier rows.
type SweepExpired struct {
	Repo  domain.Repo
	Quota domain.QuotaRepo
	Now   func() time.Time
	Limit int // default 500 per tick
}

func (uc *SweepExpired) Run(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now().UTC()
	}
	limit := uc.Limit
	if limit <= 0 {
		limit = 500
	}
	candidates, err := uc.Repo.ListExpiredCandidates(ctx, now, limit)
	if err != nil {
		return 0, fmt.Errorf("rooms.SweepExpired list: %w", err)
	}
	archived := 0
	for _, r := range candidates {
		if err := uc.Repo.Archive(ctx, r.Kind, r.ID, now); err != nil {
			continue // best-effort; следующий tick re-try'нет
		}
		if r.FreeTier {
			_ = uc.Quota.Decrement(ctx, r.OwnerID)
		}
		archived++
	}
	return archived, nil
}
