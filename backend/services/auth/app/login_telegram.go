package app

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"druz9/auth/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
)

// LoginTelegram is the use case for POST /auth/telegram. It verifies the
// HMAC-SHA256 payload against the bot token and then upserts a user.
type LoginTelegram struct {
	BotToken   string
	Users      domain.UserRepo
	Sessions   domain.SessionRepo
	Limiter    domain.RateLimiter
	Bus        sharedDomain.Bus
	Issuer     *TokenIssuer
	RefreshTTL time.Duration
	Log        *slog.Logger
	Now        func() time.Time // injectable for tests
}

// LoginTelegramInput mirrors the openapi TelegramAuthRequest schema.
type LoginTelegramInput struct {
	ID        int64
	FirstName string
	LastName  string
	Username  string
	PhotoURL  string
	AuthDate  int64
	Hash      string
	IP        string
	UserAgent string
}

// LoginTelegramResult is passed back to the HTTP layer.
type LoginTelegramResult struct {
	Tokens domain.TokenPair
	User   domain.User
}

// Do verifies HMAC → upserts user → mints tokens → publishes event.
func (uc *LoginTelegram) Do(ctx context.Context, in LoginTelegramInput) (LoginTelegramResult, error) {
	if _, retry, err := uc.Limiter.Allow(ctx, "rl:auth:telegram:"+in.IP, 10, time.Minute); err != nil {
		if isRateLimited(err) {
			return LoginTelegramResult{}, rateLimitedErr(retry)
		}
		return LoginTelegramResult{}, fmt.Errorf("auth.LoginTelegram: rate limit: %w", err)
	}

	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now()
	}
	payload := domain.TelegramPayload{
		ID:        in.ID,
		FirstName: in.FirstName,
		LastName:  in.LastName,
		Username:  in.Username,
		PhotoURL:  in.PhotoURL,
		AuthDate:  in.AuthDate,
		Hash:      in.Hash,
	}
	prof, err := domain.VerifyTelegramHash(payload, uc.BotToken, now)
	if err != nil {
		return LoginTelegramResult{}, fmt.Errorf("auth.LoginTelegram: verify hash: %w", err)
	}

	usernameHint := domain.NormaliseUsername(prof.Username)
	if usernameHint == "" {
		// Fallback: tg_<telegram_id> so we always have something.
		usernameHint = "tg_" + strconv.FormatInt(prof.ID, 10)
	}
	display := strings.TrimSpace(prof.FirstName + " " + prof.LastName)

	user, created, err := uc.Users.UpsertByOAuth(ctx, domain.UpsertOAuthInput{
		Provider:       enums.AuthProviderTelegram,
		ProviderUserID: strconv.FormatInt(prof.ID, 10),
		Email:          "", // Telegram never exposes email.
		UsernameHint:   usernameHint,
		DisplayName:    display,
	})
	if err != nil {
		return LoginTelegramResult{}, fmt.Errorf("auth.LoginTelegram: upsert user: %w", err)
	}

	pair, err := BuildTokenPair(ctx, uc.Issuer, uc.Sessions, user, enums.AuthProviderTelegram, uc.RefreshTTL, in.UserAgent, in.IP)
	if err != nil {
		return LoginTelegramResult{}, fmt.Errorf("auth.LoginTelegram: build tokens: %w", err)
	}

	if err := publishLoginEvent(ctx, uc.Bus, user, enums.AuthProviderTelegram, created); err != nil {
		uc.Log.WarnContext(ctx, "auth.LoginTelegram: publish event", slog.Any("err", err))
	}

	return LoginTelegramResult{Tokens: pair, User: user}, nil
}
