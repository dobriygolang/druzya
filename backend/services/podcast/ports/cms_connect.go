// cms_connect.go — Connect-RPC adapters for the podcast CMS surface.
//
// The CMS multipart upload (POST /admin/podcast) stays in cms_handler.go as
// a legitimate chi exception (binary audio uploads up to 200 MB). All other
// CMS endpoints are migrated to Connect+vanguard here.
package ports

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"druz9/podcast/app"
	"druz9/podcast/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
)

// AttachCMS wires the CMSService into the existing PodcastServer so the
// handler satisfies the extended PodcastServiceHandler interface.
func (s *PodcastServer) AttachCMS(svc *app.CMSService) *PodcastServer {
	s.CMS = svc
	return s
}

func (s *PodcastServer) ListCMSPodcasts(
	ctx context.Context,
	req *connect.Request[pb.ListCMSPodcastsRequest],
) (*connect.Response[pb.CMSPodcastList], error) {
	f := domain.CMSListFilter{
		OnlyPublished: req.Msg.OnlyPublished,
		Limit:         int(req.Msg.Limit),
	}
	if req.Msg.CategoryId != "" {
		id, err := uuid.Parse(req.Msg.CategoryId)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid category_id"))
		}
		f.CategoryID = &id
	}
	rows, err := s.CMS.ListCMSPodcasts(ctx, f)
	if err != nil {
		s.logCMSErr(ctx, "ListCMSPodcasts", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.CMSPodcastList{Items: make([]*pb.CMSPodcast, 0, len(rows))}
	for _, p := range rows {
		out.Items = append(out.Items, cmsPodcastToProto(p))
	}
	return connect.NewResponse(out), nil
}

func (s *PodcastServer) GetCMSPodcast(
	ctx context.Context,
	req *connect.Request[pb.GetCMSPodcastRequest],
) (*connect.Response[pb.CMSPodcast], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	row, err := s.CMS.GetCMSPodcast(ctx, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logCMSErr(ctx, "GetCMSPodcast", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(cmsPodcastToProto(row)), nil
}

func (s *PodcastServer) ListCMSCategories(
	ctx context.Context,
	_ *connect.Request[pb.ListCMSCategoriesRequest],
) (*connect.Response[pb.CMSPodcastCategoryList], error) {
	rows, err := s.CMS.ListCategories(ctx)
	if err != nil {
		s.logCMSErr(ctx, "ListCMSCategories", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.CMSPodcastCategoryList{Items: make([]*pb.CMSPodcastCategory, 0, len(rows))}
	for _, c := range rows {
		out.Items = append(out.Items, cmsCategoryToProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *PodcastServer) UpdateCMSPodcastMetadata(
	ctx context.Context,
	req *connect.Request[pb.UpdateCMSPodcastMetadataRequest],
) (*connect.Response[pb.CMSPodcast], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if strings.TrimSpace(req.Msg.Title) == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("title required"))
	}
	in := app.UpdatePodcastInput{
		Title:       req.Msg.Title,
		Description: req.Msg.Description,
		Host:        req.Msg.Host,
		IsPublished: req.Msg.IsPublished,
	}
	if req.Msg.CategoryId != "" {
		cid, perr := uuid.Parse(req.Msg.CategoryId)
		if perr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid category_id"))
		}
		in.CategoryID = &cid
	}
	if req.Msg.HasEpisodeNum {
		ep := int(req.Msg.EpisodeNum)
		in.EpisodeNum = &ep
	}
	row, err := s.CMS.UpdatePodcast(ctx, id, in)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		case errors.Is(err, domain.ErrCategoryNotFound):
			return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("category_not_found"))
		case errors.Is(err, domain.ErrInvalidPodcast):
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.logCMSErr(ctx, "UpdateCMSPodcastMetadata", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(cmsPodcastToProto(row)), nil
}

func (s *PodcastServer) DeleteCMSPodcast(
	ctx context.Context,
	req *connect.Request[pb.DeleteCMSPodcastRequest],
) (*connect.Response[pb.DeleteCMSPodcastResponse], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.CMS.DeletePodcast(ctx, id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logCMSErr(ctx, "DeleteCMSPodcast", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.DeleteCMSPodcastResponse{Ok: true}), nil
}

func (s *PodcastServer) CreateCMSCategory(
	ctx context.Context,
	req *connect.Request[pb.CreateCMSCategoryRequest],
) (*connect.Response[pb.CMSPodcastCategory], error) {
	in := domain.PodcastCategory{
		Slug:      req.Msg.Slug,
		Name:      req.Msg.Name,
		Color:     req.Msg.Color,
		SortOrder: int(req.Msg.SortOrder),
	}
	row, err := s.CMS.CreateCategory(ctx, in)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidPodcast) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		s.logCMSErr(ctx, "CreateCMSCategory", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(cmsCategoryToProto(row)), nil
}

// ── helpers ─────────────────────────────────────────────────────────────

func (s *PodcastServer) logCMSErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "podcast.cms."+where, "err", err)
}

func cmsPodcastToProto(p domain.CMSPodcast) *pb.CMSPodcast {
	out := &pb.CMSPodcast{
		Id: p.ID.String(), Title: p.Title, TitleEn: p.TitleEN,
		Description: p.Description, Host: p.Host,
		DurationSec: int32(p.DurationSec), AudioUrl: p.AudioURL,
		CoverUrl: p.CoverURL, IsPublished: p.IsPublished,
		CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: p.UpdatedAt.UTC().Format(time.RFC3339),
	}
	if p.CategoryID != nil {
		out.CategoryId = p.CategoryID.String()
	}
	if p.Category != nil {
		out.Category = cmsCategoryToProto(*p.Category)
	}
	if p.EpisodeNum != nil {
		out.EpisodeNum = int32(*p.EpisodeNum)
		out.HasEpisodeNum = true
	}
	if p.PublishedAt != nil {
		out.PublishedAt = p.PublishedAt.UTC().Format(time.RFC3339)
	}
	return out
}

func cmsCategoryToProto(c domain.PodcastCategory) *pb.CMSPodcastCategory {
	return &pb.CMSPodcastCategory{
		Id: c.ID.String(), Slug: c.Slug, Name: c.Name,
		Color: c.Color, SortOrder: int32(c.SortOrder),
	}
}

// suppress unused imports when this file is generated standalone:
var _ = fmt.Sprintf
