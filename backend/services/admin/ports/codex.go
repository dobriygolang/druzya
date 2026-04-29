// codex.go — Connect-RPC adapter for the codex bounded context.
//
// CodexServer is separate from AdminServer because the codex surface mixes
// public reads with admin mutations. The handler trusts that the chi mount
// in cmd/monolith already split public vs admin routes (auth-gating happens
// there); this file's job is just the proto ↔ domain translation.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"

	"druz9/admin/app"
	"druz9/admin/domain"
	sharedDomain "druz9/shared/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"
)

// CodexServer satisfies druz9v1connect.CodexServiceHandler.
//
// Dependencies are nilable on creation so the wiring in cmd/monolith can
// inject them progressively (the openArticle tap pulls in coach memory and
// the bus only when those are available).
type CodexServer struct {
	ListArticlesUC   *app.ListCodexArticles
	GetArticleMetaUC *app.GetCodexArticleMeta
	CreateArticleUC  *app.CreateCodexArticle
	UpdateArticleUC  *app.UpdateCodexArticle
	DeleteArticleUC  *app.DeleteCodexArticle
	ToggleArticleUC  *app.ToggleCodexArticle
	ListCategoriesUC *app.ListCodexCategories
	CreateCategoryUC *app.CreateCodexCategory
	UpdateCategoryUC *app.UpdateCodexCategory
	DeleteCategoryUC *app.DeleteCodexCategory

	// MemoryAppend is the optional coach-memory tap. Defined as a function
	// rather than a typed *intelligence.Memory so the admin module stays
	// free of a cross-service import. The wirer in cmd/monolith binds it
	// to intelligence.Memory.AppendAsync.
	MemoryAppend MemoryAppendFn

	// Bus is the optional Phase C event publisher. nil-safe.
	Bus sharedDomain.Bus

	Log *slog.Logger
}

// MemoryAppendFn is the coach-memory tap signature. The admin module does
// not import the intelligence package; the wirer adapts it.
type MemoryAppendFn func(ctx context.Context, userID uuid.UUID, articleID uuid.UUID, slug, category, title string)

var _ druz9v1connect.CodexServiceHandler = (*CodexServer)(nil)

// ── Articles ────────────────────────────────────────────────────────────

func (s *CodexServer) ListArticles(
	ctx context.Context,
	req *connect.Request[pb.ListCodexArticlesRequest],
) (*connect.Response[pb.CodexArticleList], error) {
	rows, err := s.ListArticlesUC.Do(ctx, req.Msg.ActiveOnly)
	if err != nil {
		s.logErr(ctx, "ListArticles", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.CodexArticleList{Items: make([]*pb.CodexArticle, 0, len(rows))}
	for _, a := range rows {
		out.Items = append(out.Items, articleToProto(a))
	}
	return connect.NewResponse(out), nil
}

func (s *CodexServer) CreateArticle(
	ctx context.Context,
	req *connect.Request[pb.CreateCodexArticleRequest],
) (*connect.Response[pb.CodexArticle], error) {
	if req.Msg.Article == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("article required"))
	}
	out, err := s.CreateArticleUC.Do(ctx, upsertFromProto(req.Msg.Article))
	if err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("slug, title, category, href are required"))
		}
		s.logErr(ctx, "CreateArticle", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(articleToProto(out)), nil
}

func (s *CodexServer) UpdateArticle(
	ctx context.Context,
	req *connect.Request[pb.UpdateCodexArticleRequest],
) (*connect.Response[pb.CodexArticle], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if req.Msg.Article == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("article required"))
	}
	out, err := s.UpdateArticleUC.Do(ctx, id, upsertFromProto(req.Msg.Article))
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidInput):
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("slug, title, category, href are required"))
		case errors.Is(err, domain.ErrNotFound):
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "UpdateArticle", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(articleToProto(out)), nil
}

func (s *CodexServer) DeleteArticle(
	ctx context.Context,
	req *connect.Request[pb.DeleteCodexArticleRequest],
) (*connect.Response[pb.DeleteCodexArticleResponse], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.DeleteArticleUC.Do(ctx, id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "DeleteArticle", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.DeleteCodexArticleResponse{Ok: true}), nil
}

func (s *CodexServer) ToggleArticle(
	ctx context.Context,
	req *connect.Request[pb.ToggleCodexArticleRequest],
) (*connect.Response[pb.ToggleCodexArticleResponse], error) {
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	if err := s.ToggleArticleUC.Do(ctx, id, req.Msg.Active); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "ToggleArticle", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.ToggleCodexArticleResponse{Ok: true}), nil
}

