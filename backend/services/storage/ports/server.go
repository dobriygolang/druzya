// Package ports — Connect-RPC adapter for the storage bounded context.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
	"druz9/storage/app"
	"druz9/storage/domain"
)

type Server struct {
	GetQuotaUC           *app.GetQuota
	ArchiveOldestNotesUC *app.ArchiveOldestNotes
	ArchiveNoteUC        *app.ArchiveNote
	RestoreNoteUC        *app.RestoreNote
	Log                  *slog.Logger
}

var _ druz9v1connect.StorageServiceHandler = (*Server)(nil)

func (s *Server) GetQuota(
	ctx context.Context,
	_ *connect.Request[pb.GetStorageQuotaRequest],
) (*connect.Response[pb.StorageQuota], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	q, err := s.GetQuotaUC.Run(ctx, uid)
	if err != nil {
		s.logErr(ctx, "GetQuota", uid, err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.StorageQuota{
		UsedBytes:  q.UsedBytes,
		QuotaBytes: q.QuotaBytes,
		Tier:       q.Tier,
	}), nil
}

func (s *Server) ArchiveOldestNotes(
	ctx context.Context,
	req *connect.Request[pb.ArchiveOldestNotesRequest],
) (*connect.Response[pb.ArchiveOldestNotesResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.ArchiveOldestNotesUC.Run(ctx, app.ArchiveOldestNotesIn{
		UserID: uid,
		Count:  int(req.Msg.Count),
	})
	if err != nil {
		s.logErr(ctx, "ArchiveOldestNotes", uid, err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.ArchiveOldestNotesResponse{Archived: int32(out.Archived)}), nil
}

func (s *Server) ArchiveNote(
	ctx context.Context,
	req *connect.Request[pb.ArchiveNoteRequest],
) (*connect.Response[pb.ArchiveNoteResponse], error) {
	uid, id, err := s.parseUserAndID(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if err := s.ArchiveNoteUC.Run(ctx, uid, id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "ArchiveNote", uid, err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.ArchiveNoteResponse{Ok: true}), nil
}

func (s *Server) RestoreNote(
	ctx context.Context,
	req *connect.Request[pb.RestoreNoteRequest],
) (*connect.Response[pb.RestoreNoteResponse], error) {
	uid, id, err := s.parseUserAndID(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if err := s.RestoreNoteUC.Run(ctx, uid, id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "RestoreNote", uid, err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.RestoreNoteResponse{Ok: true}), nil
}

func (s *Server) parseUserAndID(ctx context.Context, idStr string) (uuid.UUID, uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return uuid.Nil, uuid.Nil, connect.NewError(connect.CodeInvalidArgument, errors.New("bad_id"))
	}
	return uid, id, nil
}

func (s *Server) logErr(ctx context.Context, where string, uid uuid.UUID, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "storage."+where,
		slog.String("user_id", uid.String()), slog.Any("err", err))
}
