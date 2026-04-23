// Package app holds use case stubs for tg_coach.
package app

import (
	"context"
	"log/slog"
	"strings"

	"druz9/tg_coach/domain"

	"github.com/google/uuid"
)

// IssueLinkToken use case stub.
type IssueLinkToken struct {
	Repo domain.LinkRepo
	Log  *slog.Logger
}

// NewIssueLinkToken constructs the use case. Panics on nil logger.
func NewIssueLinkToken(r domain.LinkRepo, log *slog.Logger) *IssueLinkToken {
	if log == nil {
		panic("tg_coach/app: nil logger passed to NewIssueLinkToken")
	}
	return &IssueLinkToken{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/tg-coach.md
func (uc *IssueLinkToken) Do(_ context.Context, _ uuid.UUID) (string, error) {
	return "", domain.ErrNotImplemented
}

// LinkAccount use case stub. Consumes a token and binds chat_id.
type LinkAccount struct {
	Repo domain.LinkRepo
	Log  *slog.Logger
}

// NewLinkAccount constructs the use case.
func NewLinkAccount(r domain.LinkRepo, log *slog.Logger) *LinkAccount {
	if log == nil {
		panic("tg_coach/app: nil logger passed to NewLinkAccount")
	}
	return &LinkAccount{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/tg-coach.md
func (uc *LinkAccount) Do(_ context.Context, _ string, _ int64, _ string) error {
	return domain.ErrNotImplemented
}

// HandleCommand use case stub. Routes a parsed command to the right
// downstream service. STRATEGIC SCAFFOLD: returns ErrNotImplemented for
// every command except `/start <token>`, which is the link entry point and
// owned by LinkAccount above.
type HandleCommand struct {
	Repo domain.LinkRepo
	Log  *slog.Logger
}

// NewHandleCommand constructs the use case.
func NewHandleCommand(r domain.LinkRepo, log *slog.Logger) *HandleCommand {
	if log == nil {
		panic("tg_coach/app: nil logger passed to NewHandleCommand")
	}
	return &HandleCommand{Repo: r, Log: log}
}

// Do — STRATEGIC SCAFFOLD: not implemented; see docs/strategic/tg-coach.md
func (uc *HandleCommand) Do(_ context.Context, _ int64, _ domain.Command) (string, error) {
	return "", domain.ErrNotImplemented
}

// ParseCommand splits a Telegram message text into a Command.
//
// The command parser is the one piece of real logic in this scaffold,
// because it has zero dependencies and is testable without infrastructure.
// Returns (Command{}, false) if the text is not a slash-command.
func ParseCommand(text string) (domain.Command, bool) {
	t := strings.TrimSpace(text)
	if !strings.HasPrefix(t, "/") {
		return domain.Command{}, false
	}
	parts := strings.Fields(t[1:])
	if len(parts) == 0 {
		return domain.Command{}, false
	}
	// Strip @botname suffix from the command, e.g. "/start@druz9_bot".
	name := parts[0]
	if at := strings.IndexByte(name, '@'); at >= 0 {
		name = name[:at]
	}
	return domain.Command{Name: name, Args: parts[1:]}, true
}
