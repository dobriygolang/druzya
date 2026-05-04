// Package ports wires the admin domain to HTTP via Connect-RPC.
//
// ROLE GATE — every method of AdminServer returns PermissionDenied unless
// the caller has role=admin. The check uses sharedMw.UserRoleFromContext
// (populated by requireAuth in main.go). main.go still wraps the transcoder
// in requireAuth; this port adds the admin role check on top. Mirrors the
// Phase A/B pattern — the handler never dips into app/ before the role is
// confirmed.
//
// SOLUTION_HINT EXCEPTION
// Every other domain in druz9 treats tasks.solution_hint as a secret that
// MUST NEVER cross the HTTP boundary (bible §3.14). The admin domain is the
// one legitimate exception: curators explicitly need to author, review and
// edit the hint text as part of the CMS. The role check in this file is the
// load-bearing guard — without role=admin the request never lands at the
// app layer and the hint never appears in a response body.
//
// The handler implementation is split across this directory by resource:
//   - config.go     ListConfig / UpdateConfig + structpb helpers
//   - dashboard.go  GetDashboard / ListUsers / BanUser / UnbanUser / ListReports
//   - status.go     GetStatus
//   - enums.go      proto<->domain enum adapters
//
// Pivot 2026-05-04: tasks.go / companies.go / anticheat.go удалены вместе
// с RPC'ами из admin.proto. ListCompanies UC сохранён — используется
// /companies (chi-direct) на фронте picker'а компаний.
package ports

import (
	"context"
	"errors"
	"log/slog"

	"druz9/admin/app"
	"druz9/admin/domain"
	"druz9/shared/enums"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
)

// adminRole is the exact claim string that unlocks admin routes.
const adminRole = string(enums.UserRoleAdmin)

// Compile-time assertion — AdminServer satisfies the generated handler.
var _ druz9v1connect.AdminServiceHandler = (*AdminServer)(nil)

// AdminServer adapts admin use cases to Connect.
//
// Field names use the UC suffix to avoid collision with generated method
// names (ListTasks / CreateTask / UpdateTask / …).
//
// Newer surfaces (dashboard / users / reports / status) are nilable on
// purpose — older callers that wire the legacy constructor still compile,
// and the handler returns CodeUnimplemented when a UC isn't bound. The
// monolith's services/admin.go always sets every field.
type AdminServer struct {
	ListConfigUC   *app.ListConfig
	UpdateConfigUC *app.UpdateConfig

	// Dashboard / users / reports / status surfaces (Group B).
	GetDashboardUC *app.GetDashboard
	ListUsersUC    *app.ListUsers
	BanUserUC      *app.BanUser
	UnbanUserUC    *app.UnbanUser
	ListReportsUC  *app.ListReports
	GetStatusUC    *app.GetStatus

	Log *slog.Logger
}

// NewAdminServer wires an AdminServer.
func NewAdminServer(
	listConfig *app.ListConfig,
	updateConfig *app.UpdateConfig,
	log *slog.Logger,
) *AdminServer {
	return &AdminServer{
		ListConfigUC:   listConfig,
		UpdateConfigUC: updateConfig,
		Log:            log,
	}
}

// requireAdmin returns the caller's id + true on success. On failure it
// returns the Connect error the caller should propagate.
func (s *AdminServer) requireAdmin(ctx context.Context) (uuid.UUID, error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return uuid.Nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	role, rok := sharedMw.UserRoleFromContext(ctx)
	if !rok || role != adminRole {
		return uuid.Nil, connect.NewError(connect.CodePermissionDenied, errors.New("admin role required"))
	}
	return uid, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Error mapping
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrConflict):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, domain.ErrInvalidInput):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("admin: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("admin failure"))
	}
}
