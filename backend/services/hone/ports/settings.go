package ports

import (
	"context"
	"fmt"

	"druz9/hone/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *HoneServer) GetUserSettings(
	ctx context.Context,
	_ *connect.Request[pb.GetUserSettingsRequest],
) (*connect.Response[pb.UserSettings], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.H.GetUserSettings.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("hone.GetUserSettings: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toUserSettingsProto(st)), nil
}

func (s *HoneServer) SetActiveTrack(
	ctx context.Context,
	req *connect.Request[pb.SetActiveTrackRequest],
) (*connect.Response[pb.UserSettings], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.H.SetActiveTrack.Do(ctx, uid, domain.ActiveTrack(req.Msg.GetActiveTrack()))
	if err != nil {
		return nil, fmt.Errorf("hone.SetActiveTrack: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toUserSettingsProto(st)), nil
}

func (s *HoneServer) SetEnglishActive(
	ctx context.Context,
	req *connect.Request[pb.SetEnglishActiveRequest],
) (*connect.Response[pb.UserSettings], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.H.SetEnglishActive.Do(ctx, uid, req.Msg.GetActive())
	if err != nil {
		return nil, fmt.Errorf("hone.SetEnglishActive: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toUserSettingsProto(st)), nil
}

func toUserSettingsProto(s domain.UserSettings) *pb.UserSettings {
	out := &pb.UserSettings{
		ActiveTrack:   string(s.ActiveTrack),
		EnglishActive: s.EnglishActive,
	}
	if !s.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(s.UpdatedAt.UTC())
	}
	return out
}
