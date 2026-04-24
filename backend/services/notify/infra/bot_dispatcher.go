package infra

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"druz9/notify/domain"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

// CommandDispatcher routes incoming /commands to handler functions. Testable
// via table-driven tests — see bot_dispatcher_test.go.
type CommandDispatcher struct {
	bot      *TelegramBot
	handlers map[string]CommandHandler
}

// CommandHandler is the signature all bot commands share. Returning an error
// causes the webhook handler to log at WARN but still return 200 to Telegram
// (Telegram retries otherwise flood us).
type CommandHandler func(ctx context.Context, msg *tgbotapi.Message, args []string) error

// NewCommandDispatcher registers the built-in command set.
func NewCommandDispatcher(bot *TelegramBot) CommandDispatcher {
	d := CommandDispatcher{bot: bot, handlers: map[string]CommandHandler{}}
	d.handlers["start"] = d.handleStart
	d.handlers["help"] = d.handleHelp
	d.handlers["link"] = d.handleLink
	d.handlers["unlink"] = d.handleUnlink
	d.handlers["streak"] = d.handleStreakStub
	d.handlers["leaderboard"] = d.handleLeaderboardStub
	return d
}

// Dispatch is the entry point for Message updates. Non-command messages
// (plain text) are ignored with an INFO log.
func (d CommandDispatcher) Dispatch(ctx context.Context, msg *tgbotapi.Message) error {
	if msg == nil {
		return nil
	}
	if !msg.IsCommand() {
		d.bot.log.InfoContext(ctx, "notify.telegram.dispatch.non_command",
			slog.Int64("chat_id", msg.Chat.ID))
		return nil
	}
	cmd := msg.Command()
	args := parseArgs(msg.CommandArguments())
	h, ok := d.handlers[cmd]
	if !ok {
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.UnknownCommand)
	}
	if err := h(ctx, msg, args); err != nil {
		d.bot.log.WarnContext(ctx, "notify.telegram.command.failed",
			slog.String("cmd", cmd),
			slog.Int64("chat_id", msg.Chat.ID),
			slog.Any("err", err))
		return err
	}
	return nil
}

// parseArgs splits msg.CommandArguments() on whitespace, dropping empty fields.
func parseArgs(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	return strings.Fields(raw)
}

// ── handlers ────────────────────────────────────────────────────────────────

func (d CommandDispatcher) handleStart(ctx context.Context, msg *tgbotapi.Message, args []string) error {
	if len(args) == 0 {
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.Welcome)
	}
	// /start <code> — deep-link auth flow (см. backend/services/auth/app/poll_telegram_code.go).
	code := args[0]
	d.bot.log.InfoContext(ctx, "notify.telegram.start.deeplink",
		slog.String("code_prefix", safePrefix(code)),
		slog.Int64("chat_id", msg.Chat.ID))
	if d.bot.codes == nil {
		// CodeFiller не сконфигурирован (например, локальная разработка без auth-домена).
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.WelcomeDeepLink)
	}
	if msg.From == nil || msg.From.ID == 0 {
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.DeepLinkInvalidCode)
	}
	payload := domain.TelegramAuthPayload{
		ID:        msg.From.ID,
		FirstName: msg.From.FirstName,
		LastName:  msg.From.LastName,
		Username:  msg.From.UserName,
		AuthDate:  int64(msg.Date),
	}
	if err := d.bot.codes.Fill(ctx, code, payload); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.DeepLinkInvalidCode)
		}
		d.bot.log.WarnContext(ctx, "notify.telegram.start.fill",
			slog.String("code_prefix", safePrefix(code)),
			slog.Any("err", err))
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.DeepLinkFailed)
	}
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.DeepLinkOK)
}

func (d CommandDispatcher) handleHelp(ctx context.Context, msg *tgbotapi.Message, _ []string) error {
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.Help)
}

// handleLink — ОТКЛЮЧЕН (2026-04-24 security hotfix).
//
// Старая реализация принимала `/link <druz9_username>` и безусловно писала
// telegram_chat_id = msg.Chat.ID на найденный user_id БЕЗ верификации того,
// что запрашивающий в Telegram реально владеет этим druz9-аккаунтом. Плюс
// telegram_chat_id в БД не был UNIQUE — один чат мог быть привязан к нескольким
// user_id, приводя к тому что уведомления чужих пользователей попадали в чат
// первого, кто "/link"-нул их username.
//
// Легитимный путь привязки — deep-link /start <code>, где code одноразовый и
// создаётся на сайте после авторизованного действия пользователя (см.
// handleStart → codes.Fill → auth/app/poll_telegram_code.go). На этом пути
// личность автора Telegram-обращения криптографически связана с druz9-user'ом
// через обмен через наш backend.
//
// Пока не сделаем отдельный "Привязать Telegram" button на сайте с секретным
// одноразовым токеном — команду /link просто отключаем. SetTelegramChatID
// не дёргается; пользователю отправляем инструкцию как привязаться через сайт.
func (d CommandDispatcher) handleLink(ctx context.Context, msg *tgbotapi.Message, _ []string) error {
	d.bot.log.InfoContext(ctx, "notify.telegram.link.blocked",
		slog.Int64("chat_id", msg.Chat.ID),
		slog.String("reason", "disabled_security_hotfix"))
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LinkDisabled)
}

// handleUnlink — ОТКЛЮЧЕН аналогично handleLink.
//
// Старая реализация вызывала FindIDByUsername(msg.From.UserName) — это Telegram
// username, не druz9 username; совпадали они или нет — случайность. А сам
// ClearTelegramChatID тоже не верифицировал владельца строки.
//
// Отвязка должна происходить через Settings на сайте или через deep-link flow
// аналогичный привязке (одноразовый код).
func (d CommandDispatcher) handleUnlink(ctx context.Context, msg *tgbotapi.Message, _ []string) error {
	d.bot.log.InfoContext(ctx, "notify.telegram.unlink.blocked",
		slog.Int64("chat_id", msg.Chat.ID),
		slog.String("reason", "disabled_security_hotfix"))
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LinkDisabled)
}

// TODO: /streak reads daily_streaks and replies with the user's current streak.
// For MVP, reply with a pointer to the website.
func (d CommandDispatcher) handleStreakStub(ctx context.Context, msg *tgbotapi.Message, _ []string) error {
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.StreakStub)
}

// TODO: /leaderboard reads rating/leaderboard for a section and replies.
// For MVP, reply with a pointer to the website.
func (d CommandDispatcher) handleLeaderboardStub(ctx context.Context, msg *tgbotapi.Message, _ []string) error {
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LeaderboardStub)
}

// safePrefix redacts all but the first 4 chars of a token for log output.
func safePrefix(s string) string {
	if len(s) <= 4 {
		return "***"
	}
	return s[:4] + "…"
}
