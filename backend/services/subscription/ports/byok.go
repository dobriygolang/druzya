// byok.go — Connect-RPC handlers для Stream-C BYOK + GetTier endpoints.
//
// GetTier возвращает source-aware projection. SetBYOKKey/RemoveBYOKKey —
// само-сервис BYOK flow для авторизованного юзера.
package ports

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/subscription/app"
	"druz9/subscription/domain"
)

// GetTier — Stream-C MVP endpoint. Возвращает TierInfo с source (free/pro/
// byok/tutor). Не путать с GetMyTier (legacy: возвращает raw subscriptions
// row). У них разные потребители: GetMyTier — for billing-page expiry, GetTier —
// for paywall-gates UI.
func (s *SubscriptionServer) GetTier(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[pb.TierInfo], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.CheckTierUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	info, err := s.CheckTierUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("subscription.GetTier: %w", err)
	}
	return connect.NewResponse(tierInfoToProto(info)), nil
}

// SetBYOKKey — принимает provider + plain api_key. Валидирует, шифрует,
// сохраняет. Возвращает обновлённый TierInfo (source=byok при успехе).
func (s *SubscriptionServer) SetBYOKKey(
	ctx context.Context,
	req *connect.Request[pb.SetBYOKKeyRequest],
) (*connect.Response[pb.TierInfo], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.SetBYOKKeyUC == nil || s.CheckTierUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	provider := domain.BYOKProvider(req.Msg.GetProvider())
	if err := s.SetBYOKKeyUC.Do(ctx, app.SetBYOKKeyInput{
		UserID:   uid,
		Provider: provider,
		APIKey:   req.Msg.GetApiKey(),
	}); err != nil {
		// Map domain errors на грамотные Connect codes — фронт показывает разные тосты.
		switch {
		case errors.Is(err, domain.ErrInvalidBYOKProvider):
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		case errors.Is(err, domain.ErrBYOKValidationFailed):
			return nil, connect.NewError(connect.CodePermissionDenied, err)
		default:
			return nil, fmt.Errorf("subscription.SetBYOKKey: %w", err)
		}
	}
	info, err := s.CheckTierUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("subscription.SetBYOKKey: check_tier: %w", err)
	}
	return connect.NewResponse(tierInfoToProto(info)), nil
}

// RemoveBYOKKey — снимает BYOK-ключ. Idempotent.
func (s *SubscriptionServer) RemoveBYOKKey(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[pb.TierInfo], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.RemoveBYOKKeyUC == nil || s.CheckTierUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	if err := s.RemoveBYOKKeyUC.Do(ctx, uid); err != nil {
		return nil, fmt.Errorf("subscription.RemoveBYOKKey: %w", err)
	}
	info, err := s.CheckTierUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("subscription.RemoveBYOKKey: check_tier: %w", err)
	}
	return connect.NewResponse(tierInfoToProto(info)), nil
}

// tierInfoToProto — конвертация app.TierInfo → pb.TierInfo. Generated field
// name для byok_provider — ByokProvider (protoc lowercases segments после
// underscore, не recognising 'BYOK' как acronym).
func tierInfoToProto(info app.TierInfo) *pb.TierInfo {
	out := &pb.TierInfo{
		Tier:         string(info.Tier),
		Source:       string(info.Source),
		ByokProvider: string(info.BYOKProvider),
	}
	if info.ExpiresAt != nil {
		out.ExpiresAt = timestamppb.New(info.ExpiresAt.UTC())
	}
	return out
}
