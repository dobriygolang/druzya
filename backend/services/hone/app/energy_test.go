package app

import (
	"context"
	"errors"
	"testing"

	"druz9/hone/domain"
	"druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestLogEnergy_RejectsOutOfRange(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	repo := mocks.NewMockEnergyRepo(ctrl)
	uc := LogEnergy{Energy: repo}

	for _, level := range []int{0, -1, 6, 99} {
		_, err := uc.Do(context.Background(), LogEnergyInput{
			UserID: uuid.New(), Level: level,
		})
		if err == nil {
			t.Fatalf("expected error for level=%d, got nil", level)
		}
		if !errors.Is(err, domain.ErrInvalidInput) {
			t.Fatalf("expected ErrInvalidInput for level=%d, got %v", level, err)
		}
	}
}

func TestLogEnergy_AcceptsValidLevel(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	repo := mocks.NewMockEnergyRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		Return(domain.EnergyLog{UserID: uid, Level: 3, Note: "hi"}, nil)

	uc := LogEnergy{Energy: repo}
	out, err := uc.Do(context.Background(), LogEnergyInput{
		UserID: uid, Level: 3, Note: "hi",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Level != 3 {
		t.Fatalf("unexpected output level: %d", out.Level)
	}
}
