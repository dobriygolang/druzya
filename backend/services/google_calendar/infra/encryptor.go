// encryptor.go — AES-256-GCM шифрование OAuth-tokens. Mirrors pattern из
// services/subscription/infra/byok_encryptor.go: SHA-256 → 32-byte AES key
// → GCM-AEAD; output = base64(nonce || sealed).
package infra

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
)

type Encryptor struct {
	gcm cipher.AEAD
}

// NewEncryptor — конструктор. Пустой secret → error; bootstrap может
// fallback'нуться на random key с warning'ом, но тогда после рестарта все
// токены протухнут — приемлемо для local dev, прод обязан задать env.
func NewEncryptor(secret string) (*Encryptor, error) {
	if secret == "" {
		return nil, fmt.Errorf("google_calendar.Encryptor: empty secret")
	}
	sum := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, fmt.Errorf("google_calendar.Encryptor: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("google_calendar.Encryptor: new gcm: %w", err)
	}
	return &Encryptor{gcm: gcm}, nil
}

// Encrypt возвращает base64(nonce || sealed).
func (e *Encryptor) Encrypt(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("google_calendar.Encryptor: read nonce: %w", err)
	}
	sealed := e.gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func (e *Encryptor) Decrypt(ct string) (string, error) {
	if ct == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(ct)
	if err != nil {
		return "", fmt.Errorf("google_calendar.Encryptor: base64: %w", err)
	}
	n := e.gcm.NonceSize()
	if len(raw) < n {
		return "", fmt.Errorf("google_calendar.Encryptor: ciphertext too short")
	}
	nonce, sealed := raw[:n], raw[n:]
	pt, err := e.gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("google_calendar.Encryptor: gcm.Open: %w", err)
	}
	return string(pt), nil
}
