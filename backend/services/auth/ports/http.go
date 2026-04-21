package ports

import (
	"log/slog"

	"druz9/auth/app"
	"druz9/auth/domain"

	"github.com/go-playground/validator/v10"
)

// Handler owns the use-case dependencies + cookie config used by AuthServer.
// The legacy RegisterRoutes has been removed — routing is now driven by
// apigen.ServerInterface (see ports/server.go).
type Handler struct {
	LoginYandex   *app.LoginYandex
	LoginTelegram *app.LoginTelegram
	Refresh       *app.Refresh
	Logout        *app.Logout
	Issuer        *app.TokenIssuer
	Users         domain.UserRepo // reserved for direct lookups (e.g. /me)
	Log           *slog.Logger
	Validate      *validator.Validate

	// SecureCookies toggles the `Secure` attribute on the refresh cookie.
	// False in local dev, true everywhere else.
	SecureCookies bool
	// CookieDomain sets cookie domain scope; leave empty for host-only.
	CookieDomain string
}

// NewHandler wires dependencies and prepares a shared validator.
func NewHandler(h Handler) *Handler {
	if h.Validate == nil {
		h.Validate = validator.New()
	}
	return &h
}

// refreshCookieName is shared between login/refresh/logout.
const refreshCookieName = "druz9_refresh"
