package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/auth/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
)

// YandexOAuthClient abstracts the Yandex OAuth HTTP dance. The concrete
// implementation lives in infra.
type YandexOAuthClient interface {
	// Exchange swaps an authorization code for access/refresh tokens.
	// `codeVerifier` — тот же случайный verifier, для которого перед редиректом
	// на Yandex был сформирован code_challenge (PKCE, RFC 7636). Если он пуст,
	// PKCE-поле не отправляется (для обратной совместимости с flow без PKCE).
	Exchange(ctx context.Context, code, codeVerifier string) (YandexTokenResponse, error)
	// FetchUserInfo pulls the user profile using a live access token.
	FetchUserInfo(ctx context.Context, accessToken string) (domain.YandexUserInfo, error)
}

// YandexTokenResponse is the subset of Yandex's /token response we care about.
type YandexTokenResponse struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
}

// TokenEncryptor opaquely encrypts OAuth token blobs at rest (bible §11 rule:
// AES-256-GCM with a static key from ENCRYPTION_KEY). infra supplies the impl.
type TokenEncryptor interface {
	Encrypt(plaintext []byte) ([]byte, error)
}

// LoginYandex is the use case for POST /auth/yandex.
type LoginYandex struct {
	OAuth    YandexOAuthClient
	Users    domain.UserRepo
	Sessions domain.SessionRepo
	Limiter  domain.RateLimiter
	Bus      sharedDomain.Bus
	Issuer   *TokenIssuer
	Enc      TokenEncryptor
	// States хранит одноразовые OAuth-state (анти-CSRF) и связанный с ним
	// PKCE code_verifier. Заполняется в StartLoginYandex, потребляется здесь.
	States     domain.OAuthStateStore
	RefreshTTL time.Duration
	Log        *slog.Logger
}

// LoginYandexInput is what the HTTP handler passes in.
type LoginYandexInput struct {
	Code      string
	State     string
	IP        string
	UserAgent string
}

// LoginYandexResult is what the HTTP handler returns to the client.
type LoginYandexResult struct {
	Tokens    domain.TokenPair
	User      domain.User
	IsNewUser bool // true когда мы вставили новую запись в users, иначе UPDATE
}

// Do runs the full Yandex OAuth flow: rate limit → validate state → exchange
// code → fetch profile → upsert user → issue tokens → publish event.
// Errors are wrapped with context.
func (uc *LoginYandex) Do(ctx context.Context, in LoginYandexInput) (LoginYandexResult, error) {
	// 1. Rate limit per IP (10/min per bible §11).
	if _, retry, err := uc.Limiter.Allow(ctx, "rl:auth:yandex:"+in.IP, 10, time.Minute); err != nil {
		if isRateLimited(err) {
			return LoginYandexResult{}, rateLimitedErr(retry)
		}
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: rate limit: %w", err)
	}

	// 2. Валидация CSRF-state: атомарно потребляем его из store и достаём
	// привязанный к нему code_verifier для PKCE. Отсутствие ключа — жёсткий
	// отказ (CSRF / replay / истёкший state); НИКАКОГО silent-fallback.
	if in.State == "" {
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: empty state: %w", ErrInvalidState)
	}
	verifier, err := uc.States.ConsumeState(ctx, in.State)
	if err != nil {
		if errors.Is(err, domain.ErrStateNotFound) {
			return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: consume state: %w", ErrInvalidState)
		}
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: consume state: %w", err)
	}

	// 3. Exchange code for tokens (с PKCE code_verifier).
	toks, err := uc.OAuth.Exchange(ctx, in.Code, verifier)
	if err != nil {
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: exchange code: %w", err)
	}

	// 3. Fetch user profile.
	info, err := uc.OAuth.FetchUserInfo(ctx, toks.AccessToken)
	if err != nil {
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: fetch user info: %w", err)
	}

	// 4. Encrypt tokens before handing to repo.
	accessEnc, err := uc.Enc.Encrypt([]byte(toks.AccessToken))
	if err != nil {
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: encrypt access: %w", err)
	}
	refreshEnc, err := uc.Enc.Encrypt([]byte(toks.RefreshToken))
	if err != nil {
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: encrypt refresh: %w", err)
	}
	var expiresAt *time.Time
	if toks.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(toks.ExpiresIn) * time.Second)
		expiresAt = &t
	}

	// 5. Upsert user + oauth_account.
	user, created, err := uc.Users.UpsertByOAuth(ctx, domain.UpsertOAuthInput{
		Provider:        enums.AuthProviderYandex,
		ProviderUserID:  info.ID,
		Email:           info.DefaultEmail,
		UsernameHint:    domain.NormaliseUsername(info.Login),
		DisplayName:     info.DisplayName,
		AvatarURL:       domain.YandexAvatarURL(info),
		AccessTokenEnc:  accessEnc,
		RefreshTokenEnc: refreshEnc,
		TokenExpiresAt:  expiresAt,
	})
	if err != nil {
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: upsert user: %w", err)
	}

	// 6. Issue our own tokens.
	pair, err := BuildTokenPair(ctx, uc.Issuer, uc.Sessions, user, enums.AuthProviderYandex, uc.RefreshTTL, in.UserAgent, in.IP)
	if err != nil {
		return LoginYandexResult{}, fmt.Errorf("auth.LoginYandex: build tokens: %w", err)
	}

	// 7. Publish the right event.
	if err := publishLoginEvent(ctx, uc.Bus, user, enums.AuthProviderYandex, created); err != nil {
		// Non-fatal: log and continue so the user still gets logged in.
		uc.Log.WarnContext(ctx, "auth.LoginYandex: publish event", slog.Any("err", err))
	}

	return LoginYandexResult{Tokens: pair, User: user, IsNewUser: created}, nil
}

func publishLoginEvent(ctx context.Context, bus sharedDomain.Bus, user domain.User, p enums.AuthProvider, created bool) error {
	// `base.At` is package-private in shared/domain — events published from
	// outside carry a zero OccurredAt. The in-process bus does not depend on
	// this field; when migrating to NATS the bus adapter will stamp its own.
	var ev sharedDomain.Event
	if created {
		ev = sharedDomain.UserRegistered{
			UserID:   user.ID,
			Username: user.Username,
			Email:    user.Email,
			Provider: p,
		}
	} else {
		ev = sharedDomain.UserLoggedIn{
			UserID:   user.ID,
			Provider: p,
		}
	}
	if err := bus.Publish(ctx, ev); err != nil {
		return fmt.Errorf("publish %s: %w", ev.Topic(), err)
	}
	return nil
}
