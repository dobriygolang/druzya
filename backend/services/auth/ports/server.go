// Package ports exposes the auth domain via Connect-RPC.
//
// AuthServer implements druz9v1connect.AuthServiceHandler (generated from
// proto/druz9/v1/auth.proto). It is mounted in main.go via
// NewAuthServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.AuthService/*) and the REST paths declared
// via google.api.http annotations (/api/v1/auth/*).
//
// Three of the four RPCs bypass bearer auth (yandex/telegram/refresh) — the
// REST carve-out in main.go handles that for /api/v1/auth/* paths and the
// native Connect path is mounted without requireAuth either. Logout does
// NOT rely on bearer auth — it reads the refresh cookie, deletes the session
// row, and clears the cookie; unauthenticated calls are no-ops.
package ports

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/auth/app"
	"druz9/auth/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"connectrpc.com/connect"
	"context"
)

// Compile-time assertion — AuthServer satisfies the generated handler.
var _ druz9v1connect.AuthServiceHandler = (*AuthServer)(nil)

// AuthServer adapts the auth Handler (use cases + cookie config) to Connect.
type AuthServer struct {
	H *Handler
}

// NewAuthServer wires an AuthServer around the provided Handler.
func NewAuthServer(h *Handler) *AuthServer { return &AuthServer{H: h} }

// LoginYandex implements druz9.v1.AuthService/LoginYandex.
func (s *AuthServer) LoginYandex(
	ctx context.Context,
	req *connect.Request[pb.YandexLoginRequest],
) (*connect.Response[pb.AuthResponse], error) {
	m := req.Msg
	if m.GetCode() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("code is required"))
	}
	res, err := s.H.LoginYandex.Do(ctx, app.LoginYandexInput{
		Code:      m.GetCode(),
		State:     m.GetState(),
		IP:        clientIPFromHeader(req.Header(), req.Peer().Addr),
		UserAgent: req.Header().Get("User-Agent"),
	})
	if err != nil {
		return nil, fmt.Errorf("auth.LoginYandex: %w", s.toConnectErr(err))
	}
	return s.buildLoginResponse(res.User, res.Tokens, enums.AuthProviderYandex), nil
}

// LoginTelegram implements druz9.v1.AuthService/LoginTelegram.
func (s *AuthServer) LoginTelegram(
	ctx context.Context,
	req *connect.Request[pb.TelegramLoginRequest],
) (*connect.Response[pb.AuthResponse], error) {
	m := req.Msg
	if m.GetHash() == "" || m.GetAuthDate() == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("hash and auth_date are required"))
	}
	res, err := s.H.LoginTelegram.Do(ctx, app.LoginTelegramInput{
		ID:        m.GetId(),
		FirstName: m.GetFirstName(),
		LastName:  m.GetLastName(),
		Username:  m.GetUsername(),
		PhotoURL:  m.GetPhotoUrl(),
		AuthDate:  m.GetAuthDate(),
		Hash:      m.GetHash(),
		IP:        clientIPFromHeader(req.Header(), req.Peer().Addr),
		UserAgent: req.Header().Get("User-Agent"),
	})
	if err != nil {
		return nil, fmt.Errorf("auth.LoginTelegram: %w", s.toConnectErr(err))
	}
	return s.buildLoginResponse(res.User, res.Tokens, enums.AuthProviderTelegram), nil
}

// Refresh implements druz9.v1.AuthService/Refresh.
func (s *AuthServer) Refresh(
	ctx context.Context,
	req *connect.Request[pb.RefreshRequest],
) (*connect.Response[pb.AuthResponse], error) {
	token, ok := readCookie(req.Header(), refreshCookieName)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("missing refresh cookie"))
	}
	res, err := s.H.Refresh.Do(ctx, app.RefreshInput{
		RefreshToken: token,
		IP:           clientIPFromHeader(req.Header(), req.Peer().Addr),
		UserAgent:    req.Header().Get("User-Agent"),
	})
	if err != nil {
		return nil, fmt.Errorf("auth.Refresh: %w", s.toConnectErr(err))
	}
	// STUB: persist provider on the session so Refresh can restore it.
	return s.buildLoginResponse(res.User, res.Tokens, enums.AuthProviderYandex), nil
}

// Logout implements druz9.v1.AuthService/Logout.
func (s *AuthServer) Logout(
	ctx context.Context,
	req *connect.Request[pb.LogoutRequest],
) (*connect.Response[pb.LogoutResponse], error) {
	var token string
	if v, ok := readCookie(req.Header(), refreshCookieName); ok {
		token = v
	}
	if err := s.H.Logout.Do(ctx, token); err != nil {
		s.H.Log.WarnContext(ctx, "auth.Logout", slog.Any("err", err))
	}
	resp := connect.NewResponse(&pb.LogoutResponse{})
	resp.Header().Add("Set-Cookie", s.clearRefreshCookieString())
	return resp, nil
}

