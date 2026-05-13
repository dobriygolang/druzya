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
	"time"

	"druz9/intelligence/app"
	"druz9/intelligence/domain"
	lsDomain "druz9/learning_state/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/llmchain"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion: enabled once make gen-proto produces the
// generated handler.
var _ druz9v1connect.IntelligenceServiceHandler = (*IntelligenceServer)(nil)

// IntelligenceServer adapts intelligence use cases to Connect. Every UC
// pointer below is nil-safe: when absent, the corresponding RPC returns
// Unavailable instead of crashing — wiring happens incrementally in
// bootstrap.
type IntelligenceServer struct {
	H      *app.Handler
	Memory *app.Memory

	ListInsightsUC *app.ListInsights
	AckInsightUC   *app.AckInsight

	NextActionUC      *app.GetNextAction
	NextActionContext NextActionContextLoader
	ForkSnapshotUC    *app.GetForkSnapshot
	LogResourceUC     *app.LogResource

	// LearningStateMutator delegates to learning_state.app.SetMode / SetFork.
	// Interface keeps intelligence from importing learning_state directly.
	LearningState LearningStateMutator

	ResourceTrailReader domain.ResourceEngagementReader
	SkillRadarUC        *app.GetSkillRadar
	CoachStatsUC        *app.GetCoachStats

	CreateGoalUC     *app.CreateGoal
	GetActiveGoalUC  *app.GetActiveGoal
	UpdateGoalUC     *app.UpdateGoal
	DeactivateGoalUC *app.DeactivateGoal

	IngestInterviewSessionUC *app.IngestSessionTranscript
	ListInterviewSessionsUC  *app.ListInterviewSessions

	GenerateMilestonesUC *app.GenerateMilestones
	GetMilestonesUC      *app.GetMilestones
	MarkMilestoneDoneUC  *app.MarkMilestoneDone

	GetNodeCoverageUC *app.GetNodeCoverage

	ListMemoryEntriesUC *app.ListMemoryEntries
	DeleteMemoryEntryUC *app.DeleteMemoryEntry
	EditMemoryEntryUC   *app.EditMemoryEntry

	SaveFocusReflectionUC  *app.SaveFocusReflection
	ListFocusReflectionsUC *app.ListFocusReflections

	// Cue copilot reads context directly via in-process adapter; this RPC
	// is for /admin parity (debug a user's context bundle).
	GetUserContextUC *app.GetUserContext

	MarkAtlasStruggleUC  *app.MarkAtlasStruggle
	ListAtlasStrugglesUC *app.ListAtlasStruggles
	ClearAtlasStruggleUC *app.ClearAtlasStruggle

	// Wave 15: Cross-vertical insights v2. Lives alongside primary
	// ListInsights but reads multi-axis producers (English / Mock / Vocab).
	CrossVerticalInsightsUC *app.CrossVerticalInsights
}

// LearningStateMutator — handler-injected port для SetLearningMode +
// SetForkBranch RPCs. Bootstrap'ом обёртывает learning_state UCs.
type LearningStateMutator interface {
	SetMode(ctx context.Context, userID uuid.UUID, mode string, trackID *uuid.UUID) (LearningStateSnapshot, error)
	SetFork(ctx context.Context, userID uuid.UUID, branch string) (LearningStateSnapshot, error)
}

// LearningStateSnapshot — wire-shape после mutation. Mirror'ит
// learning_state.domain.State минус timestamp поля (UI не нужны).
type LearningStateSnapshot struct {
	Mode             string
	ForkBranch       string
	ExploreWeekIndex int
	CommittedTrackID string
}

// NextActionContextLoader — caller-injected loader, который собирает
// NextActionInput из readers. Вынесен в interface чтобы handler не
// импортировал readers напрямую (DI через bootstrap).
type NextActionContextLoader interface {
	LoadNextActionContext(ctx context.Context, userID uuid.UUID) (app.NextActionInput, error)
}

