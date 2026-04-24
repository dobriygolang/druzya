package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"druz9/auth/domain"
)

// StateTTL — время жизни OAuth-state и связанного code_verifier.
// 10 минут даёт запас даже на медленный редирект-флоу от Yandex (включая
// 2FA), при этом коротко enough чтобы минимизировать окно для CSRF-replay.
const StateTTL = 10 * time.Minute

// StartLoginYandex — use case для POST /api/v1/auth/yandex/start.
// Генерирует одноразовые CSRF-state и PKCE code_verifier/code_challenge,
// сохраняет пару в store и возвращает готовый authorize-URL для Yandex.
type StartLoginYandex struct {
	// ClientID — Yandex OAuth client_id (не секрет).
	ClientID string
	// AuthorizeURL — базовый URL /authorize. Оставлен параметром чтобы тесты
	// могли подменить его, а в prod подтягивался из config.
	AuthorizeURL string
	States       domain.OAuthStateStore
	Limiter      domain.RateLimiter
	TTL          time.Duration
	Log          *slog.Logger
}

// StartLoginYandexInput — данные запроса (только IP для rate-limit).
type StartLoginYandexInput struct {
	// RedirectURI — куда Yandex вернёт пользователя с кодом. Приходит с
	// фронта (зависит от окружения: local/stage/prod) и прокидывается в URL.
	RedirectURI string
	IP          string
}

// StartLoginYandexResult содержит authorize-URL + echo'd state (пригодится
// фронту для логов/диагностики, но primary source of truth — Redis).
type StartLoginYandexResult struct {
	AuthorizeURL string
	State        string
	ExpiresAt    time.Time
}

// Do создаёт state+verifier+challenge, сохраняет пару и собирает authorize-URL.
func (uc *StartLoginYandex) Do(ctx context.Context, in StartLoginYandexInput) (StartLoginYandexResult, error) {
	if uc.ClientID == "" {
		return StartLoginYandexResult{}, fmt.Errorf("auth.StartLoginYandex: yandex client_id not configured")
	}
	if uc.AuthorizeURL == "" {
		uc.AuthorizeURL = "https://oauth.yandex.ru/authorize"
	}
	ttl := uc.TTL
	if ttl <= 0 {
		ttl = StateTTL
	}

	// Лимитируем создание state чтобы не превратить endpoint в бесплатный
	// Redis-spam vector. 30/мин на IP — достаточно для обычного юзера
	// (даже при ретраях) и явно мало для бота.
	if _, retry, err := uc.Limiter.Allow(ctx, "rl:auth:yandex:start:"+in.IP, 30, time.Minute); err != nil {
		if isRateLimited(err) {
			return StartLoginYandexResult{}, rateLimitedErr(retry)
		}
		return StartLoginYandexResult{}, fmt.Errorf("auth.StartLoginYandex: rate limit: %w", err)
	}

	state, err := randomBase64URL(32)
	if err != nil {
		return StartLoginYandexResult{}, fmt.Errorf("auth.StartLoginYandex: gen state: %w", err)
	}
	// PKCE: verifier — 32 байта → 43 символа base64url (RFC 7636 §4.1 требует
	// 43..128 символов). Challenge — SHA256(verifier) в base64url БЕЗ padding.
	verifier, err := randomBase64URL(32)
	if err != nil {
		return StartLoginYandexResult{}, fmt.Errorf("auth.StartLoginYandex: gen verifier: %w", err)
	}
	challenge := pkceChallenge(verifier)

	if err := uc.States.SaveState(ctx, state, verifier, ttl); err != nil {
		return StartLoginYandexResult{}, fmt.Errorf("auth.StartLoginYandex: save state: %w", err)
	}

	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", uc.ClientID)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	if in.RedirectURI != "" {
		q.Set("redirect_uri", in.RedirectURI)
	}
	return StartLoginYandexResult{
		AuthorizeURL: uc.AuthorizeURL + "?" + q.Encode(),
		State:        state,
		ExpiresAt:    time.Now().Add(ttl).UTC(),
	}, nil
}

// randomBase64URL возвращает случайные n байт в base64url без padding.
func randomBase64URL(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand.Read: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// pkceChallenge = base64url(sha256(verifier)) без padding (RFC 7636 §4.2, S256).
func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
