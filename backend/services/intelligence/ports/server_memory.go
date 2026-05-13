// Memory entries CRUD + focus reflections + cross-product user context +
// atlas struggle marks RPCs. Split out of server.go to keep file size
// manageable.
package ports

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"druz9/intelligence/app"
	"druz9/intelligence/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ── F1 Memory expansion Phase 2 handlers (2026-05-12) ────────────────────

// ListMemoryEntries implements druz9.v1.IntelligenceService/ListMemoryEntries.
func (s *IntelligenceServer) ListMemoryEntries(
	ctx context.Context,
	req *connect.Request[pb.ListMemoryEntriesRequest],
) (*connect.Response[pb.ListMemoryEntriesResponse], error) {
	if s.ListMemoryEntriesUC == nil {
		// nil-safe — empty list keeps the /profile transparency panel renderable.
		return connect.NewResponse(&pb.ListMemoryEntriesResponse{}), nil
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	var since time.Time
	if ts := req.Msg.GetSince(); ts != nil {
		since = ts.AsTime()
	}
	res, err := s.ListMemoryEntriesUC.Do(ctx, app.ListMemoryEntriesInput{
		UserID: uid,
		Kind:   strings.TrimSpace(req.Msg.GetKind()),
		Since:  since,
		Limit:  int(req.Msg.GetLimit()),
		Offset: int(req.Msg.GetOffset()),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.ListMemoryEntries: %w", s.toConnectErr(err))
	}
	out := &pb.ListMemoryEntriesResponse{
		Items: make([]*pb.MemoryEntry, 0, len(res.Items)),
		Total: int32(res.Total),
	}
	for _, ep := range res.Items {
		out.Items = append(out.Items, memoryEntryToProto(ep))
	}
	return connect.NewResponse(out), nil
}

// DeleteMemoryEntry implements druz9.v1.IntelligenceService/DeleteMemoryEntry.
func (s *IntelligenceServer) DeleteMemoryEntry(
	ctx context.Context,
	req *connect.Request[pb.DeleteMemoryEntryRequest],
) (*connect.Response[emptypb.Empty], error) {
	if s.DeleteMemoryEntryUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.DeleteMemoryEntry: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	if err := s.DeleteMemoryEntryUC.Do(ctx, uid, id); err != nil {
		return nil, fmt.Errorf("intelligence.DeleteMemoryEntry: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// EditMemoryEntry implements druz9.v1.IntelligenceService/EditMemoryEntry.
// Validation (length, empty content) живёт в UC; handler делает только uuid
// parsing + auth gate.
func (s *IntelligenceServer) EditMemoryEntry(
	ctx context.Context,
	req *connect.Request[pb.EditMemoryEntryRequest],
) (*connect.Response[pb.MemoryEntry], error) {
	if s.EditMemoryEntryUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.EditMemoryEntry: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	id, perr := uuid.Parse(req.Msg.GetId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("id: %w", perr))
	}
	ep, err := s.EditMemoryEntryUC.Do(ctx, app.EditMemoryEntryInput{
		UserID:    uid,
		EpisodeID: id,
		Content:   req.Msg.GetContent(),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.EditMemoryEntry: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(memoryEntryToProto(ep)), nil
}

func memoryEntryToProto(e domain.Episode) *pb.MemoryEntry {
	out := &pb.MemoryEntry{
		Id:         e.ID.String(),
		Kind:       string(e.Kind),
		Content:    e.Summary,
		Source:     memorySourceLabel(e.Kind),
		Importance: 0,
	}
	if !e.OccurredAt.IsZero() {
		out.OccurredAt = timestamppb.New(e.OccurredAt.UTC())
	}
	if e.EditedAt != nil && !e.EditedAt.IsZero() {
		out.EditedAt = timestamppb.New(e.EditedAt.UTC())
	}
	return out
}

// memorySourceLabel — short product-label produced server-side for UI grouping.
// Pure mapping; no DB. Empty string когда kind не имеет очевидного владельца.
func memorySourceLabel(k domain.EpisodeKind) string {
	switch k {
	case domain.EpisodeBriefEmitted, domain.EpisodeBriefFollowed, domain.EpisodeBriefDismissed,
		domain.EpisodeQAQuery, domain.EpisodeQAAnswered, domain.EpisodeWeeklyMemorySummary:
		return "coach"
	case domain.EpisodeReflectionAdded, domain.EpisodeStandupRecorded,
		domain.EpisodePlanSkipped, domain.EpisodePlanCompleted,
		domain.EpisodeNoteCreated, domain.EpisodeFocusSessionDone, domain.EpisodeExternalActivity,
		domain.EpisodeFocusReflectionAdded:
		return "hone"
	case domain.EpisodeMockPipelineFinished:
		return "mock"
	case domain.EpisodeCodexArticleOpened:
		return "codex"
	case domain.EpisodeCueConversationMemory, domain.EpisodeCueSession:
		return "cue"
	}
	return ""
}

// ── Focus reflection persistence handlers ────────────────────────────────

// SaveFocusReflection implements druz9.v1.IntelligenceService/SaveFocusReflection.
// Idempotent on (user_id, session_id) — Hone outbox replay безопасен.
func (s *IntelligenceServer) SaveFocusReflection(
	ctx context.Context,
	req *connect.Request[pb.SaveFocusReflectionRequest],
) (*connect.Response[pb.SaveFocusReflectionResponse], error) {
	if s.SaveFocusReflectionUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.SaveFocusReflection: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	m := req.Msg
	var startedAt, endedAt time.Time
	if ts := m.GetStartedAt(); ts != nil {
		startedAt = ts.AsTime()
	}
	if ts := m.GetEndedAt(); ts != nil {
		endedAt = ts.AsTime()
	}
	res, err := s.SaveFocusReflectionUC.Do(ctx, app.SaveFocusReflectionInput{
		UserID:          uid,
		SessionID:       m.GetSessionId(),
		FocusMode:       m.GetFocusMode(),
		DurationSeconds: int(m.GetDurationSeconds()),
		Grade:           int(m.GetGrade()),
		Notes:           m.GetNotes(),
		TaskPinned:      m.GetTaskPinned(),
		StartedAt:       startedAt,
		EndedAt:         endedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.SaveFocusReflection: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.SaveFocusReflectionResponse{ReflectionId: res.ID.String()}), nil
}

// ListFocusReflections implements druz9.v1.IntelligenceService/ListFocusReflections.
// Used by Hone /stats grade-trend chart.
func (s *IntelligenceServer) ListFocusReflections(
	ctx context.Context,
	req *connect.Request[pb.ListFocusReflectionsRequest],
) (*connect.Response[pb.ListFocusReflectionsResponse], error) {
	if s.ListFocusReflectionsUC == nil {
		// nil-safe — пустой список держит chart renderable когда backend
		// еще не wired (e.g. tests).
		return connect.NewResponse(&pb.ListFocusReflectionsResponse{}), nil
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	res, err := s.ListFocusReflectionsUC.Do(ctx, app.ListFocusReflectionsInput{
		UserID:     uid,
		WindowDays: int(req.Msg.GetWindowDays()),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.ListFocusReflections: %w", s.toConnectErr(err))
	}
	out := &pb.ListFocusReflectionsResponse{
		Items: make([]*pb.FocusReflectionEntry, 0, len(res.Items)),
	}
	for _, r := range res.Items {
		grade := int32(0)
		if r.Grade != nil {
			grade = int32(*r.Grade)
		}
		out.Items = append(out.Items, &pb.FocusReflectionEntry{
			ReflectionId:    r.ID.String(),
			EndedAt:         timestamppb.New(r.EndedAt.UTC()),
			Grade:           grade,
			FocusMode:       r.FocusMode,
			DurationSeconds: int32(r.DurationSeconds),
		})
	}
	return connect.NewResponse(out), nil
}

// ── Cross-product context handler ────────────────────────────────────────

// GetUserContext implements druz9.v1.IntelligenceService/GetUserContext.
// Returns the compact bundle the Cue copilot uses to personalise its
// suggestion prompt. Auth-scoped via UserIDFromContext.
func (s *IntelligenceServer) GetUserContext(
	ctx context.Context,
	_ *connect.Request[pb.GetUserContextRequest],
) (*connect.Response[pb.GetUserContextResponse], error) {
	if s.GetUserContextUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.GetUserContext: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	bundle, err := s.GetUserContextUC.Do(ctx, app.GetUserContextInput{UserID: uid})
	if err != nil {
		return nil, fmt.Errorf("intelligence.GetUserContext: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.GetUserContextResponse{
		Context: userContextToProto(bundle),
	}), nil
}

// userContextToProto translates the domain bundle into the wire shape.
// Goal struct is reused via primaryGoalToProto. nil sub-fields are NOT
// emitted as proto-null — instead we emit empty messages so the client
// always reads a well-formed payload (UI checks repeated.length / scalar zero).
func userContextToProto(b app.UserContextBundle) *pb.UserContext {
	out := &pb.UserContext{
		Activity: &pb.ActivitySummary{
			Last_7DCount:  int32(b.Activity.Last7dCount),
			Last_30DCount: int32(b.Activity.Last30dCount),
			TopKinds:      b.Activity.TopKinds,
		},
		Radar: &pb.SkillRadarSnapshot{
			Rubric:        b.Radar.Rubric,
			Axes:          b.Radar.Axes,
			AxisScores:    b.Radar.AxisScores,
			WeakestAxis:   b.Radar.WeakestAxis,
			StrongestAxis: b.Radar.StrongestAxis,
		},
	}
	if b.ActiveGoal != nil {
		out.ActiveGoal = primaryGoalToProto(*b.ActiveGoal)
	}
	out.RecentMemory = make([]*pb.CoachMemoryEntry, 0, len(b.RecentMemory))
	for _, m := range b.RecentMemory {
		out.RecentMemory = append(out.RecentMemory, &pb.CoachMemoryEntry{
			Kind:       m.Kind,
			Summary:    m.Summary,
			OccurredAt: timestamppb.New(m.OccurredAt.UTC()),
			HoursAgo:   int32(m.HoursAgo),
		})
	}
	out.RelevantResources = make([]*pb.AtlasResourceRef, 0, len(b.RelevantResources))
	for _, r := range b.RelevantResources {
		out.RelevantResources = append(out.RelevantResources, &pb.AtlasResourceRef{
			Id:    r.ID,
			Title: r.Title,
			Url:   r.URL,
			Kind:  r.Kind,
		})
	}
	return out
}

// ── Atlas struggle handlers ─────────────────────────────────────────────
//
// All three handlers are nil-safe; tests / partial bootstrap can call them
// without wiring the UC trio. Auth-scoped via requireUser — atlas marks are
// strictly per-user and never leak across accounts.

// MarkAtlasStruggle implements druz9.v1.IntelligenceService/MarkAtlasStruggle.
func (s *IntelligenceServer) MarkAtlasStruggle(
	ctx context.Context,
	req *connect.Request[pb.MarkAtlasStruggleRequest],
) (*connect.Response[pb.MarkAtlasStruggleResponse], error) {
	if s.MarkAtlasStruggleUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.MarkAtlasStruggle: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.MarkAtlasStruggleUC.Do(ctx, app.MarkAtlasStruggleInput{
		UserID:      uid,
		AtlasNodeID: req.Msg.GetAtlasNodeId(),
		Source:      req.Msg.GetSource(),
		Confidence:  req.Msg.GetConfidence(),
		Note:        req.Msg.GetNote(),
	}); err != nil {
		return nil, fmt.Errorf("intelligence.MarkAtlasStruggle: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.MarkAtlasStruggleResponse{Ok: true}), nil
}

// ListAtlasStruggles implements druz9.v1.IntelligenceService/ListAtlasStruggles.
func (s *IntelligenceServer) ListAtlasStruggles(
	ctx context.Context,
	req *connect.Request[pb.ListAtlasStrugglesRequest],
) (*connect.Response[pb.ListAtlasStrugglesResponse], error) {
	if s.ListAtlasStrugglesUC == nil {
		// nil-safe — пустой список держит web AtlasPage render'имым когда
		// backend ещё не wired (e.g. dev без LLM stack).
		return connect.NewResponse(&pb.ListAtlasStrugglesResponse{}), nil
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.ListAtlasStrugglesUC.Do(ctx, app.ListAtlasStrugglesInput{
		UserID:     uid,
		WindowDays: int(req.Msg.GetWindowDays()),
	})
	if err != nil {
		return nil, fmt.Errorf("intelligence.ListAtlasStruggles: %w", s.toConnectErr(err))
	}
	resp := &pb.ListAtlasStrugglesResponse{
		Items: make([]*pb.AtlasStruggleMark, 0, len(out.Items)),
	}
	for _, m := range out.Items {
		resp.Items = append(resp.Items, &pb.AtlasStruggleMark{
			AtlasNodeId: m.AtlasNodeID,
			Source:      string(m.Source),
			Confidence:  m.Confidence,
			Note:        m.Note,
			MarkedAt:    timestamppb.New(m.MarkedAt.UTC()),
		})
	}
	return connect.NewResponse(resp), nil
}

// ClearAtlasStruggle implements druz9.v1.IntelligenceService/ClearAtlasStruggle.
func (s *IntelligenceServer) ClearAtlasStruggle(
	ctx context.Context,
	req *connect.Request[pb.ClearAtlasStruggleRequest],
) (*connect.Response[pb.ClearAtlasStruggleResponse], error) {
	if s.ClearAtlasStruggleUC == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("intelligence.ClearAtlasStruggle: not wired"))
	}
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.ClearAtlasStruggleUC.Do(ctx, app.ClearAtlasStruggleInput{
		UserID:      uid,
		AtlasNodeID: req.Msg.GetAtlasNodeId(),
	}); err != nil {
		return nil, fmt.Errorf("intelligence.ClearAtlasStruggle: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.ClearAtlasStruggleResponse{Ok: true}), nil
}
