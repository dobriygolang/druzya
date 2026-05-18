package ports

import (
	"context"
	"log/slog"

	"druz9/profile/app"
	"druz9/profile/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler owns the profile use-case pointers. RequireAuth wrapping happens at
// the composite-server level in cmd/monolith; this struct is used by
// ProfileServer (see ports/server.go) which implements apigen.ServerInterface.
type Handler struct {
	GetProfile     *app.GetProfile
	GetPublic      *app.GetPublic
	GetAtlas       *app.GetAtlas
	GetReport      *app.GetReport
	GetSettings    *app.GetSettings // reserved for a future GET /me/settings
	UpdateSettings *app.UpdateSettings
	BecomeUC       *app.BecomeInterviewer
	GetMyAppUC     *app.GetMyInterviewerApplication
	ListAppsUC     *app.ListInterviewerApplications
	ApproveAppUC   *app.ApproveInterviewerApplication
	RejectAppUC    *app.RejectInterviewerApplication
	// AllocateAtlas powers the atlas/allocate RPC migrated off chi.
	AllocateAtlas *app.AllocateAtlasNode
	// ClassifyAtlasTodo — user-driven atlas через free-form TODO.
	// nil-safe: handler возвращает Unavailable, фронт прячет UI.
	ClassifyAtlasTodo *app.ClassifyAtlasTodo
	// Multi-track use cases (см docs/feature/tracks.md). Wired in
	// cmd/monolith/services/profile.go alongside the rest of the
	// profile UCs.
	GetUserTracks *app.GetUserTracks
	SetUserTracks *app.SetUserTracks
	// Single onboarding funnel.
	RecordAppInstall *app.RecordAppInstall
	GetInstalledApps *app.GetInstalledApps
	// ReportFetcher — необязательный опитимизирующий wrapper (Redis-cache).
	// Если nil, GetMyReport вызывает GetReport напрямую. В проде wired в
	// cmd/monolith/services/profile.go.
	ReportFetcher ReportFetcher
	// Repo — прямой доступ к репозиторию для путей, где use case ещё не
	// выделен (Issue/ResolveShareToken). Может быть nil в тестах, тогда
	// share-эндпоинты вернут Internal/Unavailable.
	Repo domain.ProfileRepo
	// Pool — atlas pin/hide handler делает direct INSERT...ON CONFLICT в
	// user_atlas_node_prefs. Trivial CRUD, без UC.
	Pool *pgxpool.Pool
	Log  *slog.Logger
}

// ReportFetcher — узкий интерфейс, который ports.GetMyReport использует
// вместо прямого вызова GetReport. Позволяет вкрутить infra.ReportCache,
// не таща import цикл infra→ports→app→infra.
type ReportFetcher interface {
	Get(ctx context.Context, userID uuid.UUID) (app.ReportView, error)
}

// NewHandler builds the Handler.
func NewHandler(h Handler) *Handler { return &h }
