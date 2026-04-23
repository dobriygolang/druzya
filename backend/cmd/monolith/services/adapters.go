package services

import (
	"context"
	"errors"
	"fmt"

	authApp "druz9/auth/app"
	authDomain "druz9/auth/domain"
	notifyDomain "druz9/notify/domain"

	"github.com/google/uuid"
)

// Three near-identical adapters bridge the auth package's TokenIssuer to
// each WS hub's TokenVerifier port. They differ only in method name —
// arena uses `VerifyAccess`, ai_mock and editor use `Verify` — which keeps
// each domain free of an auth-package import.

// arenaTokenVerifier satisfies druz9/arena/ports.TokenVerifier.
type arenaTokenVerifier struct{ issuer *authApp.TokenIssuer }

func (a arenaTokenVerifier) VerifyAccess(raw string) (uuid.UUID, error) {
	return parseSubject(a.issuer, raw)
}

// mockTokenVerifier satisfies druz9/ai_mock/domain.TokenVerifier.
type mockTokenVerifier struct{ issuer *authApp.TokenIssuer }

func (a mockTokenVerifier) Verify(raw string) (uuid.UUID, error) {
	return parseSubject(a.issuer, raw)
}

// editorTokenVerifier satisfies druz9/editor/domain.TokenVerifier.
type editorTokenVerifier struct{ issuer *authApp.TokenIssuer }

func (a editorTokenVerifier) Verify(raw string) (uuid.UUID, error) {
	return parseSubject(a.issuer, raw)
}

func parseSubject(issuer *authApp.TokenIssuer, raw string) (uuid.UUID, error) {
	claims, err := issuer.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse access token: %w", err)
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse subject uuid: %w", err)
	}
	return uid, nil
}

// telegramCodeFillerAdapter bridges notify.domain.CodeFiller (the bot's
// abstraction) onto auth.domain.TelegramCodeRepo (the Redis-backed store).
// It also translates the cross-domain payload type. Errors are mapped to
// notify.ErrNotFound so the bot's reply branching stays uniform.
type telegramCodeFillerAdapter struct{ repo authDomain.TelegramCodeRepo }

// NewTelegramCodeFillerAdapter exposes the adapter for monolith wiring.
func NewTelegramCodeFillerAdapter(repo authDomain.TelegramCodeRepo) notifyDomain.CodeFiller {
	return telegramCodeFillerAdapter{repo: repo}
}

// Fill implements notify.domain.CodeFiller.
func (a telegramCodeFillerAdapter) Fill(ctx context.Context, code string, p notifyDomain.TelegramAuthPayload) error {
	if err := a.repo.Fill(ctx, code, authDomain.TelegramPayload{
		ID:        p.ID,
		FirstName: p.FirstName,
		LastName:  p.LastName,
		Username:  p.Username,
		PhotoURL:  p.PhotoURL,
		AuthDate:  p.AuthDate,
		Hash:      p.Hash,
	}); err != nil {
		// Translate the auth-domain sentinel into the notify-domain one so
		// the bot dispatcher can keep its single check on notifyDomain.ErrNotFound.
		if errors.Is(err, authDomain.ErrCodeNotFound) {
			return notifyDomain.ErrNotFound
		}
		return fmt.Errorf("monolith.telegramCodeFillerAdapter: %w", err)
	}
	return nil
}
