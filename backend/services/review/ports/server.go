// Package ports exposes the review domain via Connect-RPC.
//
// ReviewServer implements druz9v1connect.ReviewServiceHandler. Mounted in
// cmd/monolith/services/review.go via NewReviewServiceHandler + vanguard
// for both native Connect (/druz9.v1.ReviewService/*) and REST
// (/api/v1/review*).
//
// AuthN: CreateReview requires bearer token (caller becomes ReviewerID).
//
//	ListReviewsByInterviewer + GetInterviewerStats are read-only
//	public endpoints.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/review/app"
	"druz9/review/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var _ druz9v1connect.ReviewServiceHandler = (*ReviewServer)(nil)

type ReviewServer struct {
	CreateUC *app.CreateReview
	ListUC   *app.ListByInterviewer
	StatsUC  *app.GetInterviewerStats
	Log      *slog.Logger
}

func NewReviewServer(create *app.CreateReview, list *app.ListByInterviewer, stats *app.GetInterviewerStats, log *slog.Logger) *ReviewServer {
	return &ReviewServer{CreateUC: create, ListUC: list, StatsUC: stats, Log: log}
}

func (s *ReviewServer) CreateReview(
	ctx context.Context,
	req *connect.Request[pb.CreateReviewRequest],
) (*connect.Response[pb.Review], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	bookingID, err := uuid.Parse(req.Msg.GetBookingId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid booking_id: %w", err))
	}
	dir := directionFromProto(req.Msg.GetDirection())
	rev, err := s.CreateUC.Do(ctx, app.CreateReviewInput{
		BookingID:  bookingID,
		ReviewerID: uid,
		Direction:  dir,
		Rating:     int(req.Msg.GetRating()),
		Feedback:   req.Msg.GetFeedback(),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toReviewProto(rev)), nil
}

func (s *ReviewServer) ListReviewsByInterviewer(
	ctx context.Context,
	req *connect.Request[pb.ListReviewsByInterviewerRequest],
) (*connect.Response[pb.ReviewList], error) {
	id, err := uuid.Parse(req.Msg.GetInterviewerId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid interviewer_id: %w", err))
	}
	rows, err := s.ListUC.Do(ctx, app.ListByInterviewerInput{
		InterviewerID: id,
		Limit:         int(req.Msg.GetLimit()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.ReviewList{Items: make([]*pb.Review, 0, len(rows))}
	for _, r := range rows {
		out.Items = append(out.Items, toReviewProto(r))
	}
	return connect.NewResponse(out), nil
}

func (s *ReviewServer) GetInterviewerStats(
	ctx context.Context,
	req *connect.Request[pb.GetInterviewerStatsRequest],
) (*connect.Response[pb.InterviewerStats], error) {
	id, err := uuid.Parse(req.Msg.GetInterviewerId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid interviewer_id: %w", err))
	}
	st, err := s.StatsUC.Do(ctx, id)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.InterviewerStats{
		InterviewerId: id.String(),
		AvgRating:     st.AvgRating,
		ReviewsCount:  int32(st.ReviewsCount),
	}), nil
}

func (s *ReviewServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrAlreadyReviewed):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, domain.ErrForbidden):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrInvalidRating),
		errors.Is(err, domain.ErrEmptyBookingID):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("review: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("review failure"))
	}
}

func toReviewProto(r domain.Review) *pb.Review {
	out := &pb.Review{
		Id:            r.BookingID.String() + ":" + string(r.Direction),
		BookingId:     r.BookingID.String(),
		ReviewerId:    r.ReviewerID.String(),
		InterviewerId: r.InterviewerID.String(),
		SubjectId:     r.SubjectID.String(),
		Direction:     directionToProto(r.Direction),
		Rating:        int32(r.Rating),
		Feedback:      r.Feedback,
	}
	if !r.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(r.CreatedAt.UTC())
	}
	if !r.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(r.UpdatedAt.UTC())
	}
	return out
}

func directionFromProto(d pb.ReviewDirection) domain.Direction {
	switch d {
	case pb.ReviewDirection_REVIEW_DIRECTION_INTERVIEWER_TO_CANDIDATE:
		return domain.DirInterviewerToCandidate
	default: // includes UNSPECIFIED → default to candidate→interviewer for back-compat
		return domain.DirCandidateToInterviewer
	}
}

func directionToProto(d domain.Direction) pb.ReviewDirection {
	switch d {
	case domain.DirInterviewerToCandidate:
		return pb.ReviewDirection_REVIEW_DIRECTION_INTERVIEWER_TO_CANDIDATE
	case domain.DirCandidateToInterviewer:
		return pb.ReviewDirection_REVIEW_DIRECTION_CANDIDATE_TO_INTERVIEWER
	default:
		return pb.ReviewDirection_REVIEW_DIRECTION_UNSPECIFIED
	}
}
