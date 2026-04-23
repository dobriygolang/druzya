// cms_test.go — table-driven tests for the CMS use cases. We hand-roll
// fakes for PodcastCMSRepo and PodcastObjectStore because the existing
// mocks/cms_mock.go is generated lazily (we don't run `go generate` here)
// and the surface is small enough that a struct with function fields is
// the lower-friction path.
package app

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"druz9/podcast/domain"

	"github.com/google/uuid"
)

// ─── fakes ───────────────────────────────────────────────────────────────

type fakeCMSRepo struct {
	listCMSFn        func(ctx context.Context, f domain.CMSListFilter) ([]domain.CMSPodcast, error)
	getCMSByIDFn     func(ctx context.Context, id uuid.UUID) (domain.CMSPodcast, error)
	createCMSFn      func(ctx context.Context, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error)
	updateCMSFn      func(ctx context.Context, id uuid.UUID, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error)
	deleteCMSFn      func(ctx context.Context, id uuid.UUID) (string, error)
	listCategoriesFn func(ctx context.Context) ([]domain.PodcastCategory, error)
	getCategoryFn    func(ctx context.Context, id uuid.UUID) (domain.PodcastCategory, error)
	createCategoryFn func(ctx context.Context, in domain.PodcastCategory) (domain.PodcastCategory, error)
}

func (f *fakeCMSRepo) ListCMS(ctx context.Context, fl domain.CMSListFilter) ([]domain.CMSPodcast, error) {
	return f.listCMSFn(ctx, fl)
}
func (f *fakeCMSRepo) GetCMSByID(ctx context.Context, id uuid.UUID) (domain.CMSPodcast, error) {
	return f.getCMSByIDFn(ctx, id)
}
func (f *fakeCMSRepo) CreateCMS(ctx context.Context, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error) {
	return f.createCMSFn(ctx, in)
}
func (f *fakeCMSRepo) UpdateCMS(ctx context.Context, id uuid.UUID, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error) {
	return f.updateCMSFn(ctx, id, in)
}
func (f *fakeCMSRepo) DeleteCMS(ctx context.Context, id uuid.UUID) (string, error) {
	return f.deleteCMSFn(ctx, id)
}
func (f *fakeCMSRepo) ListCategories(ctx context.Context) ([]domain.PodcastCategory, error) {
	return f.listCategoriesFn(ctx)
}
func (f *fakeCMSRepo) GetCategoryByID(ctx context.Context, id uuid.UUID) (domain.PodcastCategory, error) {
	if f.getCategoryFn == nil {
		return domain.PodcastCategory{ID: id, Slug: "noop", Name: "noop"}, nil
	}
	return f.getCategoryFn(ctx, id)
}
func (f *fakeCMSRepo) CreateCategory(ctx context.Context, in domain.PodcastCategory) (domain.PodcastCategory, error) {
	return f.createCategoryFn(ctx, in)
}

type fakeStore struct {
	available bool
	putFn     func(ctx context.Context, key string, body io.Reader, length int64, ct string) (string, error)
	presignFn func(ctx context.Context, key string, ttl time.Duration) (string, error)
	deleteFn  func(ctx context.Context, key string) error
}

func (f *fakeStore) Available() bool { return f.available }
func (f *fakeStore) PutAudio(ctx context.Context, key string, body io.Reader, length int64, ct string) (string, error) {
	if f.putFn == nil {
		return key, nil
	}
	return f.putFn(ctx, key, body, length, ct)
}
func (f *fakeStore) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	if f.presignFn == nil {
		return "https://signed.example/" + key, nil
	}
	return f.presignFn(ctx, key, ttl)
}
func (f *fakeStore) Delete(ctx context.Context, key string) error {
	if f.deleteFn == nil {
		return nil
	}
	return f.deleteFn(ctx, key)
}

func newSilentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// ─── tests ───────────────────────────────────────────────────────────────

