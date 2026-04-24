package services

import (
	"fmt"
	"net/http"
	"time"

	authApp "druz9/auth/app"
	authInfra "druz9/auth/infra"
	authPorts "druz9/auth/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"

	"github.com/go-chi/chi/v5"
)

// AuthModule bundles the auth-domain Module with its public auth primitives
// (token issuer, requireAuth middleware, repo) so other domains can reuse
// them without re-importing the auth wiring.
type AuthModule struct {
	Module
	Issuer      *authApp.TokenIssuer
	RequireAuth func(http.Handler) http.Handler
	Users       *authInfra.Postgres
	// Sessions and RefreshTTL are exported because they used to be reused by
	// the now-deleted email/password auth module. They are kept on the public
	// surface so a future integration (e.g. an admin "force logout" tool, or
	// a reintroduced credential flow behind a feature flag) can wire them
	// without re-piercing the auth bounded context.
	Sessions   *authInfra.RedisSessions
	RefreshTTL time.Duration
	// TelegramCodes is the Redis-backed deep-link code repo. Wired into the
	// Notify bot via SetCodeFiller after both modules are constructed.
	TelegramCodes *authInfra.RedisTelegramCodeRepo
	// CodeFlow is the chi-mountable handler for /auth/telegram/{start,poll}.
	CodeFlow *authPorts.CodeFlowHandler
}

// NewAuth wires the auth bounded context. ENCRYPTION_KEY MUST be set —
// the OAuth refresh tokens are encrypted at rest with AES-GCM.
func NewAuth(d Deps, encKey string) (*AuthModule, error) {
	if encKey == "" {
		return nil, fmt.Errorf("ENCRYPTION_KEY env is required for OAuth token encryption")
	}
	encryptor, err := authInfra.NewAESGCMEncryptor(encKey)
	if err != nil {
		return nil, fmt.Errorf("encryptor: %w", err)
	}

	pg := authInfra.NewPostgres(d.Pool)
	sessions := authInfra.NewRedisSessions(d.Redis, time.Duration(d.Cfg.Auth.RefreshTokenTTL)*time.Second)
	limiter := authInfra.NewRedisRateLimiter(d.Redis)
	yandex := authInfra.NewYandexOAuth(d.Cfg.Auth.YandexClientID, d.Cfg.Auth.YandexSecret)
	// OAuth-state store — связка {state → code_verifier} для CSRF+PKCE.
	oauthStates := authInfra.NewRedisOAuthStateStore(d.Redis)
	issuer := authApp.NewTokenIssuer(d.Cfg.Auth.JWTSecret, time.Duration(d.Cfg.Auth.AccessTokenTTL)*time.Second)
	codeTTL := time.Duration(d.Cfg.Auth.TelegramCodeTTL) * time.Second
	if codeTTL == 0 {
		codeTTL = 5 * time.Minute
	}
	codes := authInfra.NewRedisTelegramCodeRepo(d.Redis, codeTTL)
	startCode := &authApp.StartTelegramCode{
		Codes:   codes,
		Limiter: limiter,
		BotName: d.Cfg.Auth.TelegramBotName,
		CodeTTL: codeTTL,
		Log:     d.Log,
	}
	pollCode := &authApp.PollTelegramCode{
		Codes:      codes,
		Users:      pg,
		Sessions:   sessions,
		Limiter:    limiter,
		Bus:        d.Bus,
		Issuer:     issuer,
		RefreshTTL: time.Duration(d.Cfg.Auth.RefreshTokenTTL) * time.Second,
		Log:        d.Log,
	}

	loginYandex := &authApp.LoginYandex{
		OAuth: yandex, Users: pg, Sessions: sessions, Limiter: limiter,
		Bus: d.Bus, Issuer: issuer, Enc: encryptor,
		States:     oauthStates,
		RefreshTTL: time.Duration(d.Cfg.Auth.RefreshTokenTTL) * time.Second,
		Log:        d.Log,
	}
	startYandex := &authApp.StartLoginYandex{
		ClientID: d.Cfg.Auth.YandexClientID,
		States:   oauthStates,
		Limiter:  limiter,
		TTL:      authApp.StateTTL,
		Log:      d.Log,
	}
	loginTelegram := &authApp.LoginTelegram{
		BotToken: d.Cfg.Auth.TelegramBotToken,
		Users:    pg, Sessions: sessions, Limiter: limiter,
		Bus: d.Bus, Issuer: issuer,
		RefreshTTL: time.Duration(d.Cfg.Auth.RefreshTokenTTL) * time.Second,
		Log:        d.Log,
	}
	refresh := &authApp.Refresh{
		Users: pg, Sessions: sessions, Issuer: issuer,
		RefreshTTL: time.Duration(d.Cfg.Auth.RefreshTokenTTL) * time.Second,
	}
	logout := &authApp.Logout{Sessions: sessions}
	h := authPorts.NewHandler(authPorts.Handler{
		LoginYandex: loginYandex, LoginTelegram: loginTelegram,
		Refresh: refresh, Logout: logout,
		Issuer: issuer, Users: pg, Log: d.Log,
		SecureCookies: d.Cfg.Env != "local", CookieDomain: "",
	})
	server := authPorts.NewAuthServer(h)
	codeFlow := authPorts.NewCodeFlowHandler(startCode, pollCode, server, d.Log)
	yandexStart := authPorts.NewYandexStartHandler(startYandex, d.Log)

	connectPath, connectHandler := druz9v1connect.NewAuthServiceHandler(server)
	transcoder := mustTranscode("auth", connectPath, connectHandler)

	return &AuthModule{
		Module: Module{
			ConnectPath:        connectPath,
			ConnectHandler:     transcoder,
			RequireConnectAuth: false, // login RPCs cannot require bearer
			MountREST: func(r chi.Router) {
				r.Post("/auth/yandex", transcoder.ServeHTTP)
				r.Post("/auth/telegram", transcoder.ServeHTTP)
				r.Post("/auth/refresh", transcoder.ServeHTTP)
				r.Delete("/auth/logout", transcoder.ServeHTTP)
				// Deep-link code flow: plain chi handlers (not Connect-RPC).
				// See backend/services/auth/ports/code_flow.go for shapes.
				r.Post("/auth/telegram/start", codeFlow.HandleStart)
				r.Post("/auth/telegram/poll", codeFlow.HandlePoll)
				// Yandex OAuth start — выдаёт authorize-URL с server-side
				// сгенерированными state+PKCE challenge.
				r.Post("/auth/yandex/start", yandexStart.ServeHTTP)
			},
		},
		Issuer:        issuer,
		RequireAuth:   authPorts.RequireAuth(issuer),
		Users:         pg,
		Sessions:      sessions,
		RefreshTTL:    time.Duration(d.Cfg.Auth.RefreshTokenTTL) * time.Second,
		TelegramCodes: codes,
		CodeFlow:      codeFlow,
	}, nil
}