func (s *CodexServer) OpenArticle(
	ctx context.Context,
	req *connect.Request[pb.OpenCodexArticleRequest],
) (*connect.Response[pb.OpenCodexArticleResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	id, err := uuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid id"))
	}
	meta, err := s.GetArticleMetaUC.Do(ctx, id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "OpenArticle: lookup", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	if s.MemoryAppend != nil {
		s.MemoryAppend(ctx, uid, id, meta.Slug, meta.Category, meta.Title)
	}
	if s.Bus != nil {
		if perr := s.Bus.Publish(ctx, sharedDomain.CodexArticleRead{
			UserID: uid, ArticleID: id, Slug: meta.Slug, ReadMin: meta.ReadMin,
		}); perr != nil {
			s.logErr(ctx, "OpenArticle: bus.Publish", perr)
		}
	}
	return connect.NewResponse(&pb.OpenCodexArticleResponse{Ok: true}), nil
}

// ── Categories ──────────────────────────────────────────────────────────

func (s *CodexServer) ListCategories(
	ctx context.Context,
	req *connect.Request[pb.ListCodexCategoriesRequest],
) (*connect.Response[pb.CodexCategoryList], error) {
	rows, err := s.ListCategoriesUC.Do(ctx, req.Msg.ActiveOnly)
	if err != nil {
		s.logErr(ctx, "ListCategories", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	out := &pb.CodexCategoryList{Items: make([]*pb.CodexCategory, 0, len(rows))}
	for _, c := range rows {
		out.Items = append(out.Items, categoryToProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *CodexServer) CreateCategory(
	ctx context.Context,
	req *connect.Request[pb.CreateCodexCategoryRequest],
) (*connect.Response[pb.CodexCategory], error) {
	if req.Msg.Category == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("category required"))
	}
	in := categoryFromProto(req.Msg.Category)
	if err := s.CreateCategoryUC.Do(ctx, in); err != nil {
		if errors.Is(err, domain.ErrInvalidInput) {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				errors.New("slug and label are required"))
		}
		s.logErr(ctx, "CreateCategory", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(categoryToProto(in)), nil
}

func (s *CodexServer) UpdateCategory(
	ctx context.Context,
	req *connect.Request[pb.UpdateCodexCategoryRequest],
) (*connect.Response[pb.CodexCategory], error) {
	if req.Msg.Slug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("slug required"))
	}
	if req.Msg.Category == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("category required"))
	}
	in := categoryFromProto(req.Msg.Category)
	in.Slug = req.Msg.Slug
	if err := s.UpdateCategoryUC.Do(ctx, req.Msg.Slug, in); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "UpdateCategory", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(categoryToProto(in)), nil
}

func (s *CodexServer) DeleteCategory(
	ctx context.Context,
	req *connect.Request[pb.DeleteCodexCategoryRequest],
) (*connect.Response[pb.DeleteCodexCategoryResponse], error) {
	if err := s.DeleteCategoryUC.Do(ctx, req.Msg.Slug); err != nil {
		var inUse *app.ErrCategoryInUse
		if errors.As(err, &inUse) {
			return nil, connect.NewError(connect.CodeFailedPrecondition,
				fmt.Errorf("%d articles still use this category — reassign first", inUse.Count))
		}
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("not_found"))
		}
		s.logErr(ctx, "DeleteCategory", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("internal"))
	}
	return connect.NewResponse(&pb.DeleteCodexCategoryResponse{Ok: true}), nil
}

// ── helpers ─────────────────────────────────────────────────────────────

func (s *CodexServer) logErr(ctx context.Context, where string, err error) {
	if s.Log == nil {
		return
	}
	s.Log.ErrorContext(ctx, "codex."+where, slog.Any("err", err))
}

func articleToProto(a domain.CodexArticle) *pb.CodexArticle {
	return &pb.CodexArticle{
		Id: a.ID, Slug: a.Slug, Title: a.Title, Description: a.Description,
		Category: a.Category, Href: a.Href, Source: a.Source,
		ReadMin:   int32(a.ReadMin),
		SortOrder: int32(a.SortOrder),
		Active:    a.Active,
	}
}

func upsertFromProto(p *pb.CodexArticleUpsert) domain.CodexArticleUpsert {
	active := p.Active
	return domain.CodexArticleUpsert{
		Slug: p.Slug, Title: p.Title, Description: p.Description,
		Category: p.Category, Href: p.Href, Source: p.Source,
		ReadMin: int(p.ReadMin), SortOrder: int(p.SortOrder),
		Active: &active,
	}
}

func categoryToProto(c domain.CodexCategory) *pb.CodexCategory {
	return &pb.CodexCategory{
		Slug: c.Slug, Label: c.Label, Description: c.Description,
		SortOrder: int32(c.SortOrder), Active: c.Active,
	}
}

func categoryFromProto(p *pb.CodexCategory) domain.CodexCategory {
	return domain.CodexCategory{
		Slug: p.Slug, Label: p.Label, Description: p.Description,
		SortOrder: int(p.SortOrder), Active: p.Active,
	}
}
