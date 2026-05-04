// atlas_todo_connect.go — Connect-RPC handler for ClassifyAtlasTodo
// (Phase 3.1 user-driven atlas).
package ports

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

func (s *ProfileServer) ClassifyAtlasTodo(
	ctx context.Context,
	req *connect.Request[pb.ClassifyAtlasTodoRequest],
) (*connect.Response[pb.ClassifyAtlasTodoResponse], error) {
	if s.H.ClassifyAtlasTodo == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("classify_atlas_todo: not wired (no LLM configured)"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.H.ClassifyAtlasTodo.Do(ctx, uid, req.Msg.Todo)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	resp := &pb.ClassifyAtlasTodoResponse{
		MatchedKey: out.MatchedKey,
	}
	if out.NewNode != nil {
		resp.NewNode = &pb.UserAtlasNode{
			NodeKey:     out.NewNode.NodeKey,
			Title:       out.NewNode.Title,
			Description: out.NewNode.Description,
			Section:     out.NewNode.Section,
			Kind:        out.NewNode.Kind,
			Cluster:     out.NewNode.Cluster,
			SourceText:  out.NewNode.SourceText,
			CreatedAt:   out.NewNode.CreatedAt.UTC().Format(time.RFC3339),
		}
	}
	return connect.NewResponse(resp), nil
}
