// atlas_pref_connect.go — pin/hide overlay handler
// (table user_atlas_node_prefs).
//
// SetAtlasNodePref upsert'ит one row. Direct SQL — простейший CRUD без
// app-UC, потому что валидация (only one of pinned/hidden) уже на DB
// CHECK constraint.
package ports

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"

	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"
)

func (s *ProfileServer) SetAtlasNodePref(
	ctx context.Context,
	req *connect.Request[pb.SetAtlasNodePrefRequest],
) (*connect.Response[pb.SetAtlasNodePrefResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if s.H.Pool == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("atlas_pref: pool not wired"))
	}
	nodeKey := strings.TrimSpace(req.Msg.GetNodeKey())
	if nodeKey == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node_key required"))
	}
	pinned := req.Msg.GetPinned()
	hidden := req.Msg.GetHidden()
	if pinned && hidden {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("pinned and hidden are mutually exclusive"))
	}
	_, err := s.H.Pool.Exec(ctx,
		`INSERT INTO user_atlas_node_prefs (user_id, node_key, pinned, hidden, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (user_id, node_key) DO UPDATE SET
		   pinned     = EXCLUDED.pinned,
		   hidden     = EXCLUDED.hidden,
		   updated_at = now()`,
		sharedpg.UUID(uid), nodeKey, pinned, hidden,
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&pb.SetAtlasNodePrefResponse{Ok: true}), nil
}
