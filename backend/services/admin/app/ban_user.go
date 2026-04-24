// ban_user.go — Ban / Unban use cases.
//
// Both operations bust the dashboard cache so the "users_banned" counter
// reflects the change on the next page reload (TTL is 60s otherwise).
package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/admin/domain"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// MaxBanReasonLen caps the reason field at a sensible length so a curator
// cannot accidentally paste an entire chat log into a ban row.
const MaxBanReasonLen = 500

// BanUser implements POST /api/v1/admin/users/{user_id}/ban.
type BanUser struct {
	Users domain.UserRepo
	Cache *redis.Client
	Log   *slog.Logger
}

// BanInput mirrors domain.BanInput so the use-case signature is independent.
type BanInput = domain.BanInput

// Do validates the payload and persists the ban.
func (uc *BanUser) Do(ctx context.Context, in BanInput) (domain.AdminUserRow, error) {
	if in.UserID == uuid.Nil {
		return domain.AdminUserRow{}, fmt.Errorf("%w: user_id is required", domain.ErrInvalidInput)
	}
	reason := strings.TrimSpace(in.Reason)
	if reason == "" {
		return domain.AdminUserRow{}, fmt.Errorf("%w: reason is required", domain.ErrInvalidInput)
	}
	if len(reason) > MaxBanReasonLen {
		return domain.AdminUserRow{}, fmt.Errorf("%w: reason must be ≤ %d chars", domain.ErrInvalidInput, MaxBanReasonLen)
	}
	if in.ExpiresAt != nil && in.ExpiresAt.Before(time.Now().Add(-time.Minute)) {
		return domain.AdminUserRow{}, fmt.Errorf("%w: expires_at must be in the future", domain.ErrInvalidInput)
	}
	in.Reason = reason
	out, err := uc.Users.Ban(ctx, in)
	if err != nil {
		return domain.AdminUserRow{}, fmt.Errorf("admin.BanUser: %w", err)
	}
	uc.bustCache(ctx)
	return out, nil
}

// UnbanUser implements POST /api/v1/admin/users/{user_id}/unban.
type UnbanUser struct {
	Users domain.UserRepo
	Cache *redis.Client
	Log   *slog.Logger
}

// Do lifts the active ban (if any).
func (uc *UnbanUser) Do(ctx context.Context, userID, by uuid.UUID) (domain.AdminUserRow, error) {
	if userID == uuid.Nil {
		return domain.AdminUserRow{}, fmt.Errorf("%w: user_id is required", domain.ErrInvalidInput)
	}
	out, err := uc.Users.Unban(ctx, userID, by)
	if err != nil {
		return domain.AdminUserRow{}, fmt.Errorf("admin.UnbanUser: %w", err)
	}
	uc.bustCache(ctx)
	return out, nil
}

// bustCache wipes the dashboard counters so the "users_banned" stat
// refreshes immediately rather than waiting on the 60s TTL.
func (uc *BanUser) bustCache(ctx context.Context) {
	if uc.Cache == nil {
		return
	}
	if err := uc.Cache.Del(ctx, DashboardCacheKey).Err(); err != nil && uc.Log != nil {
		uc.Log.WarnContext(ctx, "admin.BanUser: cache bust failed", slog.Any("err", err))
	}
}

func (uc *UnbanUser) bustCache(ctx context.Context) {
	if uc.Cache == nil {
		return
	}
	if err := uc.Cache.Del(ctx, DashboardCacheKey).Err(); err != nil && uc.Log != nil {
		uc.Log.WarnContext(ctx, "admin.UnbanUser: cache bust failed", slog.Any("err", err))
	}
}
