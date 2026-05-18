// quota.go — Connect-RPC adapter for /subscription/quota.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/subscription/domain"
)

func (s *SubscriptionServer) GetQuota(
	ctx context.Context,
	_ *connect.Request[pb.GetQuotaRequest],
) (*connect.Response[pb.QuotaSnapshot], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.GetQuotaUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	snap, err := s.GetQuotaUC.Do(ctx, uid)
	if err != nil {
		// Degraded contract — фронт не должен висеть на 5xx; отдаём free
		// snapshot чтобы UI просто показал free-state.
		if !errors.Is(err, context.Canceled) && s.Log != nil {
			s.Log.WarnContext(ctx, "subscription.GetQuota.degraded",
				slog.Any("err", err), slog.String("user_id", uid.String()))
		}
		return connect.NewResponse(snapshotToProto(domain.TierFree, domain.PolicyDefaults(domain.TierFree), domain.QuotaUsage{})), nil
	}
	return connect.NewResponse(snapshotToProto(snap.Tier, snap.Policy, snap.Usage)), nil
}

func snapshotToProto(tier domain.Tier, policy domain.QuotaPolicy, usage domain.QuotaUsage) *pb.QuotaSnapshot {
	return &pb.QuotaSnapshot{
		Tier: string(tier),
		Policy: &pb.QuotaPolicy{
			SyncedNotes:        int32(policy.SyncedNotes),
			ActiveSharedBoards: int32(policy.ActiveSharedBoards),
			ActiveSharedRooms:  int32(policy.ActiveSharedRooms),
			SharedTtlSeconds:   int64(policy.SharedTTL.Seconds()),
			AiMonthly:          int32(policy.AIMonthly),
		},
		Usage: &pb.QuotaUsage{
			SyncedNotes:        int32(usage.SyncedNotes),
			ActiveSharedBoards: int32(usage.ActiveSharedBoards),
			ActiveSharedRooms:  int32(usage.ActiveSharedRooms),
			AiThisMonth:        int32(usage.AIThisMonth),
		},
	}
}