// ── helpers ────────────────────────────────────────────────────────────────

// buildLoginResponse wraps the shared "set cookie + serialize AuthResponse"
// dance used by the three login RPCs.
func (s *AuthServer) buildLoginResponse(u domain.User, tp domain.TokenPair, provider enums.AuthProvider) *connect.Response[pb.AuthResponse] {
	out := &pb.AuthResponse{
		AccessToken: tp.AccessToken,
		ExpiresIn:   int32(tp.AccessExpiresIn),
		User:        toAuthUser(u, provider),
	}
	resp := connect.NewResponse(out)
	resp.Header().Add("Set-Cookie", s.setRefreshCookieString(tp.RefreshToken, tp.RefreshExpires))
	return resp
}

// setRefreshCookieString mirrors Handler.setRefreshCookie but returns the raw
// Set-Cookie value so Connect can attach it via response headers (Connect has
// no http.ResponseWriter exposed inside the handler body).
func (s *AuthServer) setRefreshCookieString(value string, expires time.Time) string {
	c := &http.Cookie{
		Name:     refreshCookieName,
		Value:    value,
		Path:     "/api/v1/auth",
		Domain:   s.H.CookieDomain,
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   s.H.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
	return c.String()
}

func (s *AuthServer) clearRefreshCookieString() string {
	c := &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		Domain:   s.H.CookieDomain,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.H.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	}
	return c.String()
}

// readCookie extracts a cookie by name from raw request headers. Connect
// handlers do not receive a *http.Request so we have to parse the Cookie
// header ourselves.
func readCookie(h http.Header, name string) (string, bool) {
	// net/http provides (&http.Request{Header: h}).Cookie(name) for exactly
	// this situation — reuse it to keep behaviour identical to REST.
	r := &http.Request{Header: h}
	c, err := r.Cookie(name)
	if err != nil {
		return "", false
	}
	return c.Value, true
}

// clientIPFromHeader mirrors the REST clientIP() helper but works on raw
// headers. `fallback` is the Connect-reported peer address (often RemoteAddr).
func clientIPFromHeader(h http.Header, fallback string) string {
	if xff := h.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if xr := h.Get("X-Real-IP"); xr != "" {
		return xr
	}
	return fallback
}

// toConnectErr maps auth errors onto Connect codes. Bearer-auth is not used
// by these RPCs, so we never return CodeUnauthenticated for missing user ctx
// (logout silently no-ops). CodeUnauthenticated is reserved for bad creds.
func (s *AuthServer) toConnectErr(err error) error {
	var rl *app.RateLimitedError
	switch {
	case errors.As(err, &rl):
		e := connect.NewError(connect.CodeResourceExhausted, err)
		e.Meta().Set("Retry-After", fmt.Sprintf("%d", rl.RetryAfterSec))
		return e
	case errors.Is(err, app.ErrInvalidToken),
		errors.Is(err, domain.ErrInvalidTelegramHash),
		errors.Is(err, domain.ErrTelegramAuthExpired):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeUnauthenticated, err)
	default:
		s.H.Log.Error("auth: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("auth failure"))
	}
}

func toAuthUser(u domain.User, provider enums.AuthProvider) *pb.AuthUser {
	return &pb.AuthUser{
		Id:       u.ID.String(),
		Email:    u.Email,
		Username: u.Username,
		Role:     userRoleToProto(u.Role),
		Provider: authProviderToProto(provider),
	}
}

// ── common enum adapters ───────────────────────────────────────────────────

func userRoleToProto(r enums.UserRole) pb.UserRole {
	switch r {
	case enums.UserRoleUser:
		return pb.UserRole_USER_ROLE_USER
	case enums.UserRoleInterviewer:
		return pb.UserRole_USER_ROLE_INTERVIEWER
	case enums.UserRoleAdmin:
		return pb.UserRole_USER_ROLE_ADMIN
	default:
		return pb.UserRole_USER_ROLE_UNSPECIFIED
	}
}

func authProviderToProto(p enums.AuthProvider) pb.AuthProvider {
	switch p {
	case enums.AuthProviderYandex:
		return pb.AuthProvider_AUTH_PROVIDER_YANDEX
	case enums.AuthProviderTelegram:
		return pb.AuthProvider_AUTH_PROVIDER_TELEGRAM
	default:
		return pb.AuthProvider_AUTH_PROVIDER_UNSPECIFIED
	}
}