func TestListCMSPodcasts_PopulatesAudioURL(t *testing.T) {
	repo := &fakeCMSRepo{
		listCMSFn: func(_ context.Context, _ domain.CMSListFilter) ([]domain.CMSPodcast, error) {
			return []domain.CMSPodcast{
				{ID: uuid.New(), Title: "ep1", AudioKey: "audio/x.mp3"},
				{ID: uuid.New(), Title: "ep2", AudioKey: ""},
			}, nil
		},
	}
	store := &fakeStore{available: true}
	svc := NewCMSService(repo, store, newSilentLogger(), nil)

	out, err := svc.ListCMSPodcasts(context.Background(), domain.CMSListFilter{})
	if err != nil {
		t.Fatalf("ListCMSPodcasts: unexpected err: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("len = %d, want 2", len(out))
	}
	if out[0].AudioURL == "" {
		t.Errorf("expected AudioURL populated for first row, got empty")
	}
	if out[1].AudioURL != "" {
		t.Errorf("expected empty AudioURL for row without audio_key, got %q", out[1].AudioURL)
	}
}

func TestListCMSPodcasts_StoreUnavailable_LeavesURLEmpty(t *testing.T) {
	repo := &fakeCMSRepo{
		listCMSFn: func(_ context.Context, _ domain.CMSListFilter) ([]domain.CMSPodcast, error) {
			return []domain.CMSPodcast{{ID: uuid.New(), Title: "ep1", AudioKey: "audio/x.mp3"}}, nil
		},
	}
	store := &fakeStore{available: false}
	svc := NewCMSService(repo, store, newSilentLogger(), nil)

	out, err := svc.ListCMSPodcasts(context.Background(), domain.CMSListFilter{})
	if err != nil {
		t.Fatalf("ListCMSPodcasts: unexpected err: %v", err)
	}
	if out[0].AudioURL != "" {
		t.Errorf("expected empty AudioURL when store unavailable, got %q", out[0].AudioURL)
	}
}

func TestCreatePodcast_RequiresStoreAvailable(t *testing.T) {
	repo := &fakeCMSRepo{}
	store := &fakeStore{available: false}
	svc := NewCMSService(repo, store, newSilentLogger(), nil)

	_, err := svc.CreatePodcast(context.Background(), CreatePodcastInput{
		Title:       "x",
		AudioBody:   bytes.NewReader([]byte("data")),
		AudioLength: 4,
	})
	if !errors.Is(err, domain.ErrObjectStoreUnavailable) {
		t.Fatalf("err = %v, want ErrObjectStoreUnavailable", err)
	}
}

func TestCreatePodcast_RequiresTitle(t *testing.T) {
	store := &fakeStore{available: true}
	svc := NewCMSService(&fakeCMSRepo{}, store, newSilentLogger(), nil)

	_, err := svc.CreatePodcast(context.Background(), CreatePodcastInput{
		Title:       "  ",
		AudioBody:   bytes.NewReader([]byte("data")),
		AudioLength: 4,
	})
	if !errors.Is(err, domain.ErrInvalidPodcast) {
		t.Fatalf("err = %v, want ErrInvalidPodcast", err)
	}
}

func TestCreatePodcast_HappyPath(t *testing.T) {
	uploaded := ""
	created := uuid.New()
	repo := &fakeCMSRepo{
		createCMSFn: func(_ context.Context, in domain.CMSPodcastUpsert) (domain.CMSPodcast, error) {
			if !strings.HasPrefix(in.AudioKey, "audio/") {
				return domain.CMSPodcast{}, errors.New("bad key prefix")
			}
			return domain.CMSPodcast{ID: created, Title: in.Title, AudioKey: in.AudioKey}, nil
		},
		getCMSByIDFn: func(_ context.Context, id uuid.UUID) (domain.CMSPodcast, error) {
			return domain.CMSPodcast{ID: id, Title: "Episode 1", AudioKey: "audio/x.mp3"}, nil
		},
	}
	store := &fakeStore{
		available: true,
		putFn: func(_ context.Context, key string, _ io.Reader, _ int64, _ string) (string, error) {
			uploaded = key
			return key, nil
		},
	}
	svc := NewCMSService(repo, store, newSilentLogger(), nil)

	out, err := svc.CreatePodcast(context.Background(), CreatePodcastInput{
		Title:         "Episode 1",
		AudioBody:     bytes.NewReader([]byte("data")),
		AudioLength:   4,
		AudioFilename: "ep.mp3",
	})
	if err != nil {
		t.Fatalf("CreatePodcast: %v", err)
	}
	if out.ID != created {
		t.Errorf("out.ID = %s, want %s", out.ID, created)
	}
	if uploaded == "" || !strings.HasSuffix(uploaded, ".mp3") {
		t.Errorf("uploaded key = %q, want suffix .mp3", uploaded)
	}
	if out.AudioURL == "" {
		t.Errorf("expected AudioURL populated, got empty")
	}
}

func TestCreatePodcast_DBFail_TriggersOrphanCleanup(t *testing.T) {
	deleted := ""
	repo := &fakeCMSRepo{
		createCMSFn: func(_ context.Context, _ domain.CMSPodcastUpsert) (domain.CMSPodcast, error) {
			return domain.CMSPodcast{}, errors.New("boom")
		},
	}
	store := &fakeStore{
		available: true,
		deleteFn: func(_ context.Context, key string) error {
			deleted = key
			return nil
		},
	}
	svc := NewCMSService(repo, store, newSilentLogger(), nil)

	_, err := svc.CreatePodcast(context.Background(), CreatePodcastInput{
		Title:         "ep",
		AudioBody:     bytes.NewReader([]byte("d")),
		AudioLength:   1,
		AudioFilename: "a.mp3",
	})
	if err == nil {
		t.Fatalf("expected err, got nil")
	}
	if deleted == "" {
		t.Errorf("expected orphan delete to fire")
	}
}

func TestUpdatePodcast_RequiresTitle(t *testing.T) {
	svc := NewCMSService(&fakeCMSRepo{}, &fakeStore{available: true}, newSilentLogger(), nil)
	_, err := svc.UpdatePodcast(context.Background(), uuid.New(), UpdatePodcastInput{Title: ""})
	if !errors.Is(err, domain.ErrInvalidPodcast) {
		t.Fatalf("err = %v, want ErrInvalidPodcast", err)
	}
}

func TestDeletePodcast_RemovesObject(t *testing.T) {
	deleted := ""
	repo := &fakeCMSRepo{
		deleteCMSFn: func(_ context.Context, _ uuid.UUID) (string, error) {
			return "audio/x.mp3", nil
		},
	}
	store := &fakeStore{
		available: true,
		deleteFn: func(_ context.Context, key string) error {
			deleted = key
			return nil
		},
	}
	svc := NewCMSService(repo, store, newSilentLogger(), nil)
	if err := svc.DeletePodcast(context.Background(), uuid.New()); err != nil {
		t.Fatalf("DeletePodcast: %v", err)
	}
	if deleted != "audio/x.mp3" {
		t.Errorf("deleted = %q, want audio/x.mp3", deleted)
	}
}

func TestCreateCategory_ValidatesInput(t *testing.T) {
	svc := NewCMSService(&fakeCMSRepo{}, &fakeStore{available: true}, newSilentLogger(), nil)
	_, err := svc.CreateCategory(context.Background(), domain.PodcastCategory{Slug: "", Name: ""})
	if !errors.Is(err, domain.ErrInvalidPodcast) {
		t.Fatalf("err = %v, want ErrInvalidPodcast", err)
	}
}

func TestBuildObjectKey_ExtensionFallback(t *testing.T) {
	cases := []struct {
		filename string
		wantSuf  string
	}{
		{"foo.mp3", ".mp3"},
		{"weird", ".bin"},
		{"a.WAV", ".wav"},
		{"toolongextension.thisisnotvalid", ".bin"},
	}
	for _, c := range cases {
		k := buildObjectKey(c.filename)
		if !strings.HasPrefix(k, "audio/") {
			t.Errorf("buildObjectKey(%q) prefix = %q, want audio/", c.filename, k)
		}
		if !strings.HasSuffix(k, c.wantSuf) {
			t.Errorf("buildObjectKey(%q) suffix = %q, want %q", c.filename, k, c.wantSuf)
		}
	}
}
