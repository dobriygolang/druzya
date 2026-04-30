package app

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// fakeListeningRepo — hand-rolled fake (parallel to fakeReadingRepo).
type fakeListeningRepo struct {
	create  func(context.Context, domain.ListeningMaterial) (domain.ListeningMaterial, error)
	get     func(context.Context, uuid.UUID, uuid.UUID) (domain.ListeningMaterial, error)
	list    func(context.Context, uuid.UUID, int) ([]domain.ListeningMaterial, error)
	archive func(context.Context, uuid.UUID, uuid.UUID, time.Time) error
}

func (f fakeListeningRepo) CreateMaterial(ctx context.Context, m domain.ListeningMaterial) (domain.ListeningMaterial, error) {
	return f.create(ctx, m)
}
func (f fakeListeningRepo) GetMaterial(ctx context.Context, u, m uuid.UUID) (domain.ListeningMaterial, error) {
	return f.get(ctx, u, m)
}
func (f fakeListeningRepo) ListMaterials(ctx context.Context, u uuid.UUID, l int) ([]domain.ListeningMaterial, error) {
	return f.list(ctx, u, l)
}
func (f fakeListeningRepo) ArchiveMaterial(ctx context.Context, u, m uuid.UUID, n time.Time) error {
	return f.archive(ctx, u, m, n)
}

func TestAddListeningMaterial_HappyPath(t *testing.T) {
	t.Parallel()
	uid := uuid.New()
	repo := fakeListeningRepo{
		create: func(_ context.Context, m domain.ListeningMaterial) (domain.ListeningMaterial, error) {
			if m.UserID != uid || m.Title != "Lex Fridman ep 400" {
				t.Errorf("not propagated: %+v", m)
			}
			m.ID = uuid.New()
			return m, nil
		},
	}
	uc := &AddListeningMaterial{Repo: repo}
	out, err := uc.Do(context.Background(), AddListeningMaterialInput{
		UserID:       uid,
		Title:        "  Lex Fridman ep 400  ",
		AudioURL:     "  https://example.com/ep400.mp3  ",
		TranscriptMD: "  Welcome to the podcast…  ",
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if out.ID == uuid.Nil {
		t.Error("ID should be stamped by repo")
	}
}

func TestAddListeningMaterial_RejectsBadInput(t *testing.T) {
	t.Parallel()
	uc := &AddListeningMaterial{Repo: fakeListeningRepo{}}
	cases := []struct {
		name string
		in   AddListeningMaterialInput
	}{
		{"zero user_id", AddListeningMaterialInput{Title: "x", AudioURL: "u"}},
		{"empty title", AddListeningMaterialInput{UserID: uuid.New(), Title: "  ", AudioURL: "u"}},
		{"empty audio_url", AddListeningMaterialInput{UserID: uuid.New(), Title: "x", AudioURL: " "}},
		{"oversize transcript", AddListeningMaterialInput{
			UserID:       uuid.New(),
			Title:        "x",
			AudioURL:     "u",
			TranscriptMD: strings.Repeat("a", listeningTranscriptMax+1),
		}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if _, err := uc.Do(context.Background(), c.in); err == nil {
				t.Errorf("expected error for %s", c.name)
			}
		})
	}
}

func TestArchiveListeningMaterial_PassThrough(t *testing.T) {
	t.Parallel()
	repo := fakeListeningRepo{
		archive: func(_ context.Context, _, _ uuid.UUID, _ time.Time) error {
			return domain.ErrNotFound
		},
	}
	uc := &ArchiveListeningMaterial{Repo: repo}
	if err := uc.Do(context.Background(), uuid.New(), uuid.New()); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}
