// Package ports — Phase 3.5 Connect-RPC server для curation service.
//
// Thin wrappers вокруг app/UCs. Auth через shared middleware
// requireUser; ownership-checks внутри UCs (user_id передаётся в каждый
// Insert).
package ports

import (
	"context"
	"errors"
	"fmt"

	"druz9/curation/app"
	"druz9/curation/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

type CurationServer struct {
	Add       *app.AddResource
	Hide      *app.HideResource
	Unhelpful *app.MarkUnhelpful
	Replace   *app.ReplaceResource
	Reorder   *app.ReorderResource
	Apply     *app.ApplyOverrides
	Extract   *app.ExtractResourceContent
	Grade     *app.ReflectionGrade
	// ReflectionLogUpdater — write-back в user_resource_log после grade.
	// Optional: nil → skip update (UI всё равно видит quality_score в
	// response). Caller (bootstrap) wires postgres impl.
	ReflectionLogUpdater ReflectionLogUpdater
}

// ReflectionLogUpdater — UPDATE user_resource_log SET reflection_takeaways=...
type ReflectionLogUpdater interface {
	UpdateReflection(ctx context.Context, logID uuid.UUID, takeaways []string,
		quality float32, extractedTopics []string, confusion bool) error
}

func NewCurationServer(s CurationServer) *CurationServer { return &s }

func (s *CurationServer) PreviewResource(
	ctx context.Context,
	req *connect.Request[pb.PreviewResourceRequest],
) (*connect.Response[pb.PreviewResourceResponse], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	if s.Extract == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("preview disabled"))
	}
	out, err := s.Extract.Do(ctx, app.ExtractInput{
		URL:          req.Msg.GetUrl(),
		AtlasNodeIDs: req.Msg.GetAllowedAtlasNodeIds(),
	})
	if err != nil {
		return nil, fmt.Errorf("curation.PreviewResource: %w", err)
	}
	resp := &pb.PreviewResourceResponse{
		Preview:       toResourceProto(out.Preview),
		Manual:        out.Manual,
		FetchStrategy: out.FetchInfo.Strategy,
	}
	if out.FetchInfo.Error != nil {
		resp.FetchError = out.FetchInfo.Error.Error()
	}
	return connect.NewResponse(resp), nil
}

func (s *CurationServer) AddResource(
	ctx context.Context,
	req *connect.Request[pb.AddResourceRequest],
) (*connect.Response[pb.AddResourceResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	target, terr := targetFromProto(req.Msg.GetTarget())
	if terr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, terr)
	}
	res := resourceFromProto(req.Msg.GetResource())
	ov, err := s.Add.Do(ctx, app.AddResourceInput{
		UserID: uid, Target: target, Resource: res,
	})
	if err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.AddResourceResponse{OverrideId: ov.ID.String()}), nil
}

func (s *CurationServer) HideResource(
	ctx context.Context,
	req *connect.Request[pb.HideResourceRequest],
) (*connect.Response[pb.HideResourceResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	target, terr := targetFromProto(req.Msg.GetTarget())
	if terr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, terr)
	}
	if err := s.Hide.Do(ctx, uid, target, req.Msg.GetUrl()); err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.HideResourceResponse{}), nil
}

func (s *CurationServer) MarkUnhelpful(
	ctx context.Context,
	req *connect.Request[pb.MarkUnhelpfulRequest],
) (*connect.Response[pb.MarkUnhelpfulResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	target, terr := targetFromProto(req.Msg.GetTarget())
	if terr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, terr)
	}
	if err := s.Unhelpful.Do(ctx, uid, target, req.Msg.GetUrl(), req.Msg.GetReason()); err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.MarkUnhelpfulResponse{}), nil
}

func (s *CurationServer) ReplaceResource(
	ctx context.Context,
	req *connect.Request[pb.ReplaceResourceRequest],
) (*connect.Response[pb.ReplaceResourceResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	target, terr := targetFromProto(req.Msg.GetTarget())
	if terr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, terr)
	}
	if err := s.Replace.Do(ctx, app.ReplaceResourceInput{
		UserID: uid, Target: target,
		OriginalURL: req.Msg.GetOriginalUrl(),
		Replacement: resourceFromProto(req.Msg.GetReplacement()),
		Reason:      req.Msg.GetReason(),
	}); err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.ReplaceResourceResponse{}), nil
}

func (s *CurationServer) ReorderResource(
	ctx context.Context,
	req *connect.Request[pb.ReorderResourceRequest],
) (*connect.Response[pb.ReorderResourceResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	target, terr := targetFromProto(req.Msg.GetTarget())
	if terr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, terr)
	}
	if err := s.Reorder.Do(ctx, uid, target, req.Msg.GetUrl(),
		int(req.Msg.GetPrevIndex()), int(req.Msg.GetNextIndex())); err != nil {
		return nil, toConnectErr(err)
	}
	return connect.NewResponse(&pb.ReorderResourceResponse{}), nil
}

