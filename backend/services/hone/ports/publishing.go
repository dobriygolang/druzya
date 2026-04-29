// publishing.go — Connect-RPC adapters for the hone publish-to-web JSON
// surface. The HTML viewer at /p/{slug} stays chi-direct (renders strict-
// CSP HTML — proto-vanguard's JSON codec can't shape that).
package ports

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"druz9/hone/app"
	"druz9/hone/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func (s *HoneServer) PublishNote(
	ctx context.Context,
	req *connect.Request[pb.PublishNoteRequest],
) (*connect.Response[pb.PublishNoteResponse], error) {
	uid, id, err := s.requirePubInputs(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	out, perr := s.H.PublishNote.Do(ctx, app.PublishNoteInput{UserID: uid, NoteID: id})
	if perr != nil {
		switch {
		case errors.Is(perr, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		case errors.Is(perr, domain.ErrEncryptedCannotPublish):
			return nil, connect.NewError(connect.CodeFailedPrecondition,
				errors.New("encrypted_cannot_publish"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.PublishNoteResponse{
		Slug:        out.Slug,
		Url:         publicURL(out.Slug),
		PublishedAt: out.PublishedAt.UTC().Format(time.RFC3339),
	}), nil
}

func (s *HoneServer) UnpublishNote(
	ctx context.Context,
	req *connect.Request[pb.UnpublishNoteRequest],
) (*connect.Response[pb.UnpublishNoteResponse], error) {
	uid, id, err := s.requirePubInputs(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if perr := s.H.UnpublishNote.Do(ctx, app.UnpublishNoteInput{UserID: uid, NoteID: id}); perr != nil {
		if errors.Is(perr, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.UnpublishNoteResponse{Ok: true}), nil
}

func (s *HoneServer) PublishStatus(
	ctx context.Context,
	req *connect.Request[pb.PublishStatusRequest],
) (*connect.Response[pb.PublishStatusResponse], error) {
	uid, id, err := s.requirePubInputs(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	out, perr := s.H.PublishStatusUC.Do(ctx, app.PublishStatusInput{UserID: uid, NoteID: id})
	if perr != nil {
		if errors.Is(perr, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	resp := &pb.PublishStatusResponse{Published: out.Published}
	if out.Published {
		resp.Slug = out.Slug
		resp.Url = publicURL(out.Slug)
		if out.At != nil {
			resp.PublishedAt = out.At.UTC().Format(time.RFC3339)
		}
	}
	return connect.NewResponse(resp), nil
}

func (s *HoneServer) ShareToWeb(
	ctx context.Context,
	req *connect.Request[pb.ShareToWebRequest],
) (*connect.Response[pb.ShareToWebResponse], error) {
	uid, id, err := s.requirePubInputs(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	out, perr := s.H.ShareToWeb.Do(ctx, app.ShareToWebInput{
		UserID:         uid,
		NoteID:         id,
		PlaintextMD:    req.Msg.PlaintextMd,
		OriginDeviceID: sharedMw.DeviceIDFromContext(ctx),
	})
	if perr != nil {
		if errors.Is(perr, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.ShareToWebResponse{
		Slug:             out.Slug,
		Url:              publicURL(out.Slug),
		PublishedAt:      out.PublishedAt.UTC().Format(time.RFC3339),
		AlreadyPublished: out.AlreadyPublished,
	}), nil
}

func (s *HoneServer) MakePrivate(
	ctx context.Context,
	req *connect.Request[pb.MakePrivateRequest],
) (*connect.Response[pb.MakePrivateResponse], error) {
	uid, id, err := s.requirePubInputs(ctx, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	if perr := s.H.MakePrivate.Do(ctx, app.MakePrivateInput{
		UserID:         uid,
		NoteID:         id,
		CiphertextB64:  req.Msg.CiphertextB64,
		OriginDeviceID: sharedMw.DeviceIDFromContext(ctx),
	}); perr != nil {
		switch {
		case errors.Is(perr, app.ErrMakePrivateEmptyCiphertext):
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("empty_ciphertext"))
		case errors.Is(perr, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.MakePrivateResponse{Ok: true}), nil
}

func (s *HoneServer) BulkNotesMeta(
	ctx context.Context,
	_ *connect.Request[pb.BulkNotesMetaRequest],
) (*connect.Response[pb.BulkNotesMetaResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	out, err := s.H.BulkNotesMeta.Do(ctx, app.BulkNotesMetaInput{UserID: uid})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	resp := &pb.BulkNotesMetaResponse{Notes: make([]*pb.NoteMeta, 0, len(out.Notes))}
	for _, m := range out.Notes {
		resp.Notes = append(resp.Notes, &pb.NoteMeta{
			Id: m.ID, Encrypted: m.Encrypted, Published: m.Published,
		})
	}
	return connect.NewResponse(resp), nil
}

func (s *HoneServer) requirePubInputs(ctx context.Context, idStr string) (uuid.UUID, uuid.UUID, error) {
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

// publicURL is the URL the JSON responses surface back to the frontend.
// Kept identical to the cmd-side legacy helper (DRUZ9_PUBLIC_URL env);
// reading the env here keeps the adapter dependency-light.
func publicURL(slug string) string {
	base := strings.TrimRight(envOr("DRUZ9_PUBLIC_URL", "https://druz9.online"), "/")
	return base + "/p/" + slug
}
