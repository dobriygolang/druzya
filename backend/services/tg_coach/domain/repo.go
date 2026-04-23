package domain

import (
	"context"

	"github.com/google/uuid"
)

// LinkRepo is the persistence port for tg_user_link + tg_link_tokens.
//
// STRATEGIC SCAFFOLD: implementation lands in `infra/postgres.go` against
// migration 00029_tg_coach.sql.
type LinkRepo interface {
	// IssueToken inserts a fresh link token row and returns the random
	// token string (the impl owns the entropy source).
	IssueToken(ctx context.Context, userID uuid.UUID) (string, error)

	// ConsumeToken validates the token (exists, not expired, not used)
	// and atomically marks it used. Returns the bound user_id.
	// Returns ErrTokenInvalid for any failure mode.
	ConsumeToken(ctx context.Context, token string) (uuid.UUID, error)

	// LinkChat upserts the (user_id, chat_id) binding.
	LinkChat(ctx context.Context, userID uuid.UUID, chatID int64, tgUsername string) error

	// LookupByChat returns the link row or ErrUnknownChat.
	LookupByChat(ctx context.Context, chatID int64) (TGUserLink, error)

	// LookupByUser returns the link row for a given druz9 user.
	LookupByUser(ctx context.Context, userID uuid.UUID) (TGUserLink, error)

	// Unlink deletes the binding for a user (forward-compatible with
	// the user-initiated "disconnect Telegram" flow).
	Unlink(ctx context.Context, userID uuid.UUID) error
}
