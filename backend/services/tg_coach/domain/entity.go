// Package domain holds Telegram coach entities and ports.
//
// STRATEGIC SCAFFOLD: see ../README.md and docs/strategic/tg-coach.md.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// ErrNotImplemented is the canonical sentinel.
var ErrNotImplemented = errors.New("tg_coach: not implemented; see docs/strategic/tg-coach.md")

// ErrUnknownChat is returned by HandleCommand when the chat_id is not yet
// linked. The bot must reply with deep-link instructions; it MUST NOT
// auto-create a druz9 account (anti-fallback).
var ErrUnknownChat = errors.New("tg_coach: chat_id not linked")

// ErrTokenInvalid means the link token is missing, expired, or already used.
var ErrTokenInvalid = errors.New("tg_coach: link token invalid or expired")

// TGUserLink binds a druz9 user to a Telegram chat.
type TGUserLink struct {
	UserID      uuid.UUID
	ChatID      int64
	TGUsername  string
	LinkedAt    time.Time
	Locale      string
	PushLocalHH int    // 0..23
	PushTZ      string // IANA, e.g. "Europe/Moscow"
	PausedUntil *time.Time
	LastSeenAt  *time.Time
}

// TGLinkToken is a one-shot token used by `/start <token>` deep link.
type TGLinkToken struct {
	Token     string
	UserID    uuid.UUID
	CreatedAt time.Time
	ExpiresAt time.Time
	UsedAt    *time.Time
}

// Command is a parsed Telegram command.
type Command struct {
	Name string   // without leading slash, e.g. "today"
	Args []string // whitespace-split arguments
}
