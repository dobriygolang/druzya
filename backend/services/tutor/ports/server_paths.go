// server_paths.go — Stream D (2026-05-12). Reading-path RPC handlers.
// Build-tag `tutorpaths` снят 2026-05-12 после `make generate` —
// proto types существуют.
package ports

import (
	"context"
	"errors"
	"fmt"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/tutor/app"
	"druz9/tutor/domain"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *TutorServer) ListReadingPaths(
	ctx context.Context,
	req *connect.Request[pb.TutorListReadingPathsRequest],
) (*connect.Response[pb.TutorListReadingPathsResponse], error) {
	if s.ListReadingPathsUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ListReadingPaths not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	res, err := s.ListReadingPathsUC.Do(ctx, uid, int(req.Msg.GetLimit()), req.Msg.GetCursor())
	if err != nil {
		return nil, fmt.Errorf("tutor.ListReadingPaths: %w", s.toConnectErr(err))
	}
	out := &pb.TutorListReadingPathsResponse{
		Items:      make([]*pb.TutorReadingPath, 0, len(res.Items)),
		NextCursor: res.NextCursor,
	}
	for _, p := range res.Items {
		out.Items = append(out.Items, toReadingPathProto(p))
	}
	return connect.NewResponse(out), nil
}

func (s *TutorServer) CreateReadingPath(
	ctx context.Context,
	req *connect.Request[pb.TutorCreateReadingPathRequest],
) (*connect.Response[pb.TutorReadingPath], error) {
	if s.CreateReadingPathUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("CreateReadingPath not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	resourceIDs, err := parseUUIDList(req.Msg.GetResourceIds())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("resource_ids: %w", err))
	}
	p, err := s.CreateReadingPathUC.Do(ctx, app.CreateReadingPathInput{
		TutorID:       uid,
		Name:          req.Msg.GetName(),
		Description:   req.Msg.GetDescription(),
		AtlasNodeKeys: req.Msg.GetAtlasNodeKeys(),
		ResourceIDs:   resourceIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.CreateReadingPath: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toReadingPathProto(p)), nil
}

func (s *TutorServer) UpdateReadingPath(
	ctx context.Context,
	req *connect.Request[pb.TutorUpdateReadingPathRequest],
) (*connect.Response[pb.TutorReadingPath], error) {
	if s.UpdateReadingPathUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("UpdateReadingPath not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	pathID, err := uuid.Parse(req.Msg.GetPathId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("path_id: %w", err))
	}
	resourceIDs, err := parseUUIDList(req.Msg.GetResourceIds())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("resource_ids: %w", err))
	}
	p, err := s.UpdateReadingPathUC.Do(ctx, app.UpdateReadingPathInput{
		TutorID:       uid,
		PathID:        pathID,
		Name:          req.Msg.GetName(),
		Description:   req.Msg.GetDescription(),
		AtlasNodeKeys: req.Msg.GetAtlasNodeKeys(),
		ResourceIDs:   resourceIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("tutor.UpdateReadingPath: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toReadingPathProto(p)), nil
}

func (s *TutorServer) ArchiveReadingPath(
	ctx context.Context,
	req *connect.Request[pb.TutorArchiveReadingPathRequest],
) (*connect.Response[pb.TutorArchiveReadingPathResponse], error) {
	if s.ArchiveReadingPathUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ArchiveReadingPath not wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	pathID, err := uuid.Parse(req.Msg.GetPathId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("path_id: %w", err))
	}
	if err := s.ArchiveReadingPathUC.Do(ctx, app.ArchiveReadingPathInput{
		TutorID: uid,
		PathID:  pathID,
	}); err != nil {
		return nil, fmt.Errorf("tutor.ArchiveReadingPath: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.TutorArchiveReadingPathResponse{}), nil
}

func toReadingPathProto(p domain.ReadingPath) *pb.TutorReadingPath {
	out := &pb.TutorReadingPath{
		Id:            p.ID.String(),
		TutorId:       p.TutorID.String(),
		Name:          p.Name,
		Description:   p.Description,
		AtlasNodeKeys: append([]string{}, p.AtlasNodeKeys...),
		ResourceIds:   make([]string, 0, len(p.ResourceIDs)),
		AssignedCount: int32(p.AssignedCount),
	}
	for _, id := range p.ResourceIDs {
		out.ResourceIds = append(out.ResourceIds, id.String())
	}
	if p.ArchivedAt != nil {
		out.ArchivedAt = timestamppb.New(p.ArchivedAt.UTC())
	}
	if !p.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(p.CreatedAt.UTC())
	}
	if !p.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(p.UpdatedAt.UTC())
	}
	return out
}

// parseUUIDList — best-effort batch parse for proto string repeated UUIDs.
// Empty input → empty slice (not nil) so the use case's len() check is
// honest. Returns the first malformed entry's error so the caller maps
// it to InvalidArgument with the offending index in the message.
func parseUUIDList(in []string) ([]uuid.UUID, error) {
	if len(in) == 0 {
		return []uuid.UUID{}, nil
	}
	out := make([]uuid.UUID, 0, len(in))
	for i, s := range in {
		id, err := uuid.Parse(s)
		if err != nil {
			return nil, fmt.Errorf("index %d (%q): %w", i, s, err)
		}
		out = append(out, id)
	}
	return out, nil
}
