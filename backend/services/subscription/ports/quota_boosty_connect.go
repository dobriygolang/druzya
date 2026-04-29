// quota_boosty_connect.go — Connect-RPC adapters for /subscription/quota,
// /subscription/boosty/link, /admin/subscriptions/boosty/sync.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/subscription/app"
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
		// Match the chi handler's "degraded" contract — log + return a
		// zero snapshot tagged as free tier so the frontend never hangs
		// waiting on a 5xx.
		if !errors.Is(err, context.Canceled) && s.Log != nil {
			s.Log.WarnContext(ctx, "subscription.GetQuota.degraded",
				slog.Any("err", err), slog.String("user_id", uid.String()))
		}
		return connect.NewResponse(snapshotToProto(domain.TierFree, domain.Policy(domain.TierFree), domain.QuotaUsage{})), nil
	}
	return connect.NewResponse(snapshotToProto(snap.Tier, snap.Policy, snap.Usage)), nil
}

func (s *SubscriptionServer) LinkBoosty(
	ctx context.Context,
	req *connect.Request[pb.LinkBoostyRequest],
) (*connect.Response[pb.LinkBoostyResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.LinkBoostyUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	if err := s.LinkBoostyUC.Do(ctx, app.LinkBoostyInput{
		UserID:         uid,
		BoostyUsername: req.Msg.BoostyUserId,
	}); err != nil {
		if s.Log != nil {
			s.Log.WarnContext(ctx, "subscription.LinkBoosty", slog.Any("err", err))
		}
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&pb.LinkBoostyResponse{Ok: true, Status: "linked"}), nil
}

func (s *SubscriptionServer) AdminBoostySync(
	ctx context.Context,
	_ *connect.Request[pb.AdminBoostySyncRequest],
) (*connect.Response[pb.AdminBoostySyncResponse], error) {
	if s.SyncBoostyUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	res, err := s.SyncBoostyUC.Do(ctx)
	if err != nil {
		if s.Log != nil {
			s.Log.ErrorContext(ctx, "subscription.AdminBoostySync", slog.Any("err", err))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.AdminBoostySyncResponse{Updated: int32(res.Upserted)}), nil
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
