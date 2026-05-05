package ports

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/hone/app"
	"druz9/hone/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *HoneServer) AddExternalActivity(
	ctx context.Context,
	req *connect.Request[pb.AddExternalActivityRequest],
) (*connect.Response[pb.ExternalActivity], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	in := app.AddExternalActivityInput{
		UserID:           uid,
		Source:           req.Msg.GetSource(),
		TopicAtlasNodeID: req.Msg.GetTopicAtlasNodeId(),
		TopicFreeText:    req.Msg.GetTopicFreeText(),
		DurationMin:      int(req.Msg.GetDurationMin()),
		Notes:            req.Msg.GetNotes(),
	}
	if iso := strings.TrimSpace(req.Msg.GetOccurredAtIso()); iso != "" {
		t, perr := time.Parse(time.RFC3339, iso)
		if perr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("occurred_at_iso: %w", perr))
		}
		in.OccurredAt = t
	}
	a, err := s.H.AddExternalActivity.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("hone.AddExternalActivity: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toExternalActivityProto(a)), nil
}

func (s *HoneServer) ListExternalActivity(
	ctx context.Context,
	req *connect.Request[pb.ListExternalActivityRequest],
) (*connect.Response[pb.ListExternalActivityResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	res, err := s.H.ListExternalActivity.Do(ctx, app.ListExternalActivityInput{
		UserID: uid,
		Source: req.Msg.GetSource(),
		Limit:  int(req.Msg.GetLimit()),
		Cursor: req.Msg.GetCursor(),
	})
	if err != nil {
		return nil, fmt.Errorf("hone.ListExternalActivity: %w", s.toConnectErr(err))
	}
	out := &pb.ListExternalActivityResponse{
		Items:      make([]*pb.ExternalActivity, 0, len(res.Items)),
		NextCursor: res.NextCursor,
	}
	for _, a := range res.Items {
		out.Items = append(out.Items, toExternalActivityProto(a))
	}
	return connect.NewResponse(out), nil
}

func (s *HoneServer) DeleteExternalActivity(
	ctx context.Context,
	req *connect.Request[pb.DeleteExternalActivityRequest],
) (*connect.Response[pb.DeleteExternalActivityResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	if err := s.H.DeleteExternalActivity.Do(ctx, uid, id); err != nil {
		return nil, fmt.Errorf("hone.DeleteExternalActivity: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DeleteExternalActivityResponse{}), nil
}

func (s *HoneServer) ListAtlasNodeTracks(
	ctx context.Context,
	_ *connect.Request[pb.ListAtlasNodeTracksRequest],
) (*connect.Response[pb.ListAtlasNodeTracksResponse], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	items, err := s.H.ListAtlasNodeTracks.Do(ctx)
	if err != nil {
		return nil, fmt.Errorf("hone.ListAtlasNodeTracks: %w", s.toConnectErr(err))
	}
	out := &pb.ListAtlasNodeTracksResponse{Items: make([]*pb.AtlasNodeTrack, 0, len(items))}
	for _, t := range items {
		out.Items = append(out.Items, &pb.AtlasNodeTrack{AtlasNodeId: t.AtlasNodeID, TrackKind: t.TrackKind})
	}
	return connect.NewResponse(out), nil
}

func (s *HoneServer) SearchAtlasTopics(
	ctx context.Context,
	req *connect.Request[pb.SearchAtlasTopicsRequest],
) (*connect.Response[pb.SearchAtlasTopicsResponse], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	items, err := s.H.SearchAtlasTopics.Do(ctx, req.Msg.GetPrefix(), int(req.Msg.GetLimit()))
	if err != nil {
		return nil, fmt.Errorf("hone.SearchAtlasTopics: %w", s.toConnectErr(err))
	}
	out := &pb.SearchAtlasTopicsResponse{Items: make([]*pb.AtlasTopicSuggestion, 0, len(items))}
	for _, it := range items {
		out.Items = append(out.Items, &pb.AtlasTopicSuggestion{
			AtlasNodeId: it.AtlasNodeID,
			Title:       it.Title,
			Section:     it.Section,
		})
	}
	return connect.NewResponse(out), nil
}

func toExternalActivityProto(a domain.ExternalActivity) *pb.ExternalActivity {
	out := &pb.ExternalActivity{
		Id:               a.ID.String(),
		Source:           string(a.Source),
		TopicAtlasNodeId: a.TopicAtlasNodeID,
		TopicFreeText:    a.TopicFreeText,
		DurationMin:      int32(a.DurationMin),
		Notes:            a.Notes,
	}
	if !a.OccurredAt.IsZero() {
		out.OccurredAt = timestamppb.New(a.OccurredAt.UTC())
	}
	if !a.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(a.CreatedAt.UTC())
	}
	return out
}
