// Package app — Private Vault E2E use cases.
package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// vaultSaltBytes — 16 random bytes (NIST SP 800-132 минимум для PBKDF2).
const vaultSaltBytes = 16

// VaultInit — idempotent: создаёт salt если у юзера ещё нет, иначе
// возвращает existing. Race-safe (atomic UPDATE … WHERE salt IS NULL).
type VaultInit struct {
	Repo domain.VaultRepo
	Log  *slog.Logger
	// SaltGen — фабрика salt-bytes. nil → дефолт crypto/rand.
	SaltGen func() ([]byte, error)
}

// VaultInitInput.
type VaultInitInput struct {
	UserID uuid.UUID
}

// VaultInitOutput.
type VaultInitOutput struct {
	SaltB64     string
	Initialized bool // true если salt существовал до этого call'а
}

// Do executes the use case.
func (uc *VaultInit) Do(ctx context.Context, in VaultInitInput) (VaultInitOutput, error) {
	gen := uc.SaltGen
	if gen == nil {
		gen = generateVaultSalt
	}
	salt, gerr := gen()
	if gerr != nil {
		return VaultInitOutput{}, fmt.Errorf("hone.VaultInit.Do: gen: %w", gerr)
	}
	existing, wasInitialized, err := uc.Repo.EnsureSalt(ctx, in.UserID, salt)
	if err != nil {
		return VaultInitOutput{}, fmt.Errorf("hone.VaultInit.Do: %w", err)
	}
	return VaultInitOutput{
		SaltB64:     base64.StdEncoding.EncodeToString(existing),
		Initialized: wasInitialized,
	}, nil
}

func generateVaultSalt() ([]byte, error) {
	b := make([]byte, vaultSaltBytes)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("hone.generateVaultSalt: %w", err)
	}
	return b, nil
}

// ─── VaultGetSalt ─────────────────────────────────────────────────────────

// ErrVaultNotInitialized — юзер существует, salt не выставлен (404
// "vault_not_initialized" на HTTP).
var ErrVaultNotInitialized = errors.New("hone: vault not initialized")

// VaultGetSalt — возврат существующего salt'а. ErrNotFound → юзера нет;
// ErrVaultNotInitialized → юзер есть, salt nil.
type VaultGetSalt struct {
	Repo domain.VaultRepo
	Log  *slog.Logger
}

// VaultGetSaltInput.
type VaultGetSaltInput struct {
	UserID uuid.UUID
}

// VaultGetSaltOutput.
type VaultGetSaltOutput struct {
	SaltB64 string
}

// Do executes the use case.
func (uc *VaultGetSalt) Do(ctx context.Context, in VaultGetSaltInput) (VaultGetSaltOutput, error) {
	salt, err := uc.Repo.GetSalt(ctx, in.UserID)
	if err != nil {
		return VaultGetSaltOutput{}, fmt.Errorf("hone.VaultGetSalt.Do: %w", err)
	}
	if salt == nil {
		return VaultGetSaltOutput{}, ErrVaultNotInitialized
	}
	return VaultGetSaltOutput{SaltB64: base64.StdEncoding.EncodeToString(salt)}, nil
}

// ─── VaultEncryptNote ─────────────────────────────────────────────────────

// ErrVaultBadCiphertext — base64 decode failed.
var ErrVaultBadCiphertext = errors.New("hone: bad ciphertext base64")

// ErrVaultEmptyCiphertext — пустой ciphertext.
var ErrVaultEmptyCiphertext = errors.New("hone: empty ciphertext")

// VaultEncryptNote — atomic: replace body, mark encrypted, wipe embedding,
// force-unpublish. После успеха вызывает Publisher.PublishSyncChange (если
// задан) для realtime fan-out на other devices юзера.
type VaultEncryptNote struct {
	Repo      domain.VaultRepo
	Publisher domain.SyncEventPublisher // optional; nil → no realtime push
	Log       *slog.Logger
}

// VaultEncryptNoteInput.
type VaultEncryptNoteInput struct {
	UserID         uuid.UUID
	NoteID         uuid.UUID
	CiphertextB64  string
	OriginDeviceID uuid.UUID // uuid.Nil → no device tag
}

// Do executes the use case.
func (uc *VaultEncryptNote) Do(ctx context.Context, in VaultEncryptNoteInput) error {
	if in.CiphertextB64 == "" {
		return ErrVaultEmptyCiphertext
	}
	if _, derr := base64.StdEncoding.DecodeString(in.CiphertextB64); derr != nil {
		return ErrVaultBadCiphertext
	}
	if err := uc.Repo.EncryptNote(ctx, in.UserID, in.NoteID, in.CiphertextB64); err != nil {
		return fmt.Errorf("hone.VaultEncryptNote.Do: %w", err)
	}
	if uc.Publisher != nil {
		uc.Publisher.PublishSyncChange(in.UserID, "hone_notes", in.OriginDeviceID)
	}
	return nil
}

// ─── VaultDecryptNote ─────────────────────────────────────────────────────

// VaultDecryptNote — flips encrypted=false, replaces body. Embedding
// re-queue делается отдельно через UpdateNote.
type VaultDecryptNote struct {
	Repo      domain.VaultRepo
	Publisher domain.SyncEventPublisher
	Log       *slog.Logger
}

// VaultDecryptNoteInput.
type VaultDecryptNoteInput struct {
	UserID         uuid.UUID
	NoteID         uuid.UUID
	BodyMD         string
	OriginDeviceID uuid.UUID
}

// Do executes the use case.
func (uc *VaultDecryptNote) Do(ctx context.Context, in VaultDecryptNoteInput) error {
	if err := uc.Repo.DecryptNote(ctx, in.UserID, in.NoteID, in.BodyMD); err != nil {
		return fmt.Errorf("hone.VaultDecryptNote.Do: %w", err)
	}
	if uc.Publisher != nil {
		uc.Publisher.PublishSyncChange(in.UserID, "hone_notes", in.OriginDeviceID)
	}
	return nil
}
