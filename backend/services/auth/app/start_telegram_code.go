package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/auth/domain"
)

// StartTelegramCode is the use case for POST /api/v1/auth/telegram/start.
// It generates a deep-link code, stores a pending Redis key, and returns the
// code + Telegram bot deep-link URL the frontend opens for the user.
type StartTelegramCode struct {
	Codes   domain.TelegramCodeRepo
	Limiter domain.RateLimiter
	BotName string // e.g. "druz9_bot" — building https://t.me/<bot>?start=<code>
	CodeTTL time.Duration
	Log     *slog.Logger
	Now     func() time.Time // injectable for tests
}

// StartTelegramCodeInput — IP-only at the moment (rate-limit key).
type StartTelegramCodeInput struct {
	IP string
}

// StartTelegramCodeResult is what the HTTP layer returns.
type StartTelegramCodeResult struct {
	Code      string    `json:"code"`
	DeepLink  string    `json:"deep_link"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Do generates a code, persists it as pending in Redis with the configured TTL,
// and returns the deep-link URL.
//
// Retries: on the (vanishingly rare) collision returned by SetPending we retry
// up to 3 times before giving up. Other errors propagate.
func (uc *StartTelegramCode) Do(ctx context.Context, in StartTelegramCodeInput) (StartTelegramCodeResult, error) {
	if uc.BotName == "" {
		return StartTelegramCodeResult{}, fmt.Errorf("auth.StartTelegramCode: bot name not configured")
	}
	if _, retry, err := uc.Limiter.Allow(ctx, "rl:auth:tg:start:"+in.IP, 10, time.Minute); err != nil {
		if isRateLimited(err) {
			return StartTelegramCodeResult{}, rateLimitedErr(retry)
		}
		return StartTelegramCodeResult{}, fmt.Errorf("auth.StartTelegramCode: rate limit: %w", err)
	}

	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now()
	}

	var code string
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		c, err := domain.GenerateTelegramCode()
		if err != nil {
			return StartTelegramCodeResult{}, fmt.Errorf("auth.StartTelegramCode: gen: %w", err)
		}
		if err := uc.Codes.SetPending(ctx, c); err != nil {
			lastErr = err
			continue
		}
		code = c
		lastErr = nil
		break
	}
	if lastErr != nil {
		return StartTelegramCodeResult{}, fmt.Errorf("auth.StartTelegramCode: persist: %w", lastErr)
	}

	bot := strings.TrimPrefix(uc.BotName, "@")
	deepLink := fmt.Sprintf("https://t.me/%s?start=%s", bot, code)
	return StartTelegramCodeResult{
		Code:      code,
		DeepLink:  deepLink,
		ExpiresAt: now.Add(uc.CodeTTL),
	}, nil
}
