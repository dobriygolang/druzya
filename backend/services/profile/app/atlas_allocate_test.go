package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/profile/domain"
	"druz9/profile/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestAllocateAtlasNode_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	now := time.Now()
	repo.EXPECT().UpsertSkillNode(gomock.Any(), uid, "two-pointers", AtlasAllocateStarterProgress).
		Return(domain.SkillNode{
			NodeKey:    "two-pointers",
			Progress:   AtlasAllocateStarterProgress,
			UnlockedAt: &now,
			UpdatedAt:  now,
		}, nil)
	uc := NewAllocateAtlasNode(repo, quietLogger())
	out, err := uc.Do(context.Background(), uid, "two-pointers")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.NodeKey != "two-pointers" || out.Progress != AtlasAllocateStarterProgress {
		t.Fatalf("unexpected output: %+v", out)
	}
	if out.UnlockedAt == nil {
		t.Fatal("expected unlocked_at populated")
	}
}

func TestAllocateAtlasNode_IdempotentReallocation(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	now := time.Now()
	// Repo's GREATEST(stored, incoming) means a re-allocate over an existing
	// row at progress=42 keeps 42, not 5. Use case must surface this without
	// wrapping it as an error — re-allocation is a no-op success.
	repo.EXPECT().UpsertSkillNode(gomock.Any(), uid, "go-channels", AtlasAllocateStarterProgress).
		Return(domain.SkillNode{
			NodeKey:    "go-channels",
			Progress:   42,
			UnlockedAt: &now,
			UpdatedAt:  now,
		}, nil)
	uc := NewAllocateAtlasNode(repo, quietLogger())
	out, err := uc.Do(context.Background(), uid, "go-channels")
	if err != nil {
		t.Fatalf("re-allocate must be a no-op success, got: %v", err)
	}
	if out.Progress != 42 {
		t.Fatalf("re-allocate must not regress progress, got %d", out.Progress)
	}
}

func TestAllocateAtlasNode_EmptySkillIDIsErrInvalid(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	// Repo MUST NOT be called when validation fails.
	uc := NewAllocateAtlasNode(repo, quietLogger())
	for _, badID := range []string{"", "   ", "\t"} {
		_, err := uc.Do(context.Background(), uuid.New(), badID)
		if err == nil {
			t.Fatalf("expected ErrInvalid for %q", badID)
		}
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("expected ErrInvalid, got %v", err)
		}
	}
}

func TestAllocateAtlasNode_UnknownSkillIsErrNotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().UpsertSkillNode(gomock.Any(), uid, "imaginary", AtlasAllocateStarterProgress).
		Return(domain.SkillNode{}, domain.ErrNotFound)
	uc := NewAllocateAtlasNode(repo, quietLogger())
	_, err := uc.Do(context.Background(), uid, "imaginary")
	if err == nil {
		t.Fatal("expected ErrNotFound bubble-up")
	}
	if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected wrapped ErrNotFound, got %v", err)
	}
}

func TestNewAllocateAtlasNode_NilDepsPanic(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	mustPanic(t, func() { NewAllocateAtlasNode(nil, quietLogger()) })
	mustPanic(t, func() { NewAllocateAtlasNode(repo, nil) })
}

func mustPanic(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic, got none")
		}
	}()
	fn()
}
