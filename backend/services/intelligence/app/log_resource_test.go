package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type fakeResourceLogRepo struct {
	saved []ResourceLogEntry
}

func (r *fakeResourceLogRepo) Insert(_ context.Context, in ResourceLogEntry) (ResourceLogEntry, error) {
	in.ID = uuid.New()
	r.saved = append(r.saved, in)
	return in, nil
}

func TestLogResource_RejectsBadKind(t *testing.T) {
	uc := LogResource{Repo: &fakeResourceLogRepo{}}
	_, err := uc.Do(context.Background(), LogResourceInput{
		UserID: uuid.New(), ResourceURL: "https://x.com", Kind: "downloaded",
	})
	if err == nil {
		t.Fatal("expected error for invalid kind")
	}
}

func TestLogResource_RequiresReflectionText(t *testing.T) {
	uc := LogResource{Repo: &fakeResourceLogRepo{}}
	_, err := uc.Do(context.Background(), LogResourceInput{
		UserID: uuid.New(), ResourceURL: "https://x.com", Kind: "reflection_submitted",
	})
	if err == nil {
		t.Fatal("expected error for empty reflection_text")
	}
}

func TestLogResource_AutoCreatesNote(t *testing.T) {
	repo := &fakeResourceLogRepo{}
	noteID := uuid.New()
	uc := LogResource{
		Repo: repo,
		NoteCreator: func(_ context.Context, _ uuid.UUID, _ string, _ string) (uuid.UUID, error) {
			return noteID, nil
		},
		Now: func() time.Time { return time.Date(2026, 5, 4, 10, 0, 0, 0, time.UTC) },
	}
	out, err := uc.Do(context.Background(), LogResourceInput{
		UserID: uuid.New(), ResourceURL: "https://x.com",
		Kind: "reflection_submitted", ReflectionText: "Decision trees split on impurity.",
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.ReflectionNoteID == nil || *out.ReflectionNoteID != noteID {
		t.Fatalf("expected reflection_note_id, got %+v", out)
	}
	if len(repo.saved) != 1 || repo.saved[0].ReflectionNoteID == nil {
		t.Fatalf("repo entry missing note_id: %+v", repo.saved)
	}
}

func TestLogResource_NoteFailureDoesNotBlockEntry(t *testing.T) {
	repo := &fakeResourceLogRepo{}
	uc := LogResource{
		Repo: repo,
		NoteCreator: func(_ context.Context, _ uuid.UUID, _ string, _ string) (uuid.UUID, error) {
			return uuid.Nil, errors.New("boom")
		},
	}
	out, err := uc.Do(context.Background(), LogResourceInput{
		UserID: uuid.New(), ResourceURL: "https://x.com",
		Kind: "reflection_submitted", ReflectionText: "x",
	})
	if err != nil {
		t.Fatalf("UC must succeed even on Note failure: %v", err)
	}
	if !out.NoteCreateFailed {
		t.Fatal("NoteCreateFailed should be set")
	}
	if len(repo.saved) != 1 || repo.saved[0].ReflectionNoteID != nil {
		t.Fatalf("entry should be saved without note_id, got %+v", repo.saved)
	}
}
