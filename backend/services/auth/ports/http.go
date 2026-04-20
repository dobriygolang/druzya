package ports

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

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

// setRefreshCookie writes the long-lived refresh cookie with sane defaults.
func (h *Handler) setRefreshCookie(w http.ResponseWriter, value string, expires time.Time) {
	cookie := &http.Cookie{
		Name:     refreshCookieName,
		Value:    value,
		Path:     "/api/v1/auth",
		Domain:   h.CookieDomain,
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   h.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
	http.SetCookie(w, cookie)
}

func (h *Handler) clearRefreshCookie(w http.ResponseWriter) {
	cookie := &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		Domain:   h.CookieDomain,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
	http.SetCookie(w, cookie)
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if xr := r.Header.Get("X-Real-IP"); xr != "" {
		return xr
	}
	return r.RemoteAddr
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
