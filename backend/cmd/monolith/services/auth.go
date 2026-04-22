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
	Sessions    *authInfra.RedisSessions
	RefreshTTL  time.Duration
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
	issuer := authApp.NewTokenIssuer(d.Cfg.Auth.JWTSecret, time.Duration(d.Cfg.Auth.AccessTokenTTL)*time.Second)

	loginYandex := &authApp.LoginYandex{
		OAuth: yandex, Users: pg, Sessions: sessions, Limiter: limiter,
		Bus: d.Bus, Issuer: issuer, Enc: encryptor,
		RefreshTTL: time.Duration(d.Cfg.Auth.RefreshTokenTTL) * time.Second,
		Log:        d.Log,
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
			},
		},
		Issuer:      issuer,
		RequireAuth: authPorts.RequireAuth(issuer),
		Users:       pg,
		Sessions:    sessions,
		RefreshTTL:  time.Duration(d.Cfg.Auth.RefreshTokenTTL) * time.Second,
	}, nil
}
