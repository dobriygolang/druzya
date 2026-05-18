package ports

import (
	"druz9/intelligence/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// domain ↔ proto мапперы для Connect-RPC ответов intelligence-сервиса.

func toDailyBriefProto(b domain.DailyBrief) *pb.DailyBrief {
	out := &pb.DailyBrief{
		Headline:       b.Headline,
		Narrative:      b.Narrative,
		GeneratedAt:    timestamppb.New(b.GeneratedAt.UTC()),
		Severity:       insightSeverityToProto(b.Severity),
		SeverityReason: b.SeverityReason,
	}
	if b.BriefID != uuid.Nil {
		out.BriefId = b.BriefID.String()
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
	}
	return pb.BriefRecommendationKind_BRIEF_RECOMMENDATION_KIND_UNSPECIFIED
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

func toResourceTrailProto(t domain.ResourceEngagement) *pb.ResourceTrail {
	out := &pb.ResourceTrail{
		UnfinishedCount: int32(t.UnfinishedCount),
	}
	for _, r := range t.FinishedRecent {
		out.FinishedRecent = append(out.FinishedRecent, toResourceTouchProto(r))
	}
	for _, r := range t.MarkedUnhelpful {
		out.MarkedUnhelpful = append(out.MarkedUnhelpful, toResourceTouchProto(r))
	}
	for _, r := range t.RecentReflections {
		out.RecentReflections = append(out.RecentReflections, toResourceTouchProto(r))
	}
	return out
}

func toResourceTouchProto(r domain.ResourceTouch) *pb.ResourceTouch {
	out := &pb.ResourceTouch{
		Url:            r.URL,
		AtlasNodeId:    r.AtlasNodeID,
		Kind:           r.Kind,
		HoursAgo:       int32(r.HoursAgo),
		ReflectionText: r.Reflection,
	}
	if !r.OccurredAt.IsZero() {
		out.OccurredAt = timestamppb.New(r.OccurredAt.UTC())
	}
	return out
}
