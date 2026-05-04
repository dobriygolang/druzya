// Package app — dev_login.go
//
// DevLogin — INSECURE bypass auth-flow только для local development. Enable
// флагом env DEV_AUTH=true (см cmd/monolith bootstrap). По username создаёт
// (или upsert'ит) seed-юзера через тот же UpsertByOAuth канал что telegram-
// flow, выдаёт TokenPair. Никаких HMAC, никаких codes, никаких bot'ов.
//
// CRITICAL: handler ports/dev_login.go ОБЯЗАН проверить env-gate перед
// вызовом этого use case. Production deployment с DEV_AUTH=true = угон
// всех аккаунтов через одно имя.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/auth/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
)

type DevLogin struct {
	Users      domain.UserRepo
	Sessions   domain.SessionRepo
	Bus        sharedDomain.Bus
	Issuer     *TokenIssuer
	RefreshTTL time.Duration
	Log        *slog.Logger
}

type DevLoginInput struct {
	Username  string // local-only seed identity (e.g. "sergey", "alice")
	IP        string
	UserAgent string
}

type DevLoginResult struct {
	Tokens    domain.TokenPair
	User      domain.User
	IsNewUser bool
}

func (uc *DevLogin) Do(ctx context.Context, in DevLoginInput) (DevLoginResult, error) {
	username := domain.NormaliseUsername(strings.TrimSpace(in.Username))
	if username == "" {
		return DevLoginResult{}, fmt.Errorf("auth.DevLogin: username required")
	}
	// Synthetic provider_user_id чтобы не пересекаться с реальными TG-id'ами.
	// Префикс 'dev:' гарантирует уникальность относительно
	// strconv.FormatInt(payload.ID, 10) которые числовые.
	user, created, err := uc.Users.UpsertByOAuth(ctx, domain.UpsertOAuthInput{
		Provider:       enums.AuthProviderTelegram,
		ProviderUserID: "dev:" + username,
		UsernameHint:   username,
		DisplayName:    username,
	})
	if err != nil {
		return DevLoginResult{}, fmt.Errorf("auth.DevLogin: upsert: %w", err)
	}
	pair, err := BuildTokenPair(ctx, uc.Issuer, uc.Sessions, user,
		enums.AuthProviderTelegram, uc.RefreshTTL, in.UserAgent, in.IP)
	if err != nil {
		return DevLoginResult{}, fmt.Errorf("auth.DevLogin: tokens: %w", err)
	}
	if err := publishLoginEvent(ctx, uc.Bus, user, enums.AuthProviderTelegram, created); err != nil && uc.Log != nil {
		uc.Log.WarnContext(ctx, "auth.DevLogin: publish event", slog.Any("err", err))
	}
	if uc.Log != nil {
		uc.Log.WarnContext(ctx, "auth.DevLogin: INSECURE bypass auth issued",
			slog.String("username", username),
			slog.String("user_id", user.ID.String()),
			slog.Bool("created", created))
	}
	return DevLoginResult{Tokens: pair, User: user, IsNewUser: created}, nil
}