func (s *CurationServer) ApplyOverrides(
	ctx context.Context,
	req *connect.Request[pb.ApplyOverridesRequest],
) (*connect.Response[pb.ApplyOverridesResponse], error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	target, terr := targetFromProto(req.Msg.GetTarget())
	if terr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, terr)
	}
	base := make(domain.ResourceList, 0, len(req.Msg.GetBase()))
	for _, r := range req.Msg.GetBase() {
		base = append(base, resourceFromProto(r))
	}
	merged, err := s.Apply.Do(ctx, uid, target, base)
	if err != nil {
		return nil, toConnectErr(err)
	}
	resp := &pb.ApplyOverridesResponse{Resources: make([]*pb.Resource, 0, len(merged))}
	for _, r := range merged {
		resp.Resources = append(resp.Resources, toResourceProto(r))
	}
	return connect.NewResponse(resp), nil
}

func (s *CurationServer) GradeReflection(
	ctx context.Context,
	req *connect.Request[pb.GradeReflectionRequest],
) (*connect.Response[pb.GradeReflectionResponse], error) {
	if _, err := requireUser(ctx); err != nil {
		return nil, err
	}
	if s.Grade == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("grade disabled"))
	}
	out, err := s.Grade.Do(ctx, app.ReflectionGradeInput{
		Takeaways:      req.Msg.GetTakeaways(),
		ConfusionText:  req.Msg.GetConfusionText(),
		ExpectedTopics: req.Msg.GetExpectedTopics(),
		AllowedNodes:   req.Msg.GetAllowedAtlasNodeIds(),
	})
	if err != nil {
		return nil, toConnectErr(err)
	}
	// Fire-and-forget UPDATE — UI всё равно получает grade в response.
	if s.ReflectionLogUpdater != nil {
		if id, perr := uuid.Parse(req.Msg.GetUserResourceLogId()); perr == nil && id != uuid.Nil {
			_ = s.ReflectionLogUpdater.UpdateReflection(ctx, id,
				req.Msg.GetTakeaways(), out.QualityScore, out.ExtractedTopics, out.ConfusionFlag)
		}
	}
	return connect.NewResponse(&pb.GradeReflectionResponse{
		QualityScore:    out.QualityScore,
		ExtractedTopics: out.ExtractedTopics,
		ConfusionFlag:   out.ConfusionFlag,
	}), nil
}

// ─── helpers ──────────────────────────────────────────────────────────────

func targetFromProto(t *pb.ResourceTarget) (app.Target, error) {
	if t == nil {
		return app.Target{}, errors.New("target required")
	}
	out := app.Target{AtlasNodeID: t.GetAtlasNodeId()}
	if t.GetStepTrackId() != "" {
		id, err := uuid.Parse(t.GetStepTrackId())
		if err != nil {
			return out, fmt.Errorf("invalid step_track_id: %w", err)
		}
		out.StepTrackID = &id
		idx := int16(t.GetStepIndex())
		out.StepIndex = &idx
	}
	if !out.Valid() {
		return out, errors.New("target requires atlas_node_id OR (step_track_id + step_index)")
	}
	return out, nil
}

func resourceFromProto(r *pb.Resource) domain.Resource {
	if r == nil {
		return domain.Resource{}
	}
	return domain.Resource{
		URL:              r.GetUrl(),
		Title:            r.GetTitle(),
		Author:           r.GetAuthor(),
		Kind:             domain.Kind(r.GetKind()),
		Minutes:          int(r.GetMinutes()),
		Level:            domain.Level(r.GetLevel()),
		Priority:         domain.Priority(r.GetPriority()),
		Why:              r.GetWhy(),
		TopicsCovered:    r.GetTopicsCovered(),
		Prereqs:          r.GetPrereqs(),
		Summary:          r.GetSummary(),
		Depth:            domain.Depth(r.GetDepth()),
		FormatNotes:      r.GetFormatNotes(),
		ReflectionPrompt: r.GetReflectionPrompt(),
	}
}

func toResourceProto(r domain.Resource) *pb.Resource {
	return &pb.Resource{
		Url:              r.URL,
		Title:            r.Title,
		Author:           r.Author,
		Kind:             string(r.Kind),
		Minutes:          int32(r.Minutes),
		Level:            string(r.Level),
		Priority:         string(r.Priority),
		Why:              r.Why,
		TopicsCovered:    r.TopicsCovered,
		Prereqs:          r.Prereqs,
		Summary:          r.Summary,
		Depth:            string(r.Depth),
		FormatNotes:      r.FormatNotes,
		ReflectionPrompt: r.ReflectionPrompt,
	}
}

func requireUser(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	return uid, nil
}

func toConnectErr(err error) error {
	if errors.Is(err, domain.ErrInvalidResource) {
		return connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewError(connect.CodeInternal, err)
}
