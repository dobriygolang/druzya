package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"druz9/auth/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
)

// PollTelegramCode is the use case for POST /api/v1/auth/telegram/poll.
// Frontend hits this every ~2s while the user finishes the bot flow.
//
// Behaviour:
//   - code key not in Redis → ErrCodeNotFound (HTTP 410 — expired)
//   - key exists with empty payload → ErrCodePending (HTTP 202 — keep polling)
//   - key exists with payload → upsert user, mint tokens, DELETE key, return tokens.
//
// The mint path mirrors LoginTelegram exactly — same UpsertByOAuth, same event,
// same token issuance — only the HMAC step is skipped because we trust the
// payload that was stamped onto Redis by our own bot webhook handler.
type PollTelegramCode struct {
	Codes      domain.TelegramCodeRepo
	Users      domain.UserRepo
	Sessions   domain.SessionRepo
	Limiter    domain.RateLimiter
	Bus        sharedDomain.Bus
	Issuer     *TokenIssuer
	RefreshTTL time.Duration
	Log        *slog.Logger
}

// PollTelegramCodeInput carries the polled code + caller context.
type PollTelegramCodeInput struct {
	Code      string
	IP        string
	UserAgent string
}

// PollTelegramCodeResult is returned only on the terminal "authenticated" branch.
type PollTelegramCodeResult struct {
	Tokens    domain.TokenPair
	User      domain.User
	IsNewUser bool
}

// Do performs one poll. See struct comment for the three-branch contract.
func (uc *PollTelegramCode) Do(ctx context.Context, in PollTelegramCodeInput) (PollTelegramCodeResult, error) {
	if !domain.IsValidTelegramCode(in.Code) {
		return PollTelegramCodeResult{}, fmt.Errorf("auth.PollTelegramCode: invalid code format")
	}
	// Per-code rate limit: 60/min (5min TTL × 60 polls/min × 2s = many polls
	// per code, capped to bound abuse).
	if _, retry, err := uc.Limiter.Allow(ctx, "rl:auth:tg:poll:"+in.Code, 60, time.Minute); err != nil {
		if isRateLimited(err) {
			return PollTelegramCodeResult{}, rateLimitedErr(retry)
		}
		return PollTelegramCodeResult{}, fmt.Errorf("auth.PollTelegramCode: rate limit: %w", err)
	}

	payload, filled, err := uc.Codes.Get(ctx, in.Code)
	if err != nil {
		// ErrCodeNotFound passes through wrapped for caller errors.Is.
		return PollTelegramCodeResult{}, fmt.Errorf("auth.PollTelegramCode: get code: %w", err)
	}
	if !filled {
		return PollTelegramCodeResult{}, fmt.Errorf("auth.PollTelegramCode: %w", domain.ErrCodePending)
	}

	// Single-use: delete BEFORE we mint so that retries on concurrent polls
	// don't issue duplicate tokens.
	if delErr := uc.Codes.Delete(ctx, in.Code); delErr != nil {
		uc.Log.WarnContext(ctx, "auth.PollTelegramCode: delete failed", slog.Any("err", delErr))
	}

	usernameHint := domain.NormaliseUsername(payload.Username)
	if usernameHint == "" {
		usernameHint = "tg_" + strconv.FormatInt(payload.ID, 10)
	}
	display := strings.TrimSpace(payload.FirstName + " " + payload.LastName)

	user, created, err := uc.Users.UpsertByOAuth(ctx, domain.UpsertOAuthInput{
		Provider:       enums.AuthProviderTelegram,
		ProviderUserID: strconv.FormatInt(payload.ID, 10),
		Email:          "",
		UsernameHint:   usernameHint,
		DisplayName:    display,
		AvatarURL:      payload.PhotoURL,
	})
	if err != nil {
		return PollTelegramCodeResult{}, fmt.Errorf("auth.PollTelegramCode: upsert: %w", err)
	}

	pair, err := BuildTokenPair(ctx, uc.Issuer, uc.Sessions, user, enums.AuthProviderTelegram, uc.RefreshTTL, in.UserAgent, in.IP)
	if err != nil {
		return PollTelegramCodeResult{}, fmt.Errorf("auth.PollTelegramCode: tokens: %w", err)
	}
	if err := publishLoginEvent(ctx, uc.Bus, user, enums.AuthProviderTelegram, created); err != nil {
		uc.Log.WarnContext(ctx, "auth.PollTelegramCode: publish event", slog.Any("err", err))
	}
	// Привязка chat_id к юзеру — единственный легитимный путь (криптографически
	// безопасный потому что code однократный, создан в авторизованной сессии).
	// notify-сервис подписан на TelegramChatLinked и вызовет SetTelegramChatID.
	// При отсутствии ChatID (старый payload без поля) скипаем — не публикуем.
	if payload.ChatID != 0 {
		chatEv := sharedDomain.TelegramChatLinked{
			UserID: user.ID,
			ChatID: payload.ChatID,
		}
		if err := uc.Bus.Publish(ctx, chatEv); err != nil {
			uc.Log.WarnContext(ctx, "auth.PollTelegramCode: publish TelegramChatLinked",
				slog.Any("err", err))
		}
	}
	return PollTelegramCodeResult{Tokens: pair, User: user, IsNewUser: created}, nil
}

// Sentinel re-export for handler convenience — callers can write
// errors.Is(err, app.ErrCodePending) without the domain import.
var (
	ErrCodePending  = domain.ErrCodePending
	ErrCodeNotFound = domain.ErrCodeNotFound
)

// IsCodePending unwraps the err and reports whether it’s a pending-state.
func IsCodePending(err error) bool { return errors.Is(err, domain.ErrCodePending) }

// IsCodeNotFound unwraps the err and reports whether it’s an expired/missing code.
func IsCodeNotFound(err error) bool { return errors.Is(err, domain.ErrCodeNotFound) }
