package ports

import (
	"context"
	"errors"

	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
)

// ─────────────────────────────────────────────────────────────────────────
// Companies
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListCompanies(
	ctx context.Context,
	_ *connect.Request[pb.ListCompaniesRequest],
) (*connect.Response[pb.CompanyList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.ListCompaniesUC.Do(ctx)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.CompanyList{Items: make([]*pb.Company, 0, len(list))}
	for _, c := range list {
		out.Items = append(out.Items, toCompanyProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *AdminServer) CreateCompany(
	ctx context.Context,
	req *connect.Request[pb.CreateCompanyRequest],
) (*connect.Response[pb.Company], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	body := req.Msg.GetCompany()
	if body == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("company body required"))
	}
	in := domain.CompanyUpsert{
		Slug:             body.GetSlug(),
		Name:             body.GetName(),
		Difficulty:       dungeonTierFromProto(body.GetDifficulty()),
		MinLevelRequired: int(body.GetMinLevelRequired()),
	}
	out, err := s.UpsertCompanyUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toCompanyProto(out)), nil
}

func toCompanyProto(c domain.AdminCompany) *pb.Company {
	out := &pb.Company{
		Id:               c.ID.String(),
		Slug:             c.Slug,
		Name:             c.Name,
		Difficulty:       dungeonTierToProto(c.Difficulty),
		MinLevelRequired: int32(c.MinLevelRequired),
	}
	for _, s := range c.Sections {
		out.Sections = append(out.Sections, sectionToProtoAdmin(s))
	}
	return out
}
