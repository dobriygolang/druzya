// byok_encryptor.go — AES-256-GCM шифрование BYOK API key'ев.
// Зеркалит pattern из services/auth/infra/encryptor.go: SHA-256 stretch
// → 32-byte AES key → GCM-AEAD; output = base64(nonce || sealed).
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

// BYOKEncryptor реализует domain.BYOKEncryptor поверх AES-256-GCM.
type BYOKEncryptor struct {
	gcm cipher.AEAD
}

// NewBYOKEncryptor — конструктор. Если secret пустой — возвращает ошибку
// (callee на bootstrap может fallback'нуться на generated random key с
// warning'ом). NB: ключи зашифрованные одним secret'ом нельзя расшифровать
// другим, поэтому при ротации key'а нужна re-encryption миграция (out of
// MVP scope).
func NewBYOKEncryptor(secret string) (*BYOKEncryptor, error) {
	if secret == "" {
		return nil, fmt.Errorf("subscription.byok: empty BYOK_ENCRYPTION_KEY")
	}
	sum := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, fmt.Errorf("subscription.byok: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("subscription.byok: new gcm: %w", err)
	}
	return &BYOKEncryptor{gcm: gcm}, nil
}

// Encrypt возвращает base64-encoded (nonce || ciphertext).
func (e *BYOKEncryptor) Encrypt(plain string) (string, error) {
	if plain == "" {
		return "", fmt.Errorf("subscription.byok: empty plaintext")
	}
	nonce := make([]byte, e.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("subscription.byok: read nonce: %w", err)
	}
	sealed := e.gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt обратная операция. В MVP не дёргается (мы не достаём plain ключ
// обратно), но порт реализован для будущих use case'ов.
func (e *BYOKEncryptor) Decrypt(ct string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(ct)
	if err != nil {
		return "", fmt.Errorf("subscription.byok: base64 decode: %w", err)
	}
	n := e.gcm.NonceSize()
	if len(raw) < n {
		return "", fmt.Errorf("subscription.byok: ciphertext too short")
	}
	nonce, sealed := raw[:n], raw[n:]
	pt, err := e.gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("subscription.byok: gcm.Open: %w", err)
	}
	return string(pt), nil
}
