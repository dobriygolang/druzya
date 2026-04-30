package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/profile/domain"
	"druz9/profile/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func TestGetUserTracks_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	want := []domain.UserTrack{
		{UserID: uid, Track: domain.TrackDevSenior, Seniority: domain.SenioritySenior, Primary: true, StartedAt: time.Now()},
		{UserID: uid, Track: domain.TrackEnglish, Primary: false, StartedAt: time.Now()},
	}
	repo.EXPECT().ListUserTracks(gomock.Any(), uid).Return(want, nil)

	uc := &GetUserTracks{Repo: repo}
	got, err := uc.Do(context.Background(), uid)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("len mismatch: got %d, want %d", len(got), len(want))
	}
}

func TestGetUserTracks_EmptyListIsValid(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	repo.EXPECT().ListUserTracks(gomock.Any(), uid).Return([]domain.UserTrack{}, nil)

	uc := &GetUserTracks{Repo: repo}
	got, err := uc.Do(context.Background(), uid)
	if err != nil {
		t.Fatalf("empty list must not be an error: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty slice, got %d items", len(got))
	}
}

func TestGetUserTracks_RepoErrorWraps(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	boom := errors.New("pgx: pool closed")
	repo.EXPECT().ListUserTracks(gomock.Any(), uid).Return(nil, boom)

	uc := &GetUserTracks{Repo: repo}
	_, err := uc.Do(context.Background(), uid)
	if !errors.Is(err, boom) {
		t.Fatalf("error not wrapped: %v", err)
	}
}

func TestSetUserTracks_HappyPath(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	in := []domain.UserTrack{
		{Track: domain.TrackDevSenior, Seniority: domain.SenioritySenior, Primary: true},
		{Track: domain.TrackEnglish, Primary: false},
	}
	repo.EXPECT().
		SetUserTracks(gomock.Any(), uid, gomock.Any()).
		DoAndReturn(func(_ context.Context, _ uuid.UUID, items []domain.UserTrack) ([]domain.UserTrack, error) {
			// User ID must be set on every item by the use case before
			// hitting the repo (defense against the caller forging foreign IDs).
			for i, it := range items {
				if it.UserID != uid {
					t.Errorf("items[%d].UserID = %v, want %v", i, it.UserID, uid)
				}
			}
			return items, nil
		})

	uc := &SetUserTracks{Repo: repo}
	out, err := uc.Do(context.Background(), uid, in)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("len mismatch: got %d, want 2", len(out))
	}
}

func TestSetUserTracks_OverridesIncomingUserID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	foreign := uuid.New() // attacker tries to set someone else's tracks via a forged user_id
	in := []domain.UserTrack{
		{UserID: foreign, Track: domain.TrackDev, Seniority: domain.SeniorityMiddle, Primary: true},
	}
	repo.EXPECT().
		SetUserTracks(gomock.Any(), uid, gomock.Any()).
		DoAndReturn(func(_ context.Context, gotUID uuid.UUID, items []domain.UserTrack) ([]domain.UserTrack, error) {
			if gotUID != uid {
				t.Errorf("repo got UID %v, want authenticated %v", gotUID, uid)
			}
			for _, it := range items {
				if it.UserID != uid {
					t.Errorf("items kept foreign UserID %v after Do(%v)", it.UserID, uid)
				}
			}
			return items, nil
		})

	uc := &SetUserTracks{Repo: repo}
	if _, err := uc.Do(context.Background(), uid, in); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestSetUserTracks_InvalidInputDoesNotHitRepo(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	// Mock has zero EXPECT calls — if SetUserTracks gets called we fail.

	cases := map[string][]domain.UserTrack{
		"empty list":             nil,
		"no primary":             {{Track: domain.TrackDev, Seniority: domain.SeniorityMiddle, Primary: false}},
		"multiple primaries":     {{Track: domain.TrackDev, Seniority: domain.SeniorityMiddle, Primary: true}, {Track: domain.TrackEnglish, Primary: true}},
		"english with seniority": {{Track: domain.TrackEnglish, Seniority: domain.SeniorityMiddle, Primary: true}},
		"non-english no senior":  {{Track: domain.TrackDev, Seniority: "", Primary: true}},
		"duplicate track":        {{Track: domain.TrackDev, Seniority: domain.SeniorityMiddle, Primary: true}, {Track: domain.TrackDev, Seniority: domain.SenioritySenior, Primary: false}},
		"unknown track":          {{Track: domain.Track("designer"), Seniority: domain.SeniorityMiddle, Primary: true}},
		"unknown seniority":      {{Track: domain.TrackDev, Seniority: domain.Seniority("guru"), Primary: true}},
	}

	uc := &SetUserTracks{Repo: repo}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := uc.Do(context.Background(), uid, in)
			if !errors.Is(err, domain.ErrInvalidTracks) {
				t.Fatalf("want ErrInvalidTracks, got %v", err)
			}
		})
	}
}

func TestSetUserTracks_RepoErrorWraps(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockProfileRepo(ctrl)
	uid := uuid.New()
	in := []domain.UserTrack{
		{Track: domain.TrackDev, Seniority: domain.SeniorityMiddle, Primary: true},
	}
	boom := errors.New("pgx: tx aborted")
	repo.EXPECT().SetUserTracks(gomock.Any(), uid, gomock.Any()).Return(nil, boom)

	uc := &SetUserTracks{Repo: repo}
	_, err := uc.Do(context.Background(), uid, in)
	if !errors.Is(err, boom) {
		t.Fatalf("repo error not wrapped: %v", err)
	}
}
