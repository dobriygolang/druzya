// Package ports exposes the podcast domain via Connect-RPC.
//
// PodcastServer implements druz9v1connect.PodcastServiceHandler (generated
// from proto/druz9/v1/podcast.proto). Mounted via NewPodcastServiceHandler +
// vanguard in main.go — serves both /druz9.v1.PodcastService/* and
// /api/v1/podcast/* for REST clients.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/podcast/app"
	"druz9/podcast/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — PodcastServer satisfies the generated handler.
var _ druz9v1connect.PodcastServiceHandler = (*PodcastServer)(nil)

// PodcastServer adapts podcast use cases to Connect. Fields use the UC
// suffix to avoid collision with the generated method names
// (ListCatalog / UpdateProgress).
type PodcastServer struct {
	ListUC   *app.ListCatalog
	UpdateUC *app.UpdateProgress
	Log      *slog.Logger
}

// NewPodcastServer wires a PodcastServer.
func NewPodcastServer(list *app.ListCatalog, upd *app.UpdateProgress, log *slog.Logger) *PodcastServer {
	return &PodcastServer{ListUC: list, UpdateUC: upd, Log: log}
}

// ListCatalog implements druz9.v1.PodcastService/ListCatalog.
func (s *PodcastServer) ListCatalog(
	ctx context.Context,
	req *connect.Request[pb.ListCatalogRequest],
) (*connect.Response[pb.PodcastCatalog], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}

	var section *enums.Section
	if reqSection := req.Msg.GetSection(); reqSection != pb.Section_SECTION_UNSPECIFIED {
		sec := sectionFromProtoPodcast(reqSection)
		if !sec.IsValid() {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid section"))
		}
		section = &sec
	}

	entries, err := s.ListUC.Do(ctx, uid, section)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.PodcastCatalog{Items: make([]*pb.Podcast, 0, len(entries))}
	for _, e := range entries {
		out.Items = append(out.Items, toPodcastProto(e))
	}
	return connect.NewResponse(out), nil
}

// UpdateProgress implements druz9.v1.PodcastService/UpdateProgress.
func (s *PodcastServer) UpdateProgress(
	ctx context.Context,
	req *connect.Request[pb.UpdateProgressRequest],
) (*connect.Response[pb.PodcastProgress], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	podID, err := uuid.Parse(m.GetPodcastId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid podcast_id: %w", err))
	}
	if m.GetProgressSec() < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("progress_sec must be >= 0"))
	}
	in := app.UpdateProgressInput{
		UserID:      uid,
		PodcastID:   podID,
		ListenedSec: int(m.GetProgressSec()),
	}
	// proto3 `bool completed` defaults to false; the app layer treats nil as
	// "client did not assert completion", but the OpenAPI contract also has
	// it as an optional field where the common path sends only
	// `progress_sec`. Pass through the literal value unconditionally — the
	// domain.ApplyProgress guard prevents un-completing a finished episode.
	if completed := m.GetCompleted(); completed {
		in.Completed = &completed
	}
	view, err := s.UpdateUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toProgressProto(view)), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *PodcastServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrInvalidDuration):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("podcast: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("podcast failure"))
	}
}

// ── converters (app/domain → proto) ───────────────────────────────────────

func toPodcastProto(e app.CatalogEntry) *pb.Podcast {
	title := e.Podcast.TitleRu
	if title == "" {
		title = e.Podcast.TitleEn
	}
	out := &pb.Podcast{
		Id:          e.Podcast.ID.String(),
		Title:       title,
		Description: e.Podcast.Description,
		Section:     sectionToProtoPodcast(e.Podcast.Section),
		DurationSec: int32(e.Podcast.DurationSec),
		AudioUrl:    e.AudioURL,
		ProgressSec: int32(e.Progress),
		Completed:   e.Completed,
	}
	return out
}

func toProgressProto(v app.ProgressView) *pb.PodcastProgress {
	out := &pb.PodcastProgress{
		PodcastId:   v.PodcastID.String(),
		ProgressSec: int32(v.ProgressSec),
		Completed:   v.Completed,
	}
	if v.CompletedAt != nil {
		out.CompletedAt = timestamppb.New(v.CompletedAt.UTC())
	}
	return out
}

// ── enum adapters (local copies — each domain ports module is separate) ──

func sectionToProtoPodcast(s enums.Section) pb.Section {
	switch s {
	case enums.SectionAlgorithms:
		return pb.Section_SECTION_ALGORITHMS
	case enums.SectionSQL:
		return pb.Section_SECTION_SQL
	case enums.SectionGo:
		return pb.Section_SECTION_GO
	case enums.SectionSystemDesign:
		return pb.Section_SECTION_SYSTEM_DESIGN
	case enums.SectionBehavioral:
		return pb.Section_SECTION_BEHAVIORAL
	default:
		return pb.Section_SECTION_UNSPECIFIED
	}
}

func sectionFromProtoPodcast(s pb.Section) enums.Section {
	switch s {
	case pb.Section_SECTION_ALGORITHMS:
		return enums.SectionAlgorithms
	case pb.Section_SECTION_SQL:
		return enums.SectionSQL
	case pb.Section_SECTION_GO:
		return enums.SectionGo
	case pb.Section_SECTION_SYSTEM_DESIGN:
		return enums.SectionSystemDesign
	case pb.Section_SECTION_BEHAVIORAL:
		return enums.SectionBehavioral
	default:
		return ""
	}
}
