package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// resourceLogStore — closure-state для MockResourceLogRepo (in-package).
type resourceLogStore struct {
	mu    sync.Mutex
	saved []ResourceLogEntry
}

func wireMockResourceLogRepo(ctrl *gomock.Controller, s *resourceLogStore) *MockResourceLogRepo {
	m := NewMockResourceLogRepo(ctrl)
	m.EXPECT().Insert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, in ResourceLogEntry) (ResourceLogEntry, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			in.ID = uuid.New()
			s.saved = append(s.saved, in)
			return in, nil
		},
	).AnyTimes()
	return m
}

func TestLogResource_RejectsBadKind(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := LogResource{Repo: wireMockResourceLogRepo(ctrl, &resourceLogStore{})}
	_, err := uc.Do(context.Background(), LogResourceInput{
		UserID: uuid.New(), ResourceURL: "https://x.com", Kind: "downloaded",
	})
	if err == nil {
		t.Fatal("expected error for invalid kind")
	}
}

func TestLogResource_RequiresReflectionText(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := LogResource{Repo: wireMockResourceLogRepo(ctrl, &resourceLogStore{})}
	_, err := uc.Do(context.Background(), LogResourceInput{
		UserID: uuid.New(), ResourceURL: "https://x.com", Kind: "reflection_submitted",
	})
	if err == nil {
		t.Fatal("expected error for empty reflection_text")
	}
}

func TestLogResource_AutoCreatesNote(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := &resourceLogStore{}
	noteID := uuid.New()
	uc := LogResource{
		Repo: wireMockResourceLogRepo(ctrl, store),
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
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.saved) != 1 || store.saved[0].ReflectionNoteID == nil {
		t.Fatalf("repo entry missing note_id: %+v", store.saved)
	}
}

func TestLogResource_NoteFailureDoesNotBlockEntry(t *testing.T) {
	ctrl := gomock.NewController(t)
	store := &resourceLogStore{}
	uc := LogResource{
		Repo: wireMockResourceLogRepo(ctrl, store),
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
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.saved) != 1 || store.saved[0].ReflectionNoteID != nil {
		t.Fatalf("entry should be saved without note_id, got %+v", store.saved)
	}
}
