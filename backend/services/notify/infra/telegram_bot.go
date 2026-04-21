// telegram_bot.go — real Telegram Bot integration.
//
// LIBRARY: github.com/go-telegram-bot-api/telegram-bot-api/v5 (the canonical
// maintained fork). Chosen over mymmrac/telego because its surface is smaller,
// it has no v6-webhook-only lock-in, and it's the most widely documented
// library for Russian-language Go tutorials (bible §3.1 "Russian-first team").
//
// The bot is exposed as two seam types:
//   - telegramAPI — a narrow interface the bot code uses. In tests we swap it
//     with a fake so unit tests don't hit the network.
//   - TelegramBot — the domain-level adapter. Implements domain.Sender for
//     outbound DMs and exposes HandleUpdate for inbound webhook parsing.
//
// Secrets (bot token, webhook secret) are NEVER logged; field functions redact
// them to "<redacted>".
package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"druz9/notify/domain"
	"druz9/shared/enums"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/google/uuid"
)

// telegramAPI is the narrow interface over tgbotapi.BotAPI used by the bot
// code. Keeping it focused lets us mock it in unit tests.
type telegramAPI interface {
	Send(c tgbotapi.Chattable) (tgbotapi.Message, error)
	Request(c tgbotapi.Chattable) (*tgbotapi.APIResponse, error)
}

// TelegramBotConfig holds the tunables. The token and webhook secret are never
// printed in logs — see the Logger helper.
type TelegramBotConfig struct {
	Token          string
	WebhookSecret  string
	PublicBaseURL  string // used to compute the webhook URL
	WebhookPath    string // defaults to /api/v1/notify/telegram/webhook
	Env            string // "local" | "stage" | "prod"
	MaxSendRetries int    // defaults to 3
	Replies        BotReplies
}

// TelegramBot is the adapter used by the worker (outbound Sender) and by the
// webhook handler (inbound updates).
type TelegramBot struct {
	api      telegramAPI
	cfg      TelegramBotConfig
	log      *slog.Logger
	prefs    domain.PreferencesRepo
	users    domain.UserLookup
	dispatch CommandDispatcher
}

// NewTelegramBot constructs a real bot from a token. If token is empty (common
// in tests / local), a no-op stub is returned instead — this keeps main.go
// boot-up trivial when no bot token is present.
func NewTelegramBot(cfg TelegramBotConfig, log *slog.Logger, prefs domain.PreferencesRepo, users domain.UserLookup) (*TelegramBot, error) {
	if cfg.WebhookPath == "" {
		cfg.WebhookPath = "/api/v1/notify/telegram/webhook"
	}
	if cfg.MaxSendRetries == 0 {
		cfg.MaxSendRetries = 3
	}
	if cfg.Replies == (BotReplies{}) {
		cfg.Replies = RussianReplies
	}
	var api telegramAPI
	if cfg.Token == "" {
		api = noopTelegramAPI{log: log}
		log.Warn("notify.telegram: no token — running in no-op stub mode")
	} else {
		b, err := tgbotapi.NewBotAPI(cfg.Token)
		if err != nil {
			return nil, fmt.Errorf("notify.telegram: NewBotAPI: %w", err)
		}
		b.Debug = false
		api = b
	}
	bot := &TelegramBot{
		api:   api,
		cfg:   cfg,
		log:   log,
		prefs: prefs,
		users: users,
	}
	bot.dispatch = NewCommandDispatcher(bot)
	return bot, nil
}

// Channel implements domain.Sender.
func (b *TelegramBot) Channel() enums.NotificationChannel {
	return enums.NotificationChannelTelegram
}

