// Package ports — Connect-RPC adapter for the cohort announcement feed.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/cohort_announcement/app"
	"druz9/cohort_announcement/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var _ druz9v1connect.CohortAnnouncementServiceHandler = (*Server)(nil)

type Server struct {
	CreateUC *app.CreateAnnouncement
	ListUC   *app.ListByCohort
	DeleteUC *app.DeleteAnnouncement
	AddUC    *app.AddReaction
	RemoveUC *app.RemoveReaction
	Log      *slog.Logger
}

func NewServer(create *app.CreateAnnouncement, list *app.ListByCohort, del *app.DeleteAnnouncement, add *app.AddReaction, remove *app.RemoveReaction, log *slog.Logger) *Server {
	return &Server{CreateUC: create, ListUC: list, DeleteUC: del, AddUC: add, RemoveUC: remove, Log: log}
}

func (s *Server) CreateAnnouncement(
	ctx context.Context,
	req *connect.Request[pb.CreateAnnouncementRequest],
) (*connect.Response[pb.CohortAnnouncement], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	cohortID, err := uuid.Parse(req.Msg.GetCohortId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cohort_id: %w", err))
	}
	out, err := s.CreateUC.Do(ctx, app.CreateAnnouncementInput{
		CohortID: cohortID,
		AuthorID: uid,
		Body:     req.Msg.GetBody(),
		Pinned:   req.Msg.GetPinned(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toAnnouncementProto(out)), nil
}

func (s *Server) ListByCohort(
	ctx context.Context,
	req *connect.Request[pb.ListAnnouncementsRequest],
) (*connect.Response[pb.CohortAnnouncementList], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	cohortID, err := uuid.Parse(req.Msg.GetCohortId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cohort_id: %w", err))
	}
	rows, err := s.ListUC.Do(ctx, app.ListByCohortInput{
		CohortID: cohortID,
		ViewerID: uid,
		Limit:    int(req.Msg.GetLimit()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.CohortAnnouncementList{Items: make([]*pb.CohortAnnouncement, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, toAnnouncementProto(r))
	}
	return connect.NewResponse(out), nil
}

func (s *Server) DeleteAnnouncement(
	ctx context.Context,
	req *connect.Request[pb.DeleteAnnouncementRequest],
) (*connect.Response[pb.DeleteAnnouncementResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetAnnouncementId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid announcement_id: %w", err))
	}
	if err := s.DeleteUC.Do(ctx, id, uid); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.DeleteAnnouncementResponse{}), nil
}

func (s *Server) AddReaction(
	ctx context.Context,
	req *connect.Request[pb.AddReactionRequest],
) (*connect.Response[pb.ReactionResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetAnnouncementId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid announcement_id: %w", err))
	}
	count, err := s.AddUC.Do(ctx, id, uid, req.Msg.GetEmoji())
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.ReactionResponse{
		AnnouncementId: req.Msg.GetAnnouncementId(),
		Emoji:          req.Msg.GetEmoji(),
		Count:          int32(count),
	}), nil
}

func (s *Server) RemoveReaction(
	ctx context.Context,
	req *connect.Request[pb.RemoveReactionRequest],
) (*connect.Response[pb.ReactionResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.GetAnnouncementId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid announcement_id: %w", err))
	}
	count, err := s.RemoveUC.Do(ctx, id, uid, req.Msg.GetEmoji())
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.ReactionResponse{
		AnnouncementId: req.Msg.GetAnnouncementId(),
		Emoji:          req.Msg.GetEmoji(),
		Count:          int32(count),
	}), nil
}

func (s *Server) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrEmptyBody),
		errors.Is(err, domain.ErrInvalidEmoji):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("cohort_announcement: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("announcement failure"))
	}
}

func toAnnouncementProto(a domain.Announcement) *pb.CohortAnnouncement {
	out := &pb.CohortAnnouncement{
		Id:                a.ID.String(),
		CohortId:          a.CohortID.String(),
		AuthorId:          a.AuthorID.String(),
		AuthorUsername:    a.AuthorUsername,
		AuthorDisplayName: a.AuthorDisplayName,
		Body:              a.Body,
		Pinned:            a.Pinned,
		ViewerReacted:     append([]string(nil), a.ViewerReacted...),
	}
	if !a.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(a.CreatedAt.UTC())
	}
	if !a.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(a.UpdatedAt.UTC())
	}
	for _, r := range a.Reactions {
		out.Reactions = append(out.Reactions, &pb.AnnouncementReactionGroup{
			Emoji: r.Emoji,
			Count: int32(r.Count),
		})
	}
	return out
}
