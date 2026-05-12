// verifiers.go — token verifiers used by per-domain WS handlers.
//
// Each domain (arena, ai_mock, editor, whiteboard) defines its own narrow
// Verifier interface in its ports package; this file provides one
// implementation per domain that delegates to authApp.TokenIssuer. They
// live together here (auth wiring package) so the JWT-parsing helpers
// stay in one place — they're inherently auth concerns and previously
// lived in monolith services/adapters.go (split out for clarity).
package auth

import (
	"fmt"

	authApp "druz9/auth/app"

	"github.com/google/uuid"
)

// ArenaTokenVerifier — implements arena/ports.AccessVerifier.
type ArenaTokenVerifier struct{ Issuer *authApp.TokenIssuer }

func (a ArenaTokenVerifier) VerifyAccess(raw string) (uuid.UUID, error) {
	return parseSubject(a.Issuer, raw)
}

// MockTokenVerifier — implements ai_mock/ports.Verifier.
type MockTokenVerifier struct{ Issuer *authApp.TokenIssuer }

func (a MockTokenVerifier) Verify(raw string) (uuid.UUID, error) {
	return parseSubject(a.Issuer, raw)
}

// EditorTokenVerifier — implements editor/ports.Verifier.
type EditorTokenVerifier struct{ Issuer *authApp.TokenIssuer }

func (a EditorTokenVerifier) Verify(raw string) (uuid.UUID, error) {
	return parseSubject(a.Issuer, raw)
}

func (a EditorTokenVerifier) VerifyScoped(raw, expectedScope string) (uuid.UUID, error) {
	return parseSubjectScoped(a.Issuer, raw, expectedScope)
}

func (a EditorTokenVerifier) VerifyScopedFull(raw, expectedScope string) (uuid.UUID, string, string, error) {
	return parseSubjectScopedFull(a.Issuer, raw, expectedScope)
}

// TranscriptionTokenVerifier — implements transcription/ports.TokenVerifier.
// Used by the WS streaming endpoint to authenticate the bearer in the
// query-string (?token=) handshake.
type TranscriptionTokenVerifier struct{ Issuer *authApp.TokenIssuer }

func (a TranscriptionTokenVerifier) Verify(raw string) (uuid.UUID, error) {
	return parseSubject(a.Issuer, raw)
}

// WhiteboardTokenVerifier removed 2026-05-12 (D4/Stream F) — WS handshake
// gone; whiteboard solo mode uses standard Connect-RPC auth.
// EditorTokenVerifier также станет unused когда editor WS теплится off;
// см. cmd/monolith/services/editor/editor.go.

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

// parseSubjectScoped — same as parseSubject plus a JWT.Scope check.
// Empty Scope in the token → unrestricted (regular user-token), accept all.
// Non-empty Scope → must EXACTLY match expectedScope, otherwise reject.
//
// expectedScope is built on the resource-handler side as
// "<kind>:<resource_id>" — e.g. "editor:550e8400-..." or
// "whiteboard:550e8400-...". See MintScoped in auth/app/tokens.go.
func parseSubjectScoped(issuer *authApp.TokenIssuer, raw, expectedScope string) (uuid.UUID, error) {
	claims, err := issuer.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse access token: %w", err)
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, fmt.Errorf("parse subject uuid: %w", err)
	}
	if claims.Scope != "" && claims.Scope != expectedScope {
		return uuid.Nil, fmt.Errorf("token scope mismatch: have %q, want %q", claims.Scope, expectedScope)
	}
	return uid, nil
}

// parseSubjectScopedFull — extended parseSubjectScoped that also returns
// the role + display-name claims. Used by WS handlers to skip the
// participants-row auto-join for guest tokens (their UUID is transient
// and never gets a row in users — would FK-fail on insert).
func parseSubjectScopedFull(issuer *authApp.TokenIssuer, raw, expectedScope string) (uuid.UUID, string, string, error) {
	claims, err := issuer.Parse(raw)
	if err != nil {
		return uuid.Nil, "", "", fmt.Errorf("parse access token: %w", err)
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, "", "", fmt.Errorf("parse subject uuid: %w", err)
	}
	if claims.Scope != "" && claims.Scope != expectedScope {
		return uuid.Nil, "", "", fmt.Errorf("token scope mismatch: have %q, want %q", claims.Scope, expectedScope)
	}
	return uid, string(claims.Role), claims.DisplayName, nil
}
