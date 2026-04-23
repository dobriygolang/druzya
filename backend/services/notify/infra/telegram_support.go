// telegram_support.go — реализация SupportBotNotifier (см. ports/support_handler.go).
//
// Шлёт alert-сообщение в support-чат в Telegram при создании нового ticket'а.
// Chat ID берётся из env (`SUPPORT_TELEGRAM_CHAT_ID`); если не задан — никуда
// не шлёт, тихо игнорим (ticket всё равно сохранён в БД, оператор увидит в
// админке).
package infra

import (
	"context"
	"fmt"
	"strconv"

	"druz9/notify/domain"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

// SupportBotNotifier — обёртка вокруг TelegramBot для отправки алертов в
// support-чат. Реализует интерфейс ports.SupportBotNotifier.
type SupportBotNotifier struct {
	bot         *TelegramBot
	supportChat int64 // 0 = выключено
}

// NewSupportBotNotifier создаёт notifier. supportChatID — числовой
// Telegram chat_id канала/группы где сидят операторы.
//
// Получить ID:
//  1. Добавить @druz9_bot в группу как админа
//  2. В группе написать /id (бот ответит) ИЛИ через @userinfobot
//  3. Положить в env: SUPPORT_TELEGRAM_CHAT_ID=-1001234567890
func NewSupportBotNotifier(bot *TelegramBot, supportChatID string) *SupportBotNotifier {
	n := &SupportBotNotifier{bot: bot}
	if supportChatID == "" {
		return n
	}
	id, err := strconv.ParseInt(supportChatID, 10, 64)
	if err == nil {
		n.supportChat = id
	}
	return n
}

// NotifySupport отправляет форматированное сообщение в support-чат.
func (n *SupportBotNotifier) NotifySupport(ctx context.Context, t domain.SupportTicket) error {
	if n.bot == nil || n.supportChat == 0 {
		// Тихо игнорим — ticket сохранён в БД, support увидит в админке
		// (когда /admin закроется по Group B).
		return nil
	}
	text := formatSupportTicket(t)
	msg := tgbotapi.NewMessage(n.supportChat, text)
	msg.ParseMode = tgbotapi.ModeMarkdownV2
	msg.DisableWebPagePreview = true
	if err := n.bot.sendWithRetry(ctx, t.ID, n.supportChat, msg); err != nil {
		return fmt.Errorf("notify.support: send to %d: %w", n.supportChat, err)
	}
	return nil
}

// formatSupportTicket собирает MarkdownV2 строку для оператора.
func formatSupportTicket(t domain.SupportTicket) string {
	user := "анон"
	if t.UserID != nil {
		user = t.UserID.String()
	}
	subj := t.Subject
	if subj == "" {
		subj = "_без темы_"
	}
	return fmt.Sprintf(
		"🆘 *Новая заявка*\n"+
			"`%s`\n\n"+
			"*От:* %s\n"+
			"*Контакт:* %s — `%s`\n"+
			"*Тема:* %s\n\n"+
			"```\n%s\n```",
		mdEscape(t.ID.String()),
		mdEscape(user),
		mdEscape(t.ContactKind),
		mdEscape(t.ContactValue),
		mdEscape(subj),
		mdEscapeCode(t.Message),
	)
}

// mdEscape — минимальный экранировщик для MarkdownV2 inline-text.
func mdEscape(s string) string {
	const special = `_*[]()~` + "`" + `>#+-=|{}.!\`
	out := make([]byte, 0, len(s)+8)
	for i := range len(s) {
		c := s[i]
		for j := range len(special) {
			if c == special[j] {
				out = append(out, '\\')
				break
			}
		}
		out = append(out, c)
	}
	return string(out)
}

// mdEscapeCode — для содержимого ```...``` блоков (нужно только \ и ` экранировать).
func mdEscapeCode(s string) string {
	out := make([]byte, 0, len(s)+8)
	for i := range len(s) {
		c := s[i]
		if c == '`' || c == '\\' {
			out = append(out, '\\')
		}
		out = append(out, c)
	}
	return string(out)
}
