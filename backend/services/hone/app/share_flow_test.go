package app_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/hone/app"
	"druz9/hone/domain"

	"github.com/google/uuid"
)

// fakePublishRepo — in-memory PublishRepo для тестов use-cases.
type fakePublishRepo struct {
	shareCalls   int
	privateCalls int
	shareErr     error
	privateErr   error

	// Snapshot of last-call args for assertions.
	lastShareNoteID    uuid.UUID
	lastSharePlaintext string
	lastShareSlug      string
	lastPrivateNoteID  uuid.UUID
	lastPrivateCipher  string
}

func (r *fakePublishRepo) LookupForPublish(_ context.Context, _, _ uuid.UUID) (domain.PublishLookup, error) {
	return domain.PublishLookup{Encrypted: true}, nil
}
func (r *fakePublishRepo) SetPublishSlug(_ context.Context, _, _ uuid.UUID, _ string) (string, time.Time, error) {
	return "", time.Time{}, errors.New("not used")
}
func (r *fakePublishRepo) ClearPublish(_ context.Context, _, _ uuid.UUID) error { return nil }
func (r *fakePublishRepo) GetPublishStatus(_ context.Context, _, _ uuid.UUID) (*string, *time.Time, error) {
	return nil, nil, nil
}
func (r *fakePublishRepo) ListNotesMeta(_ context.Context, _ uuid.UUID) ([]domain.NoteMeta, error) {
	return nil, nil
}
func (r *fakePublishRepo) GetPublicView(_ context.Context, _ string) (string, string, time.Time, error) {
	return "", "", time.Time{}, nil
}

func (r *fakePublishRepo) ShareToWebAtomic(_ context.Context, _, noteID uuid.UUID, plaintextMD, slug string) (time.Time, error) {
	r.shareCalls++
	r.lastShareNoteID = noteID
	r.lastSharePlaintext = plaintextMD
	r.lastShareSlug = slug
	if r.shareErr != nil {
		return time.Time{}, r.shareErr
	}
	return time.Date(2026, 4, 28, 12, 0, 0, 0, time.UTC), nil
}

func (r *fakePublishRepo) MakePrivateAtomic(_ context.Context, _, noteID uuid.UUID, ciphertextB64 string) error {
	r.privateCalls++
	r.lastPrivateNoteID = noteID
	r.lastPrivateCipher = ciphertextB64
	return r.privateErr
}

func TestShareToWeb_GeneratesSlugAndPersists(t *testing.T) {
	t.Parallel()
	repo := &fakePublishRepo{}
	uc := &app.ShareToWeb{Repo: repo, SlugGen: func() (string, error) { return "abcdef012345", nil }}
	noteID := uuid.New()
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
	if repo.shareCalls != 1 {
		t.Fatalf("shareCalls = %d, want 1", repo.shareCalls)
	}
	if repo.lastSharePlaintext != "hello world" {
		t.Fatalf("plaintext not threaded through: %q", repo.lastSharePlaintext)
	}
	if repo.lastShareNoteID != noteID {
		t.Fatalf("noteID mismatch")
	}
}

func TestShareToWeb_RetriesOnSlugCollision(t *testing.T) {
	t.Parallel()
	calls := 0
	repo := &fakePublishRepo{}
	repo.shareErr = domain.ErrPublishSlugCollision
	uc := &app.ShareToWeb{
		Repo: repo,
		SlugGen: func() (string, error) {
			calls++
			if calls < 3 {
				return "collide", nil
			}
			// Third try succeeds; clear injected error so the next call wins.
			repo.shareErr = nil
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
	if repo.shareCalls != 3 {
		t.Fatalf("shareCalls = %d, want 3", repo.shareCalls)
	}
}

func TestMakePrivate_RejectsEmptyCiphertext(t *testing.T) {
	t.Parallel()
	repo := &fakePublishRepo{}
	uc := &app.MakePrivate{Repo: repo}
	err := uc.Do(context.Background(), app.MakePrivateInput{
		UserID: uuid.New(),
		NoteID: uuid.New(),
	})
	if !errors.Is(err, app.ErrMakePrivateEmptyCiphertext) {
		t.Fatalf("err = %v, want ErrMakePrivateEmptyCiphertext", err)
	}
	if repo.privateCalls != 0 {
		t.Fatalf("privateCalls = %d, want 0 (should short-circuit before DB)", repo.privateCalls)
	}
}

func TestMakePrivate_PersistsCiphertext(t *testing.T) {
	t.Parallel()
	repo := &fakePublishRepo{}
	uc := &app.MakePrivate{Repo: repo}
	noteID := uuid.New()
	err := uc.Do(context.Background(), app.MakePrivateInput{
		UserID:        uuid.New(),
		NoteID:        noteID,
		CiphertextB64: "aGVsbG8=",
	})
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if repo.privateCalls != 1 {
		t.Fatalf("privateCalls = %d, want 1", repo.privateCalls)
	}
	if repo.lastPrivateCipher != "aGVsbG8=" {
		t.Fatalf("ciphertext mismatch: %q", repo.lastPrivateCipher)
	}
	if repo.lastPrivateNoteID != noteID {
		t.Fatalf("noteID mismatch")
	}
}
