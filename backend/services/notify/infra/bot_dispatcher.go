package infra

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

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
	// /start <auth_token>
	// TODO(auth-domain): this is the deep-link login flow. Requires a new
	// openapi endpoint POST /auth/telegram/deeplink/exchange — flag that for
	// the next iteration. For now, reply with a stub and log the token.
	d.bot.log.InfoContext(ctx, "notify.telegram.start.deeplink",
		slog.String("token_prefix", safePrefix(args[0])),
		slog.Int64("chat_id", msg.Chat.ID))
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.WelcomeDeepLink)
}

func (d CommandDispatcher) handleHelp(ctx context.Context, msg *tgbotapi.Message, _ []string) error {
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.Help)
}

// handleLink associates the incoming Telegram chat with a druz9 account.
//   /link <username>
// Verification: the user's Telegram username (msg.From.UserName) MUST match
// the stored profile's telegram_username. For MVP we only verify that msg.From
// provides SOME username (bible §9 already uses the Login Widget to bind
// telegram → user during login). A mismatch replies with LinkUsernameMiss.
func (d CommandDispatcher) handleLink(ctx context.Context, msg *tgbotapi.Message, args []string) error {
	if len(args) == 0 {
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LinkMissingArg)
	}
	username := strings.TrimPrefix(args[0], "@")
	uid, err := d.bot.users.FindIDByUsername(ctx, username)
	if err != nil {
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LinkNoUser)
	}
	if msg.From == nil || msg.From.UserName == "" {
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LinkUsernameMiss)
	}
	// STUB: cross-domain telegram_username check against auth.users would go
	// here. For MVP we accept any authenticated Telegram user whose druz9
	// username exists — the Login Widget already binds them. This is tracked
	// as a bible §9 follow-up.
	chatID := fmt.Sprintf("%d", msg.Chat.ID)
	if err := d.bot.prefs.SetTelegramChatID(ctx, uid, chatID); err != nil {
		return fmt.Errorf("handleLink: %w", err)
	}
	d.bot.log.InfoContext(ctx, "notify.telegram.linked",
		slog.String("user_id", uid.String()),
		slog.Int64("chat_id", msg.Chat.ID))
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LinkOK)
}

func (d CommandDispatcher) handleUnlink(ctx context.Context, msg *tgbotapi.Message, _ []string) error {
	// We don't know the user_id from the Telegram chat alone — resolve by
	// looking up *any* preferences row with telegram_chat_id = msg.Chat.ID.
	// STUB: the MVP uses username verification via msg.From. If the user
	// hasn't set their Telegram username, /unlink fails with an instructive
	// reply.
	if msg.From == nil || msg.From.UserName == "" {
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LinkUsernameMiss)
	}
	uid, err := d.bot.users.FindIDByUsername(ctx, msg.From.UserName)
	if err != nil {
		return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.LinkNoUser)
	}
	if err := d.bot.prefs.ClearTelegramChatID(ctx, uid); err != nil {
		return fmt.Errorf("handleUnlink: %w", err)
	}
	return d.bot.reply(ctx, msg.Chat.ID, d.bot.cfg.Replies.Unlinked)
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
