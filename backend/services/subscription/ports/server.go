// Package ports — HTTP/Connect-RPC слой subscription-сервиса.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/subscription/app"
	"druz9/subscription/domain"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// adminRole — значение роли для admin-gate. Совпадает с тем, что использует
// services/admin/ports/server.go (синхронизируется вручную при изменении).
const adminRole = "admin"

// Compile-time: наш SubscriptionServer реализует generated handler.
var _ druz9v1connect.SubscriptionServiceHandler = (*SubscriptionServer)(nil)

// SubscriptionServer адаптирует use-case'ы на Connect-RPC.
type SubscriptionServer struct {
	GetTierUC *app.GetTier
	SetTierUC *app.SetTier
	Log       *slog.Logger
}

// NewSubscriptionServer — конструктор.
func NewSubscriptionServer(get *app.GetTier, set *app.SetTier, log *slog.Logger) *SubscriptionServer {
	return &SubscriptionServer{GetTierUC: get, SetTierUC: set, Log: log}
}

// GetMyTier — для авторизованного юзера. user_id из JWT.
func (s *SubscriptionServer) GetMyTier(
	ctx context.Context,
	_ *connect.Request[pb.GetMyTierRequest],
) (*connect.Response[pb.GetMyTierResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	sub, err := s.GetTierUC.DoFull(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("subscription.GetMyTier: %w", err)
	}
	resp := &pb.GetMyTierResponse{
		Tier:     string(sub.Tier),
		Status:   string(sub.Status),
		Provider: string(sub.Provider),
	}
	if sub.CurrentPeriodEnd != nil {
		resp.CurrentPeriodEnd = timestamppb.New(sub.CurrentPeriodEnd.UTC())
	}
	if sub.GraceUntil != nil {
		resp.GraceUntil = timestamppb.New(sub.GraceUntil.UTC())
	}
	return connect.NewResponse(resp), nil
}

// GetTierByUserID — internal service-to-service RPC. Не expose'им REST-ом
// (нет google.api.http аннотации → vanguard не мэппит).
func (s *SubscriptionServer) GetTierByUserID(
	ctx context.Context,
	req *connect.Request[pb.GetTierByUserIDRequest],
) (*connect.Response[pb.GetTierByUserIDResponse], error) {
	uid, err := uuid.Parse(req.Msg.GetUserId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid user_id: %w", err))
	}
	tier, err := s.GetTierUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("subscription.GetTierByUserID: %w", err)
	}
	return connect.NewResponse(&pb.GetTierByUserIDResponse{Tier: string(tier)}), nil
}

// AdminSetTier — требует role=admin. Используется для ручной выдачи (тестеры,
// поддержка, до того как M3 настроит Boosty-sync).
func (s *SubscriptionServer) AdminSetTier(
	ctx context.Context,
	req *connect.Request[pb.AdminSetTierRequest],
) (*connect.Response[pb.AdminSetTierResponse], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	m := req.Msg
	uid, err := uuid.Parse(m.GetUserId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid user_id: %w", err))
	}
	tier := enums.SubscriptionPlan(m.GetTier())
	if !tier.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("invalid tier %q; expected free|seeker|ascendant", m.GetTier()))
	}
	in := app.SetTierInput{
		UserID:   uid,
		Tier:     tier,
		Provider: domain.ProviderAdmin,
		Reason:   m.GetReason(),
	}
	if ts := m.GetCurrentPeriodEnd(); ts.IsValid() {
		t := ts.AsTime()
		in.CurrentPeriodEnd = &t
	}
	if err := s.SetTierUC.Do(ctx, in); err != nil {
		return nil, fmt.Errorf("subscription.AdminSetTier: %w", err)
	}
	return connect.NewResponse(&pb.AdminSetTierResponse{Ok: true}), nil
}

// requireAdmin — reuse паттерна из services/admin/ports/server.go.
// Синхронизируется руками при изменении role-модели.
func (s *SubscriptionServer) requireAdmin(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	role, rok := sharedMw.UserRoleFromContext(ctx)
	if !rok || role != adminRole {
		return uuid.Nil, connect.NewError(connect.CodePermissionDenied, errors.New("admin role required"))
	}
	return uid, nil
}
