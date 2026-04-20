package ports

import (
	"log/slog"

	"druz9/profile/app"
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
	Log            *slog.Logger
}

// NewHandler builds the Handler.
func NewHandler(h Handler) *Handler { return &h }
