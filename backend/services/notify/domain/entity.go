// Package domain содержит сущности, value-объекты и интерфейсы репозиториев
// bounded-контекста notify. Импорты внешних фреймворков сюда не допускаются.
package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrNotFound — канонический not-found sentinel домена notify.
var ErrNotFound = errors.New("notify: not found")

// ErrInvalidChannel возвращается, когда канал не входит в известный enum.
var ErrInvalidChannel = errors.New("notify: invalid channel")

// QuietHours — окно [From,To]. Оба значения времени суток выражены в локальной
// таймзоне вызывающего. Если From > To, окно переходит через полночь.
// Нулевое значение = "тихие часы не настроены".
type QuietHours struct {
	From time.Time // используется только час/минуты
	To   time.Time
	Set  bool
}

// Preferences — пользовательская строка настроек (notification_preferences).
type Preferences struct {
	UserID                    uuid.UUID
	Channels                  []enums.NotificationChannel
	TelegramChatID            string
	Quiet                     QuietHours
	WeeklyReportEnabled       bool
	SkillDecayWarningsEnabled bool
	UpdatedAt                 time.Time
}

// HasChannel возвращает true, если c есть среди включённых каналов.
func (p Preferences) HasChannel(c enums.NotificationChannel) bool {
	for _, x := range p.Channels {
		if x == c {
			return true
		}
	}
	return false
}

// Notification — исходящая запись сообщения, ожидающая рендера и отправки.
// На enqueue-пути сохраняется как JSON в Redis-list; worker снимает и
// диспатчит. Payload — параметры шаблона, специфичные для типа события.
type Notification struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Type      enums.NotificationType
	Channel   enums.NotificationChannel
	Locale    string         // "ru" | "en"
	Payload   map[string]any // параметры шаблона
	CreatedAt time.Time
	// ForceDelivery игнорирует тихие часы — используется только для MatchStarted.
	ForceDelivery bool
}

// Template — отрендеренное сообщение.
type Template struct {
	Text string
	// ParseMode задаётся, когда отправитель должен интерпретировать форматирование
	// ("", "MarkdownV2", "HTML"). По умолчанию — plain.
	ParseMode string
}

// LogEntry — запись аудита в notifications_log.
type LogEntry struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Channel   enums.NotificationChannel
	Type      enums.NotificationType
	Payload   map[string]any
	Status    string // "pending" | "sent" | "failed"
	SentAt    *time.Time
	Error     string
	CreatedAt time.Time
}
