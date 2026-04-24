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
	"context"
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
	return s.buildLoginResponse(res.User, res.Tokens, enums.AuthProviderYandex, res.IsNewUser), nil
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
	return s.buildLoginResponse(res.User, res.Tokens, enums.AuthProviderTelegram, res.IsNewUser), nil
}

// Refresh implements druz9.v1.AuthService/Refresh.
//
// The refresh token is read from either:
//   - HttpOnly cookie `druz9_refresh` (legacy / web flow), OR
//   - the X-Refresh-Token header (mobile / 3rd-party clients that can't
//     juggle cross-origin cookies).
//
// Refresh never returns IsNewUser=true (the user existed already), so the
// X-Is-New-User response header is omitted on this path.
func (s *AuthServer) Refresh(
	ctx context.Context,
	req *connect.Request[pb.RefreshRequest],
) (*connect.Response[pb.AuthResponse], error) {
	token := refreshTokenFromHeader(req.Header())
	if token == "" {
		if v, ok := readCookie(req.Header(), refreshCookieName); ok {
			token = v
		}
	}
	if token == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("missing refresh token"))
	}
	res, err := s.H.Refresh.Do(ctx, app.RefreshInput{
		RefreshToken: token,
		IP:           clientIPFromHeader(req.Header(), req.Peer().Addr),
		UserAgent:    req.Header().Get("User-Agent"),
	})
	if err != nil {
		return nil, fmt.Errorf("auth.Refresh: %w", s.toConnectErr(err))
	}
	// Refresh always operates on an existing user; isNewUser is irrelevant
	// here. Provider is currently not persisted on the session row, so we
	// default to Yandex for the AuthUser.provider claim — clients should
	// rely on the access-token claim, not this projection.
	return s.buildLoginResponse(res.User, res.Tokens, enums.AuthProviderYandex, false), nil
}

// Logout implements druz9.v1.AuthService/Logout.
//
// Best-effort: missing token → no-op (returns 200 + clears cookie). The same
// X-Refresh-Token fallback as Refresh is honoured so SPA clients that hold
// the token in localStorage (because cookies aren't viable for them) can
// still revoke their session server-side.
func (s *AuthServer) Logout(
	ctx context.Context,
	req *connect.Request[pb.LogoutRequest],
) (*connect.Response[pb.LogoutResponse], error) {
	token := refreshTokenFromHeader(req.Header())
	if token == "" {
		if v, ok := readCookie(req.Header(), refreshCookieName); ok {
			token = v
		}
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
//
// Beyond the proto fields, two HTTP response headers are emitted:
//   - Set-Cookie: druz9_refresh — HttpOnly cookie for browser flows.
//   - X-Refresh-Token            — for clients that cannot persist cookies
//     (cross-origin SPAs in environments without first-party cookie support,
//     mobile shells). The same opaque value as the cookie.
//   - X-Is-New-User: "1"|"0"     — surfaces the LoginYandex/LoginTelegram
//     IsNewUser flag without bumping proto. Frontend reads this to route
//     freshly-registered accounts to /onboarding.
func (s *AuthServer) buildLoginResponse(u domain.User, tp domain.TokenPair, provider enums.AuthProvider, isNewUser bool) *connect.Response[pb.AuthResponse] {
	out := &pb.AuthResponse{
		AccessToken: tp.AccessToken,
		ExpiresIn:   int32(tp.AccessExpiresIn),
		User:        toAuthUser(u, provider),
	}
	resp := connect.NewResponse(out)
	resp.Header().Add("Set-Cookie", s.setRefreshCookieString(tp.RefreshToken, tp.RefreshExpires))
	resp.Header().Set("X-Refresh-Token", tp.RefreshToken)
	if isNewUser {
		resp.Header().Set("X-Is-New-User", "1")
	} else {
		resp.Header().Set("X-Is-New-User", "0")
	}
	return resp
}

// refreshTokenFromHeader pulls the refresh token from the X-Refresh-Token
// header (or Authorization: Bearer <opaque> when X-Refresh-Token is absent).
// Returns "" when neither carries a value.
func refreshTokenFromHeader(h http.Header) string {
	if v := strings.TrimSpace(h.Get("X-Refresh-Token")); v != "" {
		return v
	}
	if auth := strings.TrimSpace(h.Get("X-Refresh-Authorization")); auth != "" {
		const prefix = "Bearer "
		if strings.HasPrefix(auth, prefix) {
			return strings.TrimSpace(auth[len(prefix):])
		}
	}
	return ""
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
	case errors.Is(err, app.ErrInvalidState):
		// CSRF-защита: state не совпал / истёк / повторно использован →
		// 400 InvalidArgument. Юзер должен начать OAuth-flow заново.
		return connect.NewError(connect.CodeInvalidArgument, err)
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
