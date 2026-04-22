package services

import (
	"fmt"

	authApp "druz9/auth/app"

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