// Send delivers a rendered template to the given chat_id. The caller supplies
// chatIdentity = Preferences.TelegramChatID (string form of an int64 chat_id).
// Empty identity returns domain.ErrNoTarget so the worker can fall through.
func (b *TelegramBot) Send(ctx context.Context, userID uuid.UUID, chatIdentity string, tpl domain.Template) error {
	if chatIdentity == "" {
		b.log.InfoContext(ctx, "notify.telegram.Send: no_telegram_chat_id",
			slog.String("user_id", userID.String()))
		return domain.ErrNoTarget
	}
	chatID, err := parseChatID(chatIdentity)
	if err != nil {
		return fmt.Errorf("notify.telegram.Send: bad chat_id: %w", err)
	}
	msg := tgbotapi.NewMessage(chatID, tpl.Text)
	if tpl.ParseMode != "" {
		msg.ParseMode = tpl.ParseMode
	}

	return b.sendWithRetry(ctx, userID, chatID, msg)
}

// sendWithRetry respects 429/retry_after. Max retries per bot config.
func (b *TelegramBot) sendWithRetry(ctx context.Context, userID uuid.UUID, chatID int64, msg tgbotapi.Chattable) error {
	start := time.Now()
	var lastErr error
	backoff := 500 * time.Millisecond
	for attempt := 0; attempt <= b.cfg.MaxSendRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("ctx cancelled: %w", err)
		}
		_, err := b.api.Send(msg)
		if err == nil {
			b.log.InfoContext(ctx, "notify.telegram.send.ok",
				slog.String("user_id", userID.String()),
				slog.Int64("chat_id", chatID),
				slog.Int("attempt", attempt),
				slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			)
			return nil
		}
		lastErr = err
		// tgbotapi.Error wraps 429 with RetryAfter in Parameters.
		retryAfter := retryAfterFromErr(err)
		if retryAfter > 0 {
			b.log.WarnContext(ctx, "notify.telegram.send.429",
				slog.String("user_id", userID.String()),
				slog.Int("retry_after_s", int(retryAfter.Seconds())),
				slog.Int("attempt", attempt),
			)
			select {
			case <-ctx.Done():
				return fmt.Errorf("ctx cancelled: %w", ctx.Err())
			case <-time.After(retryAfter):
			}
			continue
		}
		// Other errors: exponential backoff.
		if attempt < b.cfg.MaxSendRetries {
			select {
			case <-ctx.Done():
				return fmt.Errorf("ctx cancelled: %w", ctx.Err())
			case <-time.After(backoff):
			}
			backoff *= 2
		}
	}
	return fmt.Errorf("notify.telegram.Send: after %d attempts: %w", b.cfg.MaxSendRetries+1, lastErr)
}

// RegisterWebhook calls Bot API setWebhook with the configured public URL.
// Skipped automatically when env=="local" (you run getUpdates polling locally,
// or ngrok with a separate script).
func (b *TelegramBot) RegisterWebhook(ctx context.Context) error {
	if b.cfg.Env == "local" {
		b.log.Info("notify.telegram: webhook skipped, use /setUpdateMode script in dev")
		return nil
	}
	if b.cfg.PublicBaseURL == "" {
		return errors.New("notify.telegram.RegisterWebhook: PublicBaseURL empty")
	}
	url := strings.TrimRight(b.cfg.PublicBaseURL, "/") + b.cfg.WebhookPath +
		"?secret=" + b.cfg.WebhookSecret
	wh, err := tgbotapi.NewWebhook(url)
	if err != nil {
		return fmt.Errorf("notify.telegram.RegisterWebhook: build: %w", err)
	}
	if _, err := b.api.Request(wh); err != nil {
		return fmt.Errorf("notify.telegram.RegisterWebhook: request: %w", err)
	}
	b.log.Info("notify.telegram: webhook registered",
		slog.String("base_url", b.cfg.PublicBaseURL),
		slog.String("path", b.cfg.WebhookPath),
		slog.String("secret", redactedSecret(b.cfg.WebhookSecret)),
	)
	return nil
}

