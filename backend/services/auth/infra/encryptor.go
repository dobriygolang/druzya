package infra

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"io"
)

// AESGCMEncryptor implements app.TokenEncryptor with AES-256-GCM as required
// by bible §11 ("OAuth tokens: AES-256 шифрование в БД").
//
// The input key is SHA-256-stretched so any ENCRYPTION_KEY length produces
// a 32-byte AES-256 key. The ciphertext layout is: [12-byte nonce || sealed].
type AESGCMEncryptor struct {
	gcm cipher.AEAD
}

// NewAESGCMEncryptor panics if the crypto primitives fail to initialise — they
// only fail with pathologically broken keys, so panic = fail-fast at boot.
func NewAESGCMEncryptor(secret string) (*AESGCMEncryptor, error) {
	if secret == "" {
		// STUB: swap for strict key loading once a secrets manager is wired.
		// Using an empty placeholder would silently downgrade security; we
		// error fast instead.
		return nil, fmt.Errorf("auth.AESGCMEncryptor: empty ENCRYPTION_KEY")
	}
	sum := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, fmt.Errorf("auth.AESGCMEncryptor: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("auth.AESGCMEncryptor: new gcm: %w", err)
	}
	return &AESGCMEncryptor{gcm: gcm}, nil
}

// Encrypt returns nonce||ciphertext. Safe to persist as BYTEA.
func (e *AESGCMEncryptor) Encrypt(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, nil
	}
	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("auth.AESGCMEncryptor.Encrypt: read nonce: %w", err)
	}
	return e.gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// Decrypt reverses Encrypt. Not used yet — tokens are write-only for the auth
// flow; the profile domain will wire this if/when it needs to refresh Yandex
// tokens on the user's behalf.
// STUB: expose on a separate TokenDecryptor interface when first consumed.
func (e *AESGCMEncryptor) Decrypt(ct []byte) ([]byte, error) {
	n := e.gcm.NonceSize()
	if len(ct) < n {
		return nil, fmt.Errorf("auth.AESGCMEncryptor.Decrypt: ciphertext too short")
	}
	nonce, sealed := ct[:n], ct[n:]
	pt, err := e.gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return nil, fmt.Errorf("auth.AESGCMEncryptor.Decrypt: %w", err)
	}
	return pt, nil
}
