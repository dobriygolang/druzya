package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// BYOKProvider — поддерживаемые провайдеры собственного LLM-ключа. Совпадает
// с шапкой cascade'а LLMChain (groq → cerebras → ... → openrouter), плюс
// anthropic/openai которые принимаются только для BYOK (не входят в free
// cascade). Любая запись вне списка → ErrInvalidBYOKProvider.
type BYOKProvider string

const (
	BYOKProviderOpenRouter BYOKProvider = "openrouter"
	BYOKProviderGroq       BYOKProvider = "groq"
	BYOKProviderCerebras   BYOKProvider = "cerebras"
	BYOKProviderAnthropic  BYOKProvider = "anthropic"
	BYOKProviderOpenAI     BYOKProvider = "openai"
)

// IsValid — проверка перед INSERT'ом. Удерживает мусор за пределами enum'а
// (типа 'gemini' / 'sambanova' — те провайдеры свободные, но мы их не
// проксируем через BYOK gate).
func (p BYOKProvider) IsValid() bool {
	switch p {
	case BYOKProviderOpenRouter, BYOKProviderGroq, BYOKProviderCerebras,
		BYOKProviderAnthropic, BYOKProviderOpenAI:
		return true
	}
	return false
}

// BYOKKey — доменная проекция строки user_byok_keys. APIKeyCipher хранится
// уже зашифрованным (AES-256-GCM); plain key никогда не покидает Encryptor.
// ValidatedAt nil → ключ ещё не прошёл провайдер-validation.
type BYOKKey struct {
	UserID         uuid.UUID
	Provider       BYOKProvider
	APIKeyCipher   string // base64(nonce || sealed)
	ValidatedAt    *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// IsActive — ключ есть и провалидирован. Используется CheckTier UC как
// gate для source='byok'.
func (k BYOKKey) IsActive() bool {
	return k.ValidatedAt != nil
}

// BYOKRepo — persistence port для BYOK-ключей. Две реализации: Postgres
// (prod) и in-memory (тесты).
type BYOKRepo interface {
	// Get возвращает текущий ключ или ErrNotFound (юзер никогда не
	// подключал BYOK).
	Get(ctx context.Context, userID uuid.UUID) (BYOKKey, error)

	// Upsert — идемпотентная запись по (user_id). Перезаписывает
	// предыдущий ключ если был.
	Upsert(ctx context.Context, key BYOKKey) error

	// Delete — снимает BYOK для юзера (откатывается к prior source).
	// Идемпотентно: отсутствие записи не error.
	Delete(ctx context.Context, userID uuid.UUID) error
}

// BYOKEncryptor — port для шифрования/расшифровки plain API key'ев.
// Реализуется AES-256-GCM (infra/byok_encryptor.go).
type BYOKEncryptor interface {
	// Encrypt принимает plain ключ и возвращает base64-encoded
	// (nonce || ciphertext). Pure function — без I/O.
	Encrypt(plain string) (string, error)
	// Decrypt разворачивает обратно. Нужен только для test-validation
	// при revalidate (не реализован в MVP — храним только zero-knowledge
	// проверку «есть валидный ключ»).
	Decrypt(cipher string) (string, error)
}

// BYOKValidator — port для проверки ключа против провайдер-endpoint'а
// (минимальный 1-token request). Реализация в infra; tests инжектят stub.
type BYOKValidator interface {
	// Validate отправляет min-cost request к провайдеру с этим ключом.
	// nil = ключ работает. Error = invalid/rate-limited/network-down;
	// caller трактует любой error как «ключ не принят».
	Validate(ctx context.Context, provider BYOKProvider, plainKey string) error
}