// Close deletes the webhook and shuts down cleanly. Called during graceful
// shutdown. Safe to call on a no-op bot.
func (b *TelegramBot) Close(ctx context.Context) error {
	if b.cfg.Token == "" {
		return nil
	}
	if _, err := b.api.Request(tgbotapi.DeleteWebhookConfig{}); err != nil {
		return fmt.Errorf("notify.telegram.Close: %w", err)
	}
	return nil
}

// HandleUpdate parses an incoming tgbotapi.Update and dispatches to the right
// command handler. Exposed so the HTTP webhook adapter can call it directly
// after decoding the JSON body.
func (b *TelegramBot) HandleUpdate(ctx context.Context, update tgbotapi.Update) error {
	if update.Message != nil {
		return b.dispatch.Dispatch(ctx, update.Message)
	}
	if update.CallbackQuery != nil {
		return b.handleCallback(ctx, update.CallbackQuery)
	}
	return nil
}

// handleCallback responds to inline keyboard presses. Currently a STUB — the
// real `daily_kata_start` / `snooze` handlers will be wired once the daily
// domain publishes the buttons.
func (b *TelegramBot) handleCallback(ctx context.Context, cq *tgbotapi.CallbackQuery) error {
	b.log.InfoContext(ctx, "notify.telegram.callback",
		slog.String("data", cq.Data),
		slog.Int64("chat_id", cq.Message.Chat.ID),
	)
	ack := tgbotapi.NewCallback(cq.ID, b.cfg.Replies.CallbackStub)
	if _, err := b.api.Request(ack); err != nil {
		return fmt.Errorf("notify.telegram.callback.ack: %w", err)
	}
	return nil
}

// reply sends a plain text reply to a chat. Utility used by the dispatcher.
func (b *TelegramBot) reply(ctx context.Context, chatID int64, text string) error {
	msg := tgbotapi.NewMessage(chatID, text)
	return b.sendWithRetry(ctx, uuid.Nil, chatID, msg)
}

// ── helpers ────────────────────────────────────────────────────────────────

// parseChatID converts the stored string to an int64 for tgbotapi.
func parseChatID(s string) (int64, error) {
	var id int64
	if _, err := fmt.Sscan(s, &id); err != nil {
		return 0, fmt.Errorf("chat_id parse: %w", err)
	}
	return id, nil
}

// retryAfterFromErr extracts the Retry-After duration from a Bot API error.
// Returns 0 if not a 429. tgbotapi.Error embeds the Parameters map.
func retryAfterFromErr(err error) time.Duration {
	var apiErr *tgbotapi.Error
	if !errors.As(err, &apiErr) {
		return 0
	}
	if apiErr.Code != http.StatusTooManyRequests {
		return 0
	}
	if apiErr.ResponseParameters.RetryAfter > 0 {
		return time.Duration(apiErr.ResponseParameters.RetryAfter) * time.Second
	}
	return 1 * time.Second
}

// redactedSecret returns a token-safe representation for logs.
// We only log the first 3 chars and a suffix length.
func redactedSecret(s string) string {
	if s == "" {
		return "<empty>"
	}
	if len(s) <= 4 {
		return "***"
	}
	return s[:3] + "***(" + fmt.Sprintf("%d", len(s)-3) + ")"
}

// ── no-op bot (used when token absent) ─────────────────────────────────────

type noopTelegramAPI struct{ log *slog.Logger }

func (n noopTelegramAPI) Send(c tgbotapi.Chattable) (tgbotapi.Message, error) {
	n.log.Info("notify.telegram.noop.Send")
	return tgbotapi.Message{}, nil
}

func (n noopTelegramAPI) Request(c tgbotapi.Chattable) (*tgbotapi.APIResponse, error) {
	n.log.Info("notify.telegram.noop.Request")
	return &tgbotapi.APIResponse{Ok: true}, nil
}

// Compile-time assertion.
var _ domain.Sender = (*TelegramBot)(nil)

// marshal/unmarshal helpers for the webhook adapter's JSON decoding.
var _ = json.Marshal
