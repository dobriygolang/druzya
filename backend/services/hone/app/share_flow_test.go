package app_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/hone/app"
	"druz9/hone/domain"
	"druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestShareToWeb_GeneratesSlugAndPersists(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	noteID := uuid.New()

	repo := mocks.NewMockPublishRepo(ctrl)
	repo.EXPECT().LookupForPublish(gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.PublishLookup{Encrypted: true}, nil,
	)
	var gotPlaintext, gotSlug string
	var gotNoteID uuid.UUID
	repo.EXPECT().ShareToWebAtomic(gomock.Any(), gomock.Any(), noteID, gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, n uuid.UUID, plaintextMD, slug string) (time.Time, error) {
			gotNoteID = n
			gotPlaintext = plaintextMD
			gotSlug = slug
			return time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC), nil
		},
	)

	uc := &app.ShareToWeb{Repo: repo, SlugGen: func() (string, error) { return "abcdef012345", nil }}
	out, err := uc.Do(context.Background(), app.ShareToWebInput{
		UserID:      uuid.New(),
		NoteID:      noteID,
		PlaintextMD: "hello world",
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if out.Slug != "abcdef012345" {
		t.Fatalf("slug = %q, want abcdef012345", out.Slug)
	}
	if gotPlaintext != "hello world" {
		t.Fatalf("plaintext not threaded through: %q", gotPlaintext)
	}
	if gotNoteID != noteID {
		t.Fatalf("noteID mismatch")
	}
	_ = gotSlug
}

func TestShareToWeb_RetriesOnSlugCollision(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockPublishRepo(ctrl)
	repo.EXPECT().LookupForPublish(gomock.Any(), gomock.Any(), gomock.Any()).Return(
		domain.PublishLookup{Encrypted: true}, nil,
	).AnyTimes()

	calls := 0
	shareCalls := 0
	repo.EXPECT().ShareToWebAtomic(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, _, _ uuid.UUID, _, slug string) (time.Time, error) {
			shareCalls++
			if slug == "fresh" {
				return time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC), nil
			}
			return time.Time{}, domain.ErrPublishSlugCollision
		},
	).AnyTimes()

	uc := &app.ShareToWeb{
		Repo: repo,
		SlugGen: func() (string, error) {
			calls++
			if calls < 3 {
				return "collide", nil
			}
			return "fresh", nil
		},
	}
	out, err := uc.Do(context.Background(), app.ShareToWebInput{
		UserID:      uuid.New(),
		NoteID:      uuid.New(),
		PlaintextMD: "x",
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if out.Slug != "fresh" {
		t.Fatalf("slug = %q, want fresh", out.Slug)
	}
	if shareCalls != 3 {
		t.Fatalf("shareCalls = %d, want 3", shareCalls)
	}
}

func TestMakePrivate_RejectsEmptyCiphertext(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockPublishRepo(ctrl)
	// MakePrivateAtomic must NOT be called — gomock auto-fails on unexpected calls.
	uc := &app.MakePrivate{Repo: repo}
	err := uc.Do(context.Background(), app.MakePrivateInput{
		UserID: uuid.New(),
		NoteID: uuid.New(),
	})
	if !errors.Is(err, app.ErrMakePrivateEmptyCiphertext) {
		t.Fatalf("err = %v, want ErrMakePrivateEmptyCiphertext", err)
	}
}

func TestMakePrivate_PersistsCiphertext(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	noteID := uuid.New()
	var gotNoteID uuid.UUID
	var gotCipher string
	repo := mocks.NewMockPublishRepo(ctrl)
	repo.EXPECT().MakePrivateAtomic(gomock.Any(), gomock.Any(), noteID, gomock.Any()).DoAndReturn(
		func(_ context.Context, _, n uuid.UUID, ciphertextB64 string) error {
			gotNoteID = n
			gotCipher = ciphertextB64
			return nil
		},
	)
	uc := &app.MakePrivate{Repo: repo}
	err := uc.Do(context.Background(), app.MakePrivateInput{
		UserID:        uuid.New(),
		NoteID:        noteID,
		CiphertextB64: "aGVsbG8=",
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if gotCipher != "aGVsbG8=" {
		t.Fatalf("ciphertext mismatch: %q", gotCipher)
	}
	if gotNoteID != noteID {
		t.Fatalf("noteID mismatch")
	}
}
