package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// SetBYOKKey — use-case подключения собственного LLM-ключа. Pipeline:
//  1) валидация provider'а (whitelist);
//  2) ping к провайдеру с min-cost request (BYOKValidator);
//  3) шифрование plain key через AES-256-GCM (BYOKEncryptor);
//  4) Upsert в БД с validated_at=now.
//
// При любом failure'е — error, Upsert не вызывается. Это даёт юзеру быстрый
// feedback типа «ключ не работает» прямо в форме.
type SetBYOKKey struct {
	Repo      domain.BYOKRepo
	Encryptor domain.BYOKEncryptor
	Validator domain.BYOKValidator
	Clock     domain.Clock
	Log       *slog.Logger
}

// NewSetBYOKKey — конструктор. Log обязателен.
func NewSetBYOKKey(repo domain.BYOKRepo, enc domain.BYOKEncryptor, val domain.BYOKValidator, clk domain.Clock, log *slog.Logger) *SetBYOKKey {
	if log == nil {
		panic("subscription.NewSetBYOKKey: logger is required")
	}
	if clk == nil {
		clk = domain.RealClock{}
	}
	return &SetBYOKKey{Repo: repo, Encryptor: enc, Validator: val, Clock: clk, Log: log}
}

// SetBYOKKeyInput — payload.
type SetBYOKKeyInput struct {
	UserID   uuid.UUID
	Provider domain.BYOKProvider
	APIKey   string // plain, передаётся по TLS; немедленно шифруется
}

// Do — основной flow.
func (uc *SetBYOKKey) Do(ctx context.Context, in SetBYOKKeyInput) error {
	if !in.Provider.IsValid() {
		return fmt.Errorf("subscription.SetBYOKKey: %w: %q", domain.ErrInvalidBYOKProvider, in.Provider)
	}
	if strings.TrimSpace(in.APIKey) == "" {
		return fmt.Errorf("subscription.SetBYOKKey: empty api_key")
	}
	// Ping провайдер. Передаём ключ in-memory, никуда не пишем.
	if uc.Validator != nil {
		if err := uc.Validator.Validate(ctx, in.Provider, in.APIKey); err != nil {
			uc.Log.InfoContext(ctx, "subscription.byok.validate_failed",
				slog.String("user_id", in.UserID.String()),
				slog.String("provider", string(in.Provider)),
				slog.Any("err", err))
			return fmt.Errorf("subscription.SetBYOKKey: %w: %v", domain.ErrBYOKValidationFailed, err)
		}
	}
	// Шифруем сразу после успешного validate'а.
	cipher, err := uc.Encryptor.Encrypt(in.APIKey)
	if err != nil {
		return fmt.Errorf("subscription.SetBYOKKey: %w: %v", domain.ErrBYOKEncryption, err)
	}
	now := uc.Clock.Now()
	validatedAt := now
	if err := uc.Repo.Upsert(ctx, domain.BYOKKey{
		UserID:       in.UserID,
		Provider:     in.Provider,
		APIKeyCipher: cipher,
		ValidatedAt:  &validatedAt,
		UpdatedAt:    now,
	}); err != nil {
		return fmt.Errorf("subscription.SetBYOKKey: upsert: %w", err)
	}
	uc.Log.InfoContext(ctx, "subscription.byok.set",
		slog.String("user_id", in.UserID.String()),
		slog.String("provider", string(in.Provider)))
	return nil
}

// RemoveBYOKKey — use-case снятия BYOK-ключа. Idempotent: отсутствие
// записи не error.
type RemoveBYOKKey struct {
	Repo domain.BYOKRepo
	Log  *slog.Logger
}

// NewRemoveBYOKKey — конструктор.
func NewRemoveBYOKKey(repo domain.BYOKRepo, log *slog.Logger) *RemoveBYOKKey {
	if log == nil {
		panic("subscription.NewRemoveBYOKKey: logger is required")
	}
	return &RemoveBYOKKey{Repo: repo, Log: log}
}

// Do удаляет запись. ErrNotFound трактуется как успех (idempotent).
func (uc *RemoveBYOKKey) Do(ctx context.Context, userID uuid.UUID) error {
	if err := uc.Repo.Delete(ctx, userID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil
		}
		return fmt.Errorf("subscription.RemoveBYOKKey: %w", err)
	}
	uc.Log.InfoContext(ctx, "subscription.byok.removed",
		slog.String("user_id", userID.String()))
	return nil
}