// NewIntelligenceServer wires a server around the Handler. All optional
// dependencies may be nil — the corresponding RPCs return Unavailable.
func NewIntelligenceServer(
	h *app.Handler,
	mem *app.Memory,
	insightList *app.ListInsights,
	insightAck *app.AckInsight,
) *IntelligenceServer {
	return &IntelligenceServer{
		H:              h,
		Memory:         mem,
		ListInsightsUC: insightList,
		AckInsightUC:   insightAck,
	}
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
		// Wave 15: surface bias — normalise to web|hone|cue, default web.
		Source: normaliseBriefSource(req.Msg.GetSource()),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetDailyBrief: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toDailyBriefProto(brief)), nil
}

// normaliseBriefSource — clamps user-supplied source to closed set.
// Unknown / empty values fall back to "web".
func normaliseBriefSource(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "hone":
		return "hone"
	case "cue":
		return "cue"
	}
	return "web"
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

// AckRecommendation implements brief feedback handler. Пишет
// brief_followed / brief_dismissed episode для memory layer'а.
func (s *IntelligenceServer) AckRecommendation(
	ctx context.Context,
	req *connect.Request[pb.AckRecommendationRequest],
) (*connect.Response[pb.AckRecommendationResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.Memory == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			errors.New("memory layer not configured"))
	}
	briefID, err := uuid.Parse(req.Msg.GetBriefId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("brief_id: %w", err))
	}
	if briefID == uuid.Nil {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("brief_id required"))
	}
	if err := s.Memory.AckRecommendation(ctx, uid, briefID, int(req.Msg.GetIndex()), req.Msg.GetFollowed()); err != nil {
		return nil, fmt.Errorf("intelligence.AckRecommendation: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.AckRecommendationResponse{Ok: true}), nil
}

// GetMemoryStats implements lightweight count for the trust indicator.
func (s *IntelligenceServer) GetMemoryStats(
	ctx context.Context,
	_ *connect.Request[pb.GetMemoryStatsRequest],
) (*connect.Response[pb.MemoryStats], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.Memory == nil {
		// Не падаем — возвращаем нулевую статистику. UI покажет
		// «LEARNING ABOUT YOU…».
		return connect.NewResponse(&pb.MemoryStats{}), nil
	}
	stats, err := s.Memory.Episodes.Stats30d(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetMemoryStats: %w", s.toConnectErr(err))
	}
	out := &pb.MemoryStats{
		Total_30D: int32(stats.TotalLast30d),
		ByKind:    make(map[string]int32, len(stats.ByKind)),
	}
	for k, v := range stats.ByKind {
		out.ByKind[string(k)] = int32(v)
	}
	return connect.NewResponse(out), nil
}

// ListInsights — surface-scoped feed.
func (s *IntelligenceServer) ListInsights(
	ctx context.Context,
	req *connect.Request[pb.ListInsightsRequest],
) (*connect.Response[pb.ListInsightsResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.ListInsightsUC == nil {
		// nil-safe: no insights wired yet. Return empty list rather
		// than a 503 — clients render an empty state cleanly.
		return connect.NewResponse(&pb.ListInsightsResponse{}), nil
	}
	surface := domain.InsightSurface(req.Msg.GetSurface())
	if surface == "" {
		surface = domain.InsightSurfaceToday
	}
	if !surface.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid surface"))
	}
	res, err := s.ListInsightsUC.Do(ctx, app.ListInsightsInput{
		UserID:  uid,
		Surface: surface,
		Limit:   int(req.Msg.GetLimit()),
		Offset:  int(req.Msg.GetOffset()),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.ListInsights: %w", s.toConnectErr(err))
	}
	out := &pb.ListInsightsResponse{
		Items: make([]*pb.Insight, 0, len(res.Items)),
		Total: int32(res.Total),
	}
	for _, r := range res.Items {
		out.Items = append(out.Items, insightToProto(r))
	}
	return connect.NewResponse(out), nil
}

// AckInsight — user-feedback tap.
func (s *IntelligenceServer) AckInsight(
	ctx context.Context,
	req *connect.Request[pb.AckInsightRequest],
) (*connect.Response[pb.AckInsightResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if s.AckInsightUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			errors.New("insight stream not configured"))
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	action := strings.ToLower(strings.TrimSpace(req.Msg.GetAction()))
	if action != "follow" && action != "dismiss" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("action must be 'follow' or 'dismiss'"))
	}
	if err := s.AckInsightUC.Do(ctx, app.AckInsightInput{
		UserID:    uid,
		InsightID: id,
		Action:    action,
	}); err != nil {
		return nil, fmt.Errorf("intelligence.AckInsight: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.AckInsightResponse{Ok: true}), nil
}

func insightToProto(in domain.Insight) *pb.Insight {
	out := &pb.Insight{
		Id:          in.ID.String(),
		Surface:     string(in.Surface),
		Severity:    insightSeverityToProto(in.Severity),
		Anchor:      in.Anchor,
		Headline:    in.Headline,
		Evidence:    in.Evidence,
		Interpret:   in.Interpret,
		Lever:       in.Lever,
		DeepLink:    in.DeepLink,
		SkillKey:    in.SkillKey,
		CodexSlug:   in.CodexSlug,
		GeneratedAt: timestamppb.New(in.GeneratedAt.UTC()),
		ExpiresAt:   timestamppb.New(in.ExpiresAt.UTC()),
	}
	if in.EventID != nil {
		out.EventId = in.EventID.String()
	}
	if in.TrackID != nil {
		out.TrackId = in.TrackID.String()
	}
	return out
}

func insightSeverityToProto(s domain.InsightSeverity) pb.InsightSeverity {
	switch s {
	case domain.InsightSeverityCruise:
		return pb.InsightSeverity_INSIGHT_SEVERITY_CRUISE
	case domain.InsightSeverityNudge:
		return pb.InsightSeverity_INSIGHT_SEVERITY_NUDGE
	case domain.InsightSeverityWarn:
		return pb.InsightSeverity_INSIGHT_SEVERITY_WARN
	case domain.InsightSeverityCritical:
		return pb.InsightSeverity_INSIGHT_SEVERITY_CRITICAL
	}
	return pb.InsightSeverity_INSIGHT_SEVERITY_UNSPECIFIED
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
	case errors.Is(err, domain.ErrNotFound), errors.Is(err, domain.ErrEpisodeNotFound), errors.Is(err, domain.ErrInsightNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, lsDomain.ErrInvalidTransition):
		// SetLearningMode: commit/deep требуют active track. Frontend
		// должен показать tooltip «pick a track first», а не «server error».
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, domain.ErrRateLimited):
		return connect.NewError(connect.CodeResourceExhausted, err)
	case errors.Is(err, llmchain.ErrTierRequired):
		// Tier-downgrade pinned model → frontend ловит CodeFailedPrecondition
		// + читает details для upgrade-prompt'а.
		return connect.NewError(connect.CodeFailedPrecondition, err)
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

// ── Learning-companion handlers ─────────────────────────────────

// GetNextAction implements druz9.v1.IntelligenceService/GetNextAction.
func (s *IntelligenceServer) GetNextAction(
	ctx context.Context,
	_ *connect.Request[pb.GetNextActionRequest],
) (*connect.Response[pb.NextAction], error) {
	if s.NextActionUC == nil || s.NextActionContext == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("intelligence.GetNextAction: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	in, err := s.NextActionContext.LoadNextActionContext(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetNextAction load: %w", s.toConnectErr(err))
	}
	in.UserID = uid
	out, err := s.NextActionUC.Do(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetNextAction: %w", s.toConnectErr(err))
	}
	resp := &pb.NextAction{
		ActionKind:       out.ActionKind,
		Target:           out.Target,
		Rationale:        out.Rationale,
		EstimatedMinutes: int32(out.EstimatedMinutes),
	}
	// Wave 15: secondary action from cross-vertical insights (severity ≥ warn).
	// Fail-soft — broken cross UC doesn't block the primary action.
	if s.CrossVerticalInsightsUC != nil {
		if cv, cvErr := s.CrossVerticalInsightsUC.Do(ctx, app.ListCrossVerticalInsightsInput{UserID: uid}); cvErr == nil {
			for _, ins := range cv.Items {
				if ins.SeverityAtLeast(domain.InsightSeverityWarn) {
					resp.SecondaryKind = ins.Kind
					resp.SecondaryMessageMd = ins.MessageMD
					resp.SecondaryActionUrl = ins.SuggestedActionURL
					resp.SecondaryActionLabel = ins.SuggestedActionLabel
					break
				}
			}
		}
	}
	return connect.NewResponse(resp), nil
}

// ListCrossVerticalInsights implements druz9.v1.IntelligenceService/ListCrossVerticalInsights.
// nil-safe: returns empty list when UC isn't wired.
func (s *IntelligenceServer) ListCrossVerticalInsights(
	ctx context.Context,
	_ *connect.Request[pb.ListCrossVerticalInsightsRequest],
) (*connect.Response[pb.ListCrossVerticalInsightsResponse], error) {
	if s.CrossVerticalInsightsUC == nil {
		return connect.NewResponse(&pb.ListCrossVerticalInsightsResponse{}), nil
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.CrossVerticalInsightsUC.Do(ctx, app.ListCrossVerticalInsightsInput{UserID: uid})
	if err != nil {
		return nil, fmt.Errorf("intelligence.ListCrossVerticalInsights: %w", s.toConnectErr(err))
	}
	resp := &pb.ListCrossVerticalInsightsResponse{
		Items: make([]*pb.CrossVerticalInsight, 0, len(out.Items)),
	}
	for _, ins := range out.Items {
		resp.Items = append(resp.Items, &pb.CrossVerticalInsight{
			Kind:                 ins.Kind,
			Severity:             insightSeverityToProto(ins.Severity),
			MessageMd:            ins.MessageMD,
			SuggestedActionUrl:   ins.SuggestedActionURL,
			SuggestedActionLabel: ins.SuggestedActionLabel,
		})
	}
	return connect.NewResponse(resp), nil
}

// GetForkSnapshot implements druz9.v1.IntelligenceService/GetForkSnapshot.
func (s *IntelligenceServer) GetForkSnapshot(
	ctx context.Context,
	_ *connect.Request[pb.GetForkSnapshotRequest],
) (*connect.Response[pb.ForkSnapshot], error) {
	if s.ForkSnapshotUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("intelligence.GetForkSnapshot: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.ForkSnapshotUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetForkSnapshot: %w", s.toConnectErr(err))
	}
	resp := &pb.ForkSnapshot{
		Mode:             out.Mode,
		ExploreWeekIndex: int32(out.ExploreWeekIndex),
		CurrentBranch:    out.CurrentBranch,
		LeanBranch:       out.LeanBranch,
		Confidence:       out.Confidence,
	}
	for _, b := range out.Branches {
		resp.Branches = append(resp.Branches, &pb.ForkBranchView{
			Branch:             b.Branch,
			MockCount:          int32(b.MockCount),
			AvgScore:           b.AvgScore,
			VoluntaryDeepDives: int32(b.VoluntaryDeepDives),
			CompositeScore:     b.CompositeScore,
		})
	}
	return connect.NewResponse(resp), nil
}

// LogResource implements druz9.v1.IntelligenceService/LogResource.
func (s *IntelligenceServer) LogResource(
	ctx context.Context,
	req *connect.Request[pb.LogResourceRequest],
) (*connect.Response[pb.LogResourceResponse], error) {
	if s.LogResourceUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("intelligence.LogResource: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.LogResourceUC.Do(ctx, app.LogResourceInput{
		UserID:         uid,
		ResourceURL:    req.Msg.GetResourceUrl(),
		AtlasNodeID:    req.Msg.GetAtlasNodeId(),
		Kind:           req.Msg.GetKind(),
		ReflectionText: req.Msg.GetReflectionText(),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.LogResource: %w", s.toConnectErr(err))
	}
	resp := &pb.LogResourceResponse{
		Id:               out.Entry.ID.String(),
		NoteCreateFailed: out.NoteCreateFailed,
	}
	if out.ReflectionNoteID != nil {
		resp.ReflectionNoteId = out.ReflectionNoteID.String()
	}
	return connect.NewResponse(resp), nil
}

// SetLearningMode implements druz9.v1.IntelligenceService/SetLearningMode.
func (s *IntelligenceServer) SetLearningMode(
	ctx context.Context,
	req *connect.Request[pb.SetLearningModeRequest],
) (*connect.Response[pb.LearningStateView], error) {
	if s.LearningState == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("intelligence.SetLearningMode: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	mode := strings.TrimSpace(req.Msg.GetMode())
	if mode == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("mode required"))
	}
	var trackID *uuid.UUID
	if t := strings.TrimSpace(req.Msg.GetTrackId()); t != "" {
		parsed, perr := uuid.Parse(t)
		if perr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("track_id: %w", perr))
		}
		trackID = &parsed
	}
	snap, err := s.LearningState.SetMode(ctx, uid, mode, trackID)
	if err != nil {
		return nil, fmt.Errorf("intelligence.SetLearningMode: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toLearningStateView(snap)), nil
}

// SetForkBranch implements druz9.v1.IntelligenceService/SetForkBranch.
func (s *IntelligenceServer) SetForkBranch(
	ctx context.Context,
	req *connect.Request[pb.SetForkBranchRequest],
) (*connect.Response[pb.LearningStateView], error) {
	if s.LearningState == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("intelligence.SetForkBranch: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	branch := strings.TrimSpace(req.Msg.GetBranch())
	snap, err := s.LearningState.SetFork(ctx, uid, branch)
	if err != nil {
		return nil, fmt.Errorf("intelligence.SetForkBranch: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toLearningStateView(snap)), nil
}

func toLearningStateView(s LearningStateSnapshot) *pb.LearningStateView {
	return &pb.LearningStateView{
		Mode:             s.Mode,
		ForkBranch:       s.ForkBranch,
		ExploreWeekIndex: int32(s.ExploreWeekIndex),
		CommittedTrackId: s.CommittedTrackID,
	}
}

// GetResourceTrail implements druz9.v1.IntelligenceService/GetResourceTrail.
func (s *IntelligenceServer) GetResourceTrail(
	ctx context.Context,
	req *connect.Request[pb.GetResourceTrailRequest],
) (*connect.Response[pb.ResourceTrail], error) {
	if s.ResourceTrailReader == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("intelligence.GetResourceTrail: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	days := int(req.Msg.GetDays())
	keepRecent := int(req.Msg.GetKeepRecent())
	trail, err := s.ResourceTrailReader.EngagementWindow(ctx, uid, days, keepRecent)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetResourceTrail: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toResourceTrailProto(trail)), nil
}

// GetSkillRadar implements druz9.v1.IntelligenceService/GetSkillRadar.
func (s *IntelligenceServer) GetSkillRadar(
	ctx context.Context,
	req *connect.Request[pb.GetSkillRadarRequest],
) (*connect.Response[pb.SkillRadar], error) {
	if s.SkillRadarUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("intelligence.GetSkillRadar: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.SkillRadarUC.Do(ctx, app.GetSkillRadarInput{
		UserID: uid,
		Rubric: strings.TrimSpace(req.Msg.GetRubric()),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetSkillRadar: %w", s.toConnectErr(err))
	}
	resp := &pb.SkillRadar{Rubric: out.Rubric}
	for _, ax := range out.Axes {
		resp.Axes = append(resp.Axes, &pb.SkillRadarAxis{
			Key:        ax.Key,
			Label:      ax.Label,
			Score:      ax.Score,
			MockCount:  int32(ax.MockCount),
			Confidence: string(ax.Confidence),
		})
	}
	return connect.NewResponse(resp), nil
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

// GetCoachStats implements druz9.v1.IntelligenceService/GetCoachStats.
func (s *IntelligenceServer) GetCoachStats(
	ctx context.Context,
	_ *connect.Request[pb.GetCoachStatsRequest],
) (*connect.Response[pb.CoachStats], error) {
	if s.CoachStatsUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("intelligence.GetCoachStats: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.CoachStatsUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetCoachStats: %w", s.toConnectErr(err))
	}
	// Arena/Lobby final purge 2026-05-06: NextMockInDays / NextMockCompany /
	// StreakDays dropped from the proto. The "next mock" card disappeared
	// alongside the calendar bounded context; clients now degrade the card
	// to "no upcoming interview" purely on the renderer side.
	return connect.NewResponse(&pb.CoachStats{
		FocusTodayMin:   int32(out.FocusTodayMin),
		LastMockScore:   int32(out.LastMockScore),
		LastMockSection: out.LastMockSection,
	}), nil
}

// ── F2 Goal CRUD handlers (2026-05-12) ───────────────────────────────────

// CreateGoal implements druz9.v1.IntelligenceService/CreateGoal.
func (s *IntelligenceServer) CreateGoal(
	ctx context.Context,
	req *connect.Request[pb.CreateGoalRequest],
) (*connect.Response[pb.Goal], error) {
	if s.CreateGoalUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.CreateGoal: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	kind, err := goalKindFromProto(req.Msg.GetKind())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	g, err := s.CreateGoalUC.Do(ctx, app.CreateGoalInput{
		UserID:        uid,
		Kind:          kind,
		TargetCompany: req.Msg.GetTargetCompany(),
		TargetLevel:   req.Msg.GetTargetLevel(),
		TargetText:    req.Msg.GetTargetText(),
		TargetDate:    req.Msg.GetTargetDate(),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.CreateGoal: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(primaryGoalToProto(g)), nil
}

// GetActiveGoal implements druz9.v1.IntelligenceService/GetActiveGoal.
func (s *IntelligenceServer) GetActiveGoal(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[pb.Goal], error) {
	if s.GetActiveGoalUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.GetActiveGoal: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	g, err := s.GetActiveGoalUC.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetActiveGoal: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(primaryGoalToProto(g)), nil
}

// UpdateGoal implements druz9.v1.IntelligenceService/UpdateGoal.
func (s *IntelligenceServer) UpdateGoal(
	ctx context.Context,
	req *connect.Request[pb.UpdateGoalRequest],
) (*connect.Response[pb.Goal], error) {
	if s.UpdateGoalUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.UpdateGoal: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	goalID, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", err))
	}
	kind, err := goalKindFromProto(req.Msg.GetKind())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	g, err := s.UpdateGoalUC.Do(ctx, app.UpdateGoalInput{
		UserID:        uid,
		GoalID:        goalID,
		Kind:          kind,
		TargetCompany: req.Msg.GetTargetCompany(),
		TargetLevel:   req.Msg.GetTargetLevel(),
		TargetText:    req.Msg.GetTargetText(),
		TargetDate:    req.Msg.GetTargetDate(),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.UpdateGoal: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(primaryGoalToProto(g)), nil
}

// DeactivateGoal implements druz9.v1.IntelligenceService/DeactivateGoal.
func (s *IntelligenceServer) DeactivateGoal(
	ctx context.Context,
	req *connect.Request[pb.DeactivateGoalRequest],
) (*connect.Response[emptypb.Empty], error) {
	if s.DeactivateGoalUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.DeactivateGoal: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	goalID, err := uuid.Parse(req.Msg.GetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", err))
	}
	if err := s.DeactivateGoalUC.Do(ctx, uid, goalID); err != nil {
		return nil, fmt.Errorf("intelligence.DeactivateGoal: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

func primaryGoalToProto(g domain.PrimaryGoal) *pb.Goal {
	out := &pb.Goal{
		Id:            g.ID.String(),
		Kind:          goalKindToProto(g.Kind),
		TargetCompany: g.TargetCompany,
		TargetLevel:   g.TargetLevel,
		TargetText:    g.TargetText,
		Active:        g.Active,
		CreatedAt:     timestamppb.New(g.CreatedAt.UTC()),
		UpdatedAt:     timestamppb.New(g.UpdatedAt.UTC()),
	}
	if g.TargetDate != nil {
		out.TargetDate = g.TargetDate.UTC().Format("2006-01-02")
	}
	return out
}

func goalKindFromProto(k pb.GoalKind) (domain.PrimaryGoalKind, error) {
	switch k {
	case pb.GoalKind_GOAL_KIND_TOP_TIER_CO:
		return domain.PrimaryGoalKindTopTierCo, nil
	case pb.GoalKind_GOAL_KIND_ANY_SENIOR:
		return domain.PrimaryGoalKindAnySenior, nil
	case pb.GoalKind_GOAL_KIND_ML_OFFER:
		return domain.PrimaryGoalKindMLOffer, nil
	case pb.GoalKind_GOAL_KIND_ENGLISH_TARGET:
		return domain.PrimaryGoalKindEnglishTarget, nil
	case pb.GoalKind_GOAL_KIND_CUSTOM:
		return domain.PrimaryGoalKindCustom, nil
	}
	return "", fmt.Errorf("unknown goal_kind: %v", k)
}

func goalKindToProto(k domain.PrimaryGoalKind) pb.GoalKind {
	switch k {
	case domain.PrimaryGoalKindTopTierCo:
		return pb.GoalKind_GOAL_KIND_TOP_TIER_CO
	case domain.PrimaryGoalKindAnySenior:
		return pb.GoalKind_GOAL_KIND_ANY_SENIOR
	case domain.PrimaryGoalKindMLOffer:
		return pb.GoalKind_GOAL_KIND_ML_OFFER
	case domain.PrimaryGoalKindEnglishTarget:
		return pb.GoalKind_GOAL_KIND_ENGLISH_TARGET
	case domain.PrimaryGoalKindCustom:
		return pb.GoalKind_GOAL_KIND_CUSTOM
	}
	return pb.GoalKind_GOAL_KIND_UNSPECIFIED
}

// ── F10 Cue session handlers (2026-05-12) ───────────────────────────────

// IngestInterviewSession implements druz9.v1.IntelligenceService/IngestInterviewSession.
func (s *IntelligenceServer) IngestInterviewSession(
	ctx context.Context,
	req *connect.Request[pb.IngestInterviewSessionRequest],
) (*connect.Response[pb.InterviewSession], error) {
	if s.IngestInterviewSessionUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.IngestInterviewSession: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	stages := make([]domain.InterviewStage, 0, len(req.Msg.GetStages()))
	for _, st := range req.Msg.GetStages() {
		stages = append(stages, domain.InterviewStage{
			Stage:      st.GetStage(),
			SelfRating: int(st.GetSelfRating()),
			Notes:      st.GetNotes(),
		})
	}
	var completedAt time.Time
	if ts := req.Msg.GetCompletedAt(); ts != nil {
		completedAt = ts.AsTime()
	}
	out, err := s.IngestInterviewSessionUC.Do(ctx, app.IngestInterviewSessionInput{
		UserID:        uid,
		Company:       req.Msg.GetCompany(),
		Persona:       req.Msg.GetPersona(),
		Stages:        stages,
		AISummary:     req.Msg.GetAiSummary(),
		RawTranscript: req.Msg.GetRawTranscript(),
		CompletedAt:   completedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.IngestInterviewSession: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(interviewSessionToProto(out)), nil
}

// ListInterviewSessions implements druz9.v1.IntelligenceService/ListInterviewSessions.
func (s *IntelligenceServer) ListInterviewSessions(
	ctx context.Context,
	req *connect.Request[pb.ListInterviewSessionsRequest],
) (*connect.Response[pb.ListInterviewSessionsResponse], error) {
	if s.ListInterviewSessionsUC == nil {
		// nil-safe — return empty list.
		return connect.NewResponse(&pb.ListInterviewSessionsResponse{}), nil
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.ListInterviewSessionsUC.Do(ctx, app.ListInterviewSessionsInput{
		UserID: uid,
		Limit:  int(req.Msg.GetLimit()),
		Offset: int(req.Msg.GetOffset()),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.ListInterviewSessions: %w", s.toConnectErr(err))
	}
	resp := &pb.ListInterviewSessionsResponse{
		Items: make([]*pb.InterviewSession, 0, len(out.Items)),
		Total: int32(out.Total),
	}
	for _, it := range out.Items {
		resp.Items = append(resp.Items, interviewSessionToProto(it))
	}
	return connect.NewResponse(resp), nil
}

func interviewSessionToProto(s domain.InterviewSession) *pb.InterviewSession {
	out := &pb.InterviewSession{
		Id:            s.ID.String(),
		Company:       s.Company,
		Persona:       s.Persona,
		AiSummary:     s.AISummary,
		RawTranscript: s.RawTranscript,
		CompletedAt:   timestamppb.New(s.CompletedAt.UTC()),
	}
	for _, st := range s.Stages {
		out.Stages = append(out.Stages, &pb.InterviewStage{
			Stage:      st.Stage,
			SelfRating: int32(st.SelfRating),
			Notes:      st.Notes,
		})
	}
	return out
}

// ── F2 LLM-driven milestone handlers (2026-05-12) ────────────────────────

// GenerateMilestones implements druz9.v1.IntelligenceService/GenerateMilestones.
func (s *IntelligenceServer) GenerateMilestones(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[pb.MilestonesResponse], error) {
	if s.GenerateMilestonesUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.GenerateMilestones: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	items, err := s.GenerateMilestonesUC.Do(ctx, app.GenerateMilestonesInput{
		UserID: uid,
		Force:  true,
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.GenerateMilestones: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(milestonesToProto(items)), nil
}

// GetMilestones implements druz9.v1.IntelligenceService/GetMilestones.
func (s *IntelligenceServer) GetMilestones(
	ctx context.Context,
	_ *connect.Request[emptypb.Empty],
) (*connect.Response[pb.MilestonesResponse], error) {
	if s.GetMilestonesUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.GetMilestones: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	items, err := s.GetMilestonesUC.Do(ctx, uid)
	if err != nil {
		// NotFound (no active goal) — UI трактует как «empty milestones»; пробрасываем.
		return nil, fmt.Errorf("intelligence.GetMilestones: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(milestonesToProto(items)), nil
}

// MarkMilestoneDone implements druz9.v1.IntelligenceService/MarkMilestoneDone.
func (s *IntelligenceServer) MarkMilestoneDone(
	ctx context.Context,
	req *connect.Request[pb.MarkMilestoneDoneRequest],
) (*connect.Response[pb.Milestone], error) {
	if s.MarkMilestoneDoneUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.MarkMilestoneDone: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	m, err := s.MarkMilestoneDoneUC.Do(ctx, app.MarkMilestoneDoneInput{
		UserID:      uid,
		MilestoneID: id,
		Done:        req.Msg.GetDone(),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.MarkMilestoneDone: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(milestoneToProto(m)), nil
}

func milestonesToProto(items []domain.Milestone) *pb.MilestonesResponse {
	out := &pb.MilestonesResponse{Items: make([]*pb.Milestone, 0, len(items))}
	var newest time.Time
	for _, m := range items {
		out.Items = append(out.Items, milestoneToProto(m))
		if m.GeneratedAt.After(newest) {
			newest = m.GeneratedAt
		}
	}
	if !newest.IsZero() {
		out.GeneratedAt = timestamppb.New(newest.UTC())
	}
	return out
}

func milestoneToProto(m domain.Milestone) *pb.Milestone {
	out := &pb.Milestone{
		Id:        m.ID.String(),
		WeekIndex: int32(m.WeekIndex),
		WeekStart: m.WeekStart.UTC().Format("2006-01-02"),
		Title:     m.Title,
		Detail:    m.Detail,
		Category:  string(m.Category),
	}
	if m.DoneAt != nil {
		out.Done = true
		out.DoneAt = timestamppb.New(m.DoneAt.UTC())
	}
	return out
}

// ── R3 Per-node coverage handler (2026-05-12) ────────────────────────────

// GetNodeCoverage implements druz9.v1.IntelligenceService/GetNodeCoverage.
func (s *IntelligenceServer) GetNodeCoverage(
	ctx context.Context,
	req *connect.Request[pb.GetNodeCoverageRequest],
) (*connect.Response[pb.GetNodeCoverageResponse], error) {
	if s.GetNodeCoverageUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.GetNodeCoverage: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	keys := req.Msg.GetNodeKeys()
	// Drop empty strings silently — client sometimes ships placeholder entries.
	filtered := make([]string, 0, len(keys))
	for _, k := range keys {
		if strings.TrimSpace(k) != "" {
			filtered = append(filtered, k)
		}
	}
	items, err := s.GetNodeCoverageUC.Do(ctx, app.GetNodeCoverageInput{
		UserID:   uid,
		NodeKeys: filtered,
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetNodeCoverage: %w", s.toConnectErr(err))
	}
	out := &pb.GetNodeCoverageResponse{Items: make([]*pb.NodeCoverage, 0, len(items))}
	for _, c := range items {
		entry := &pb.NodeCoverage{
			NodeKey:        c.NodeKey,
			State:          string(c.State),
			MatchCount_30D: int32(c.MatchCount30d),
			MatchCount_7D:  int32(c.MatchCount7d),
		}
		if !c.LastMatchAt.IsZero() {
			entry.LastMatchAt = timestamppb.New(c.LastMatchAt.UTC())
		}
		out.Items = append(out.Items, entry)
	}
	return connect.NewResponse(out), nil
}

