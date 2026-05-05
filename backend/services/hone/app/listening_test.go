package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"druz9/hone/domain"
	"druz9/hone/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestAddListeningMaterial_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uid := uuid.New()
	repo := mocks.NewMockListeningRepo(ctrl)
	repo.EXPECT().CreateMaterial(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, m domain.ListeningMaterial) (domain.ListeningMaterial, error) {
			if m.UserID != uid || m.Title != "Lex Fridman ep 400" {
				t.Errorf("not propagated: %+v", m)
			}
			m.ID = uuid.New()
			return m, nil
		},
	)
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
	ctrl := gomock.NewController(t)
	uc := &AddListeningMaterial{Repo: mocks.NewMockListeningRepo(ctrl)}
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
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockListeningRepo(ctrl)
	repo.EXPECT().ArchiveMaterial(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(domain.ErrNotFound)
	uc := &ArchiveListeningMaterial{Repo: repo}
	if err := uc.Do(context.Background(), uuid.New(), uuid.New()); !errors.Is(err, domain.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}
