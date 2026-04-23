// dashboard.go — Connect handler for GetAdminDashboard + user mgmt + reports.
//
// Every method reuses AdminServer.requireAdmin for the role gate; the
// public /status handler lives in ports/status.go and does NOT require
// auth.
package ports

import (
	"context"
	"errors"
	"fmt"

	"druz9/admin/app"
	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// GetAdminDashboard returns the cached live counters.
func (s *AdminServer) GetAdminDashboard(
	ctx context.Context,
	_ *connect.Request[pb.GetAdminDashboardRequest],
) (*connect.Response[pb.AdminDashboard], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	if s.GetDashboardUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("dashboard not wired"))
	}
	snap, err := s.GetDashboardUC.Do(ctx)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(dashboardToProto(snap)), nil
}

// ListUsers returns paginated users.
func (s *AdminServer) ListUsers(
	ctx context.Context,
	req *connect.Request[pb.ListAdminUsersRequest],
) (*connect.Response[pb.AdminUserList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	if s.ListUsersUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("list users not wired"))
	}
	m := req.Msg
	page, err := s.ListUsersUC.Do(ctx, domain.UserListFilter{
		Query:  m.GetQuery(),
		Status: m.GetStatus(),
		Page:   int(m.GetPage()),
		Limit:  int(m.GetLimit()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AdminUserList{
		Total: int32(page.Total),
		Page:  int32(page.Page),
		Items: make([]*pb.AdminUserRow, 0, len(page.Items)),
	}
	for _, r := range page.Items {
		out.Items = append(out.Items, userRowToProto(r))
	}
	return connect.NewResponse(out), nil
}

// BanUser creates a new active ban.
func (s *AdminServer) BanUser(
	ctx context.Context,
	req *connect.Request[pb.BanUserRequest],
) (*connect.Response[pb.BanUserResponse], error) {
	adminID, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if s.BanUserUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("ban user not wired"))
	}
	m := req.Msg
	uid, perr := uuid.Parse(m.GetUserId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("user_id: %w", perr))
	}
	in := domain.BanInput{
		UserID:   uid,
		Reason:   m.GetReason(),
		IssuedBy: adminID,
	}
	if ts := m.GetExpiresAt(); ts != nil {
		t := ts.AsTime()
		in.ExpiresAt = &t
	}
	row, err := s.BanUserUC.Do(ctx, in)
	if err != nil {
		return nil, s.mapUserErr(err)
	}
	return connect.NewResponse(&pb.BanUserResponse{User: userRowToProto(row)}), nil
}

// UnbanUser lifts the active ban (if any).
func (s *AdminServer) UnbanUser(
	ctx context.Context,
	req *connect.Request[pb.UnbanUserRequest],
) (*connect.Response[pb.BanUserResponse], error) {
	adminID, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	if s.UnbanUserUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("unban user not wired"))
	}
	uid, perr := uuid.Parse(req.Msg.GetUserId())
	if perr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("user_id: %w", perr))
	}
	row, err := s.UnbanUserUC.Do(ctx, uid, adminID)
	if err != nil {
		return nil, s.mapUserErr(err)
	}
	return connect.NewResponse(&pb.BanUserResponse{User: userRowToProto(row)}), nil
}

// ListReports serves the moderation queue.
func (s *AdminServer) ListReports(
	ctx context.Context,
	req *connect.Request[pb.ListAdminReportsRequest],
) (*connect.Response[pb.AdminReportList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	if s.ListReportsUC == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, errors.New("list reports not wired"))
	}
	m := req.Msg
	items, total, err := s.ListReportsUC.Do(ctx, domain.ReportFilter{
		Status: m.GetStatus(),
		Limit:  int(m.GetLimit()),
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.AdminReportList{
		Total: int32(total),
		Items: make([]*pb.AdminReport, 0, len(items)),
	}
	for _, r := range items {
		out.Items = append(out.Items, reportToProto(r))
	}
	return connect.NewResponse(out), nil
}

// mapUserErr translates the user-mgmt specific sentinels onto Connect codes.
func (s *AdminServer) mapUserErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrUserNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrAlreadyBanned):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, domain.ErrNotBanned):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	}
	return s.toConnectErr(err)
}

// ─────────────────────────────────────────────────────────────────────────
// Converters (domain → proto)
// ─────────────────────────────────────────────────────────────────────────

func dashboardToProto(d domain.AdminDashboard) *pb.AdminDashboard {
	out := &pb.AdminDashboard{
		UsersTotal:           d.UsersTotal,
		UsersActiveToday:     d.UsersActiveToday,
		UsersActiveWeek:      d.UsersActiveWeek,
		UsersActiveMonth:     d.UsersActiveMonth,
		UsersBanned:          d.UsersBanned,
		MatchesToday:         d.MatchesToday,
		MatchesWeek:          d.MatchesWeek,
		KatasToday:           d.KatasToday,
		KatasWeek:            d.KatasWeek,
		ActiveMockSessions:   d.ActiveMockSessions,
		ActiveArenaMatches:   d.ActiveArenaMatches,
		ReportsPending:       d.ReportsPending,
		AnticheatSignals_24H: d.AnticheatSignals24h,
	}
	if !d.GeneratedAt.IsZero() {
		out.GeneratedAt = timestamppb.New(d.GeneratedAt.UTC())
	}
	return out
}

func userRowToProto(r domain.AdminUserRow) *pb.AdminUserRow {
	out := &pb.AdminUserRow{
		Id:          r.ID.String(),
		Username:    r.Username,
		Email:       r.Email,
		DisplayName: r.DisplayName,
		Role:        r.Role,
		IsBanned:    r.IsBanned,
		BanReason:   r.BanReason,
	}
	if !r.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(r.CreatedAt.UTC())
	}
	if !r.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(r.UpdatedAt.UTC())
	}
	if r.BanExpiresAt != nil {
		out.BanExpiresAt = timestamppb.New(r.BanExpiresAt.UTC())
	}
	return out
}

func reportToProto(r domain.AdminReport) *pb.AdminReport {
	out := &pb.AdminReport{
		Id:           r.ID.String(),
		ReporterId:   r.ReporterID.String(),
		ReporterName: r.ReporterName,
		ReportedId:   r.ReportedID.String(),
		ReportedName: r.ReportedName,
		Reason:       r.Reason,
		Description:  r.Description,
		Status:       r.Status,
	}
	if !r.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(r.CreatedAt.UTC())
	}
	return out
}

// assert the app packages are referenced — keeps the go.mod stable when
// the use cases are swapped around.
var (
	_ = app.DashboardCacheKey
	_ = app.StatusCacheKey
)
