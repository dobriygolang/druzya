package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// fakeBYOKRepo — in-memory реализация domain.BYOKRepo.
type fakeBYOKRepo struct {
	key *domain.BYOKKey
	err error // подмена для read-paths
}

func (r *fakeBYOKRepo) Get(_ context.Context, _ uuid.UUID) (domain.BYOKKey, error) {
	if r.err != nil {
		return domain.BYOKKey{}, r.err
	}
	if r.key == nil {
		return domain.BYOKKey{}, domain.ErrNotFound
	}
	return *r.key, nil
}

func (r *fakeBYOKRepo) Upsert(_ context.Context, k domain.BYOKKey) error {
	r.key = &k
	return nil
}

func (r *fakeBYOKRepo) Delete(_ context.Context, _ uuid.UUID) error {
	r.key = nil
	return nil
}

// fakeEncryptor — pass-through (хранит plain в "cipher"); только для unit-тестов.
type fakeEncryptor struct{}

func (fakeEncryptor) Encrypt(plain string) (string, error)  { return "enc:" + plain, nil }
func (fakeEncryptor) Decrypt(cipher string) (string, error) { return cipher, nil }

// fakeValidator — управляемый validator: возвращает err, если задан.
type fakeValidator struct{ err error }

func (v fakeValidator) Validate(_ context.Context, _ domain.BYOKProvider, _ string) error {
	return v.err
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestSetBYOKKey_Validates_Encrypts_Saves(t *testing.T) {
	repo := &fakeBYOKRepo{}
	uc := NewSetBYOKKey(repo, fakeEncryptor{}, fakeValidator{}, fakeClock{now: time.Now()}, discardLogger())
	err := uc.Do(context.Background(), SetBYOKKeyInput{
		UserID:   uuid.New(),
		Provider: domain.BYOKProviderGroq,
		APIKey:   "sk-test-12345",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if repo.key == nil {
		t.Fatal("expected key persisted")
	}
	if repo.key.APIKeyCipher != "enc:sk-test-12345" {
		t.Fatalf("key not encrypted: %q", repo.key.APIKeyCipher)
	}
	if !repo.key.IsActive() {
		t.Fatal("expected ValidatedAt set")
	}
}

func TestSetBYOKKey_RejectsBadProvider(t *testing.T) {
	uc := NewSetBYOKKey(&fakeBYOKRepo{}, fakeEncryptor{}, fakeValidator{}, fakeClock{now: time.Now()}, discardLogger())
	err := uc.Do(context.Background(), SetBYOKKeyInput{
		UserID:   uuid.New(),
		Provider: domain.BYOKProvider("hotmail"),
		APIKey:   "x",
	})
	if !errors.Is(err, domain.ErrInvalidBYOKProvider) {
		t.Fatalf("want ErrInvalidBYOKProvider, got %v", err)
	}
}

func TestSetBYOKKey_FailsOnValidator(t *testing.T) {
	repo := &fakeBYOKRepo{}
	uc := NewSetBYOKKey(repo, fakeEncryptor{}, fakeValidator{err: errors.New("401")}, fakeClock{now: time.Now()}, discardLogger())
	err := uc.Do(context.Background(), SetBYOKKeyInput{
		UserID:   uuid.New(),
		Provider: domain.BYOKProviderOpenAI,
		APIKey:   "sk-bad",
	})
	if !errors.Is(err, domain.ErrBYOKValidationFailed) {
		t.Fatalf("want ErrBYOKValidationFailed, got %v", err)
	}
	if repo.key != nil {
		t.Fatal("key must not be persisted on validation failure")
	}
}

func TestRemoveBYOKKey_Idempotent(t *testing.T) {
	repo := &fakeBYOKRepo{}
	uc := NewRemoveBYOKKey(repo, discardLogger())
	// первый вызов — нет записи
	if err := uc.Do(context.Background(), uuid.New()); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// записываем + удаляем
	repo.key = &domain.BYOKKey{Provider: domain.BYOKProviderGroq}
	if err := uc.Do(context.Background(), uuid.New()); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if repo.key != nil {
		t.Fatal("key must be removed")
	}
}

func TestCheckTier_PaidProWinsOverBYOK(t *testing.T) {
	now := time.Now().UTC()
	future := now.Add(24 * time.Hour)
	subRepo := &fakeRepo{sub: &domain.Subscription{
		Tier: domain.TierPro, Status: domain.StatusActive, CurrentPeriodEnd: &future,
	}}
	byokRepo := &fakeBYOKRepo{key: &domain.BYOKKey{
		Provider: domain.BYOKProviderOpenRouter, ValidatedAt: &now,
	}}
	getTier := NewGetTier(subRepo, fakeClock{now: now})
	uc := NewCheckTier(getTier, byokRepo, nil)
	info, err := uc.Do(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if info.Source != SourcePro {
		t.Fatalf("paid pro must dominate, got source=%s", info.Source)
	}
	if info.Tier != domain.TierPro {
		t.Fatalf("want pro, got %s", info.Tier)
	}
}

func TestCheckTier_BYOKActive_NoPaidPro(t *testing.T) {
	now := time.Now().UTC()
	subRepo := &fakeRepo{} // нет подписки
	byokRepo := &fakeBYOKRepo{key: &domain.BYOKKey{
		Provider: domain.BYOKProviderGroq, ValidatedAt: &now,
	}}
	getTier := NewGetTier(subRepo, fakeClock{now: now})
	uc := NewCheckTier(getTier, byokRepo, nil)
	info, _ := uc.Do(context.Background(), uuid.New())
	if info.Source != SourceBYOK {
		t.Fatalf("want byok source, got %s", info.Source)
	}
	if info.Tier != domain.TierPro {
		t.Fatalf("byok unlocks pro, got %s", info.Tier)
	}
	if info.BYOKProvider != domain.BYOKProviderGroq {
		t.Fatalf("provider lost in projection: %s", info.BYOKProvider)
	}
}

func TestCheckTier_NoSubNoBYOK_ReturnsFree(t *testing.T) {
	getTier := NewGetTier(&fakeRepo{}, fakeClock{now: time.Now()})
	uc := NewCheckTier(getTier, &fakeBYOKRepo{}, nil)
	info, _ := uc.Do(context.Background(), uuid.New())
	if info.Source != SourceFree {
		t.Fatalf("want free, got %s", info.Source)
	}
}

// stubTutor — управляемая реализация TutorChecker.
type stubTutor struct{ is bool }

func (s stubTutor) IsTutor(_ context.Context, _ uuid.UUID) (bool, error) { return s.is, nil }

func TestCheckTier_TutorMode_OnlyOverridesFree(t *testing.T) {
	getTier := NewGetTier(&fakeRepo{}, fakeClock{now: time.Now()})
	uc := NewCheckTier(getTier, &fakeBYOKRepo{}, stubTutor{is: true})
	info, _ := uc.Do(context.Background(), uuid.New())
	if info.Source != SourceTutor {
		t.Fatalf("want tutor, got %s", info.Source)
	}
	if info.Tier != domain.TierFree {
		t.Fatalf("tutor mode не платный, tier остаётся free, got %s", info.Tier)
	}
}
