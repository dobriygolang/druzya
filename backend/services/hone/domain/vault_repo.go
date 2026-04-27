package domain

import (
	"context"

	"github.com/google/uuid"
)

// VaultRepo — Phase C-7 zero-knowledge vault salt + ciphertext-write helpers.
// Server держит per-user random salt в users.vault_kdf_salt и принимает
// ciphertext'ы для отдельных заметок (encrypted=true).
type VaultRepo interface {
	// EnsureSalt пытается атомарно записать новый salt. Возвращает
	// (existingSalt, wasInitialized). wasInitialized=true → salt уже был,
	// existing вернулся как есть. wasInitialized=false → записан newSalt,
	// existing=newSalt.
	EnsureSalt(ctx context.Context, userID uuid.UUID, newSalt []byte) (existing []byte, wasInitialized bool, err error)

	// GetSalt читает существующий salt. ErrNotFound — юзера нет; (nil, nil)
	// — юзер есть, vault не initialised (caller возвращает 404
	// "vault_not_initialized").
	GetSalt(ctx context.Context, userID uuid.UUID) ([]byte, error)

	// EncryptNote атомарно: body_md=ciphertext, encrypted=true, embedding/
	// publication обнуляются. ErrNotFound — note нет.
	EncryptNote(ctx context.Context, userID, noteID uuid.UUID, ciphertextB64 string) error

	// DecryptNote: body_md=plaintext, encrypted=false. ErrNotFound — note нет.
	DecryptNote(ctx context.Context, userID, noteID uuid.UUID, plaintextMD string) error
}
