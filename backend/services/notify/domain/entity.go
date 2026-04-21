// Package domain contains the entities, value objects and repository interfaces
// for the notify bounded context. No external framework imports here.
package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// ErrNotFound is the canonical not-found sentinel for the notify domain.
var ErrNotFound = errors.New("notify: not found")

// ErrInvalidChannel is returned when a channel is not a known enum value.
var ErrInvalidChannel = errors.New("notify: invalid channel")

// QuietHours represents a [From,To] window. Both TOD values are expressed in
// the caller's local timezone. If From > To the window wraps midnight.
// Zero-value means "no quiet hours configured".
type QuietHours struct {
	From time.Time // only hour/minute are used
	To   time.Time
	Set  bool
}

// Preferences is the user-facing configuration row (notification_preferences).
type Preferences struct {
	UserID                    uuid.UUID
	Channels                  []enums.NotificationChannel
	TelegramChatID            string
	Quiet                     QuietHours
	WeeklyReportEnabled       bool
	SkillDecayWarningsEnabled bool
	UpdatedAt                 time.Time
}

// HasChannel returns true when c is among the enabled channels.
func (p Preferences) HasChannel(c enums.NotificationChannel) bool {
	for _, x := range p.Channels {
		if x == c {
			return true
		}
	}
	return false
}

// Notification is an outbound message row waiting to be rendered+sent.
// The enqueue path stores this as JSON in a Redis list; the worker pops and
// dispatches. Payload is event-type-specific template params.
type Notification struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	Type      enums.NotificationType
	Channel   enums.NotificationChannel
	Locale    string         // "ru" | "en"
	Payload   map[string]any // template params
	CreatedAt time.Time
	// ForceDelivery bypasses quiet-hours — used only for MatchStarted.
	ForceDelivery bool
}

// Template is a rendered message.
type Template struct {
	Text string
	// ParseMode is set when the sender should interpret formatting
	// ("", "MarkdownV2", "HTML"). Default is plain.
	ParseMode string
}

// LogEntry is an audit row in notifications_log.
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
