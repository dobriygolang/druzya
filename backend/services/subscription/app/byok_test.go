package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"druz9/subscription/domain"
	submocks "druz9/subscription/domain/mocks"
	appmocks "druz9/subscription/app/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// byokStore — закрытая state-машина для domain.BYOKRepo.
type byokStore struct {
	mu  sync.Mutex
	key *domain.BYOKKey
	err error // подмена для read-paths
}

func newBYOKStore() *byokStore { return &byokStore{} }

// wireMockBYOKRepo — domain.BYOKRepo с поведением как у in-memory store.
func wireMockBYOKRepo(ctrl *gomock.Controller, s *byokStore) *submocks.MockBYOKRepo {
	m := submocks.NewMockBYOKRepo(ctrl)
	m.EXPECT().Get(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID) (domain.BYOKKey, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			if s.err != nil {
				return domain.BYOKKey{}, s.err
			}
			if s.key == nil {
				return domain.BYOKKey{}, domain.ErrNotFound
			}
			return *s.key, nil
		},
	).AnyTimes()
	m.EXPECT().Upsert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, k domain.BYOKKey) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.key = &k
			return nil
		},
	).AnyTimes()
	m.EXPECT().Delete(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _ uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.key = nil
			return nil
		},
	).AnyTimes()
	return m
}

// wireMockBYOKEncryptor — pass-through (prepend "enc:"), pure.
func wireMockBYOKEncryptor(ctrl *gomock.Controller) *submocks.MockBYOKEncryptor {
	m := submocks.NewMockBYOKEncryptor(ctrl)
	m.EXPECT().Encrypt(gomock.Any()).DoAndReturn(
		func(plain string) (string, error) { return "enc:" + plain, nil },
	).AnyTimes()
	m.EXPECT().Decrypt(gomock.Any()).DoAndReturn(
		func(cipher string) (string, error) { return cipher, nil },
	).AnyTimes()
	return m
}

// wireMockBYOKValidator — управляемый: возвращает err когда задан.
func wireMockBYOKValidator(ctrl *gomock.Controller, valErr error) *submocks.MockBYOKValidator {
	m := submocks.NewMockBYOKValidator(ctrl)
	m.EXPECT().Validate(gomock.Any(), gomock.Any(), gomock.Any()).Return(valErr).AnyTimes()
	return m
}

func TestSetBYOKKey_Validates_Encrypts_Saves(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := newBYOKStore()
	uc := NewSetBYOKKey(
		wireMockBYOKRepo(ctrl, store),
		wireMockBYOKEncryptor(ctrl),
		wireMockBYOKValidator(ctrl, nil),
		fakeClock{now: time.Now()},
		discardLogger(),
	)
	err := uc.Do(context.Background(), SetBYOKKeyInput{
		UserID:   uuid.New(),
		Provider: domain.BYOKProviderGroq,
		APIKey:   "sk-test-12345",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.key == nil {
		t.Fatal("expected key persisted")
	}
	if store.key.APIKeyCipher != "enc:sk-test-12345" {
		t.Fatalf("key not encrypted: %q", store.key.APIKeyCipher)
	}
	if !store.key.IsActive() {
		t.Fatal("expected ValidatedAt set")
	}
}

func TestSetBYOKKey_RejectsBadProvider(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := NewSetBYOKKey(
		wireMockBYOKRepo(ctrl, newBYOKStore()),
		wireMockBYOKEncryptor(ctrl),
		wireMockBYOKValidator(ctrl, nil),
		fakeClock{now: time.Now()},
		discardLogger(),
	)
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
	ctrl := gomock.NewController(t)
	store := newBYOKStore()
	uc := NewSetBYOKKey(
		wireMockBYOKRepo(ctrl, store),
		wireMockBYOKEncryptor(ctrl),
		wireMockBYOKValidator(ctrl, errors.New("401")),
		fakeClock{now: time.Now()},
		discardLogger(),
	)
	err := uc.Do(context.Background(), SetBYOKKeyInput{
		UserID:   uuid.New(),
		Provider: domain.BYOKProviderOpenAI,
		APIKey:   "sk-bad",
	})
	if !errors.Is(err, domain.ErrBYOKValidationFailed) {
		t.Fatalf("want ErrBYOKValidationFailed, got %v", err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.key != nil {
		t.Fatal("key must not be persisted on validation failure")
	}
}

func TestRemoveBYOKKey_Idempotent(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := newBYOKStore()
	uc := NewRemoveBYOKKey(wireMockBYOKRepo(ctrl, store), discardLogger())
	// первый вызов — нет записи
	if err := uc.Do(context.Background(), uuid.New()); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	// записываем + удаляем
	store.mu.Lock()
	store.key = &domain.BYOKKey{Provider: domain.BYOKProviderGroq}
	store.mu.Unlock()
	if err := uc.Do(context.Background(), uuid.New()); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.key != nil {
		t.Fatal("key must be removed")
	}
}

func TestCheckTier_PaidProWinsOverBYOK(t *testing.T) {
	ctrl := gomock.NewController(t)
	now := time.Now().UTC()
	future := now.Add(24 * time.Hour)
	subStore := &subRepoStore{sub: &domain.Subscription{
		Tier: domain.TierPro, Status: domain.StatusActive, CurrentPeriodEnd: &future,
	}}
	byokStore := &byokStore{key: &domain.BYOKKey{
		Provider: domain.BYOKProviderOpenRouter, ValidatedAt: &now,
	}}
	getTier := NewGetTier(wireMockSubRepo(ctrl, subStore), fakeClock{now: now})
	uc := NewCheckTier(getTier, wireMockBYOKRepo(ctrl, byokStore), nil)
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
	ctrl := gomock.NewController(t)
	now := time.Now().UTC()
	byokStore := &byokStore{key: &domain.BYOKKey{
		Provider: domain.BYOKProviderGroq, ValidatedAt: &now,
	}}
	getTier := NewGetTier(wireMockSubRepo(ctrl, newSubRepoStore()), fakeClock{now: now})
	uc := NewCheckTier(getTier, wireMockBYOKRepo(ctrl, byokStore), nil)
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
	ctrl := gomock.NewController(t)
	getTier := NewGetTier(wireMockSubRepo(ctrl, newSubRepoStore()), fakeClock{now: time.Now()})
	uc := NewCheckTier(getTier, wireMockBYOKRepo(ctrl, newBYOKStore()), nil)
	info, _ := uc.Do(context.Background(), uuid.New())
	if info.Source != SourceFree {
		t.Fatalf("want free, got %s", info.Source)
	}
}

func TestCheckTier_TutorMode_OnlyOverridesFree(t *testing.T) {
	ctrl := gomock.NewController(t)
	tutor := appmocks.NewMockTutorChecker(ctrl)
	tutor.EXPECT().IsTutor(gomock.Any(), gomock.Any()).Return(true, nil).AnyTimes()

	getTier := NewGetTier(wireMockSubRepo(ctrl, newSubRepoStore()), fakeClock{now: time.Now()})
	uc := NewCheckTier(getTier, wireMockBYOKRepo(ctrl, newBYOKStore()), tutor)
	info, _ := uc.Do(context.Background(), uuid.New())
	if info.Source != SourceTutor {
		t.Fatalf("want tutor, got %s", info.Source)
	}
	if info.Tier != domain.TierFree {
		t.Fatalf("tutor mode не платный, tier остаётся free, got %s", info.Tier)
	}
}
