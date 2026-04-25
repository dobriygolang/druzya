// Package ports exposes the intelligence domain via Connect-RPC.
//
// IntelligenceServer implements druz9v1connect.IntelligenceServiceHandler
// (generated from intelligence.proto by `make gen-proto`).
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"druz9/intelligence/app"
	"druz9/intelligence/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion: enabled once make gen-proto produces the
// generated handler.
var _ druz9v1connect.IntelligenceServiceHandler = (*IntelligenceServer)(nil)

// IntelligenceServer adapts intelligence use cases to Connect.
type IntelligenceServer struct {
	H *app.Handler
}

// NewIntelligenceServer wires a server around the Handler.
func NewIntelligenceServer(h *app.Handler) *IntelligenceServer {
	return &IntelligenceServer{H: h}
}

// GetDailyBrief implements druz9.v1.IntelligenceService/GetDailyBrief.
func (s *IntelligenceServer) GetDailyBrief(
	ctx context.Context,
	req *connect.Request[pb.GetDailyBriefRequest],
) (*connect.Response[pb.DailyBrief], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	brief, err := s.H.GetDailyBrief.Do(ctx, app.GetDailyBriefInput{
		UserID: uid,
		Force:  req.Msg.GetForce(),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetDailyBrief: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toDailyBriefProto(brief)), nil
}

// AskNotes implements druz9.v1.IntelligenceService/AskNotes.
func (s *IntelligenceServer) AskNotes(
	ctx context.Context,
	req *connect.Request[pb.AskNotesRequest],
) (*connect.Response[pb.AskAnswer], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	question := strings.TrimSpace(req.Msg.GetQuestion())
	if question == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("question required"))
	}
	ans, err := s.H.AskNotes.Do(ctx, app.AskNotesInput{UserID: uid, Question: question})
	if err != nil {
		return nil, fmt.Errorf("intelligence.AskNotes: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toAskAnswerProto(ans)), nil
}

// ─── helpers ──────────────────────────────────────────────────────────────

func requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func (s *IntelligenceServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, domain.ErrRateLimited):
		return connect.NewError(connect.CodeResourceExhausted, err)
	case errors.Is(err, domain.ErrLLMUnavailable), errors.Is(err, domain.ErrEmbeddingUnavailable):
		s.H.Log.Warn("intelligence: AI subsystem unavailable", slog.Any("err", err))
		return connect.NewError(connect.CodeUnavailable, err)
	default:
		s.H.Log.Error("intelligence: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("intelligence failure"))
	}
}

// ─── converters (domain → proto) ──────────────────────────────────────────

func toDailyBriefProto(b domain.DailyBrief) *pb.DailyBrief {
	out := &pb.DailyBrief{
		Headline:    b.Headline,
		Narrative:   b.Narrative,
		GeneratedAt: timestamppb.New(b.GeneratedAt.UTC()),
	}
	for _, r := range b.Recommendations {
		out.Recommendations = append(out.Recommendations, &pb.BriefRecommendation{
			Kind:      toRecommendationKindProto(r.Kind),
			Title:     r.Title,
			Rationale: r.Rationale,
			TargetId:  r.TargetID,
		})
	}
	return out
}

func toRecommendationKindProto(k domain.RecommendationKind) pb.BriefRecommendationKind {
	switch k {
	case domain.RecommendationTinyTask:
		return pb.BriefRecommendationKind_BRIEF_RECOMMENDATION_KIND_TINY_TASK
	case domain.RecommendationSchedule:
		return pb.BriefRecommendationKind_BRIEF_RECOMMENDATION_KIND_SCHEDULE
	case domain.RecommendationReviewNote:
		return pb.BriefRecommendationKind_BRIEF_RECOMMENDATION_KIND_REVIEW_NOTE
	case domain.RecommendationUnblock:
		return pb.BriefRecommendationKind_BRIEF_RECOMMENDATION_KIND_UNBLOCK
	default:
		return pb.BriefRecommendationKind_BRIEF_RECOMMENDATION_KIND_UNSPECIFIED
	}
}

func toAskAnswerProto(a domain.AskAnswer) *pb.AskAnswer {
	out := &pb.AskAnswer{AnswerMd: a.AnswerMD}
	for _, c := range a.Citations {
		out.Citations = append(out.Citations, &pb.Citation{
			NoteId:  c.NoteID.String(),
			Title:   c.Title,
			Snippet: c.Snippet,
		})
	}
	return out
}
