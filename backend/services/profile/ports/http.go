package ports

import (
	"context"
	"log/slog"

	"druz9/profile/app"
	"druz9/profile/domain"

	"github.com/google/uuid"
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
	// ReportFetcher — необязательный опитимизирующий wrapper (Redis-cache).
	// Если nil, GetMyReport вызывает GetReport напрямую. В проде wired в
	// cmd/monolith/services/profile.go.
	ReportFetcher ReportFetcher
	// Repo — прямой доступ к репозиторию для путей, где use case ещё не
	// выделен (Issue/ResolveShareToken). Может быть nil в тестах, тогда
	// share-эндпоинты вернут Internal/Unavailable.
	Repo domain.ProfileRepo
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
