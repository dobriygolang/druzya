package ports

import (
	"log/slog"

	"druz9/daily/app"

	"github.com/go-playground/validator/v10"
)

// Handler owns the daily use-case pointers. RequireAuth wrapping happens at
// the composite-server level in cmd/monolith; this struct is used by
// DailyServer (see ports/server.go) which implements apigen.ServerInterface.
type Handler struct {
	GetKata        *app.GetKata
	SubmitKata     *app.SubmitKata
	GetStreak      *app.GetStreak
	GetCalendar    *app.GetCalendar
	UpsertCalendar *app.UpsertCalendar
	CreateAutopsy  *app.CreateAutopsy
	GetAutopsy     *app.GetAutopsy
	Log            *slog.Logger
	Validate       *validator.Validate
}

// NewHandler builds the Handler.
func NewHandler(h Handler) *Handler {
	if h.Validate == nil {
		h.Validate = validator.New()
	}
	return &h
}
