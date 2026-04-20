package infra

// BotReplies holds the canned bilingual replies used by the bot's command
// dispatcher. Russian is primary per bible §3.1. These are NOT domain.Template
// because they are replies to user input, not outbound notifications.
//
// Keep them short — inline keyboards carry the rest of the UX.
type BotReplies struct {
	Welcome          string
	WelcomeDeepLink  string // shown on /start <auth_token>
	Help             string
	LinkMissingArg   string
	LinkNoUser       string
	LinkUsernameMiss string // telegram username not set in profile
	LinkOK           string
	Unlinked         string
	StreakStub       string
	LeaderboardStub  string
	CallbackStub     string
	UnknownCommand   string
}

// RussianReplies is the primary catalogue.
var RussianReplies = BotReplies{
	Welcome: "Привет! Это бот druz9. Открой сайт и войди через Telegram, чтобы мы связали аккаунт. " +
		"После входа используй /link <username> чтобы получать уведомления сюда.",
	WelcomeDeepLink:  "Deep-link auth coming soon. Пока открой сайт и войди обычным способом.",
	Help:             "Команды: /start, /help, /link <username>, /unlink, /streak, /leaderboard",
	LinkMissingArg:   "Укажи username: /link alice",
	LinkNoUser:       "Пользователь не найден.",
	LinkUsernameMiss: "У тебя в Telegram не задан username или он не совпадает с профилем. " +
		"Открой Telegram → Настройки → Имя пользователя и проверь профиль druz9.",
	LinkOK:          "Готово! Теперь уведомления будут приходить сюда.",
	Unlinked:        "Отвязал. Уведомления в этот чат больше не будут приходить.",
	StreakStub:      "⚡ Streak — команда в работе. Пока смотри на сайте.",
	LeaderboardStub: "🏆 Лидерборд — команда в работе. Пока смотри на сайте.",
	CallbackStub:    "Действие в работе. Открой сайт.",
	UnknownCommand:  "Не знаю такой команды. Попробуй /help.",
}
