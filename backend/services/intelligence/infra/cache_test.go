package infra

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

func TestCachedDailyBriefsHitDoesNotCallDelegate(t *testing.T) {
	uid := uuid.New()
	date := time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC)
	want := domain.DailyBrief{BriefID: uuid.New(), Headline: "Cached", GeneratedAt: date.Add(time.Hour)}
	kv := newFakeBriefKV()
	cache := NewCachedDailyBriefs(&fakeBriefRepo{getErr: errors.New("delegate must not be called")}, kv, time.Hour, slog.Default())
	cache.set(context.Background(), keyDailyBrief(uid, date), want)

	got, err := cache.GetForDate(context.Background(), uid, date)
	if err != nil {
		t.Fatalf("GetForDate: %v", err)
	}
	if got.Headline != want.Headline || got.BriefID != want.BriefID {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestCachedDailyBriefsMissLoadsAndStores(t *testing.T) {
	uid := uuid.New()
	date := time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC)
	want := domain.DailyBrief{BriefID: uuid.New(), Headline: "Loaded", GeneratedAt: date.Add(time.Hour)}
	repo := &fakeBriefRepo{get: want}
	kv := newFakeBriefKV()
	cache := NewCachedDailyBriefs(repo, kv, time.Hour, slog.Default())

	got, err := cache.GetForDate(context.Background(), uid, date)
	if err != nil {
		t.Fatalf("GetForDate: %v", err)
	}
	if got.Headline != want.Headline {
		t.Fatalf("headline=%q, want %q", got.Headline, want.Headline)
	}
	if repo.getCalls != 1 {
		t.Fatalf("getCalls=%d, want 1", repo.getCalls)
	}
	if _, ok := kv.rows[keyDailyBrief(uid, date)]; !ok {
		t.Fatalf("cache entry was not stored")
	}
}

func TestCachedDailyBriefsUpsertStoresAfterDelegate(t *testing.T) {
	uid := uuid.New()
	date := time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC)
	brief := domain.DailyBrief{BriefID: uuid.New(), Headline: "Fresh", GeneratedAt: date.Add(time.Hour)}
	repo := &fakeBriefRepo{}
	kv := newFakeBriefKV()
	cache := NewCachedDailyBriefs(repo, kv, time.Hour, slog.Default())

	if err := cache.Upsert(context.Background(), uid, date, brief); err != nil {
		t.Fatalf("Upsert: %v", err)
	}
	if repo.upsertCalls != 1 {
		t.Fatalf("upsertCalls=%d, want 1", repo.upsertCalls)
	}
	got, err := cache.GetForDate(context.Background(), uid, date)
	if err != nil {
		t.Fatalf("GetForDate after upsert: %v", err)
	}
	if got.Headline != brief.Headline {
		t.Fatalf("headline=%q, want %q", got.Headline, brief.Headline)
	}
}

type fakeBriefKV struct {
	rows map[string]string
}

func newFakeBriefKV() *fakeBriefKV {
	return &fakeBriefKV{rows: make(map[string]string)}
}

func (f *fakeBriefKV) Get(_ context.Context, key string) (string, error) {
	v, ok := f.rows[key]
	if !ok {
		return "", ErrBriefCacheMiss
	}
	return v, nil
}

func (f *fakeBriefKV) Set(_ context.Context, key string, value []byte, _ time.Duration) error {
	f.rows[key] = string(value)
	return nil
}

func (f *fakeBriefKV) Del(_ context.Context, keys ...string) error {
	for _, key := range keys {
		delete(f.rows, key)
	}
	return nil
}

type fakeBriefRepo struct {
	get         domain.DailyBrief
	getErr      error
	getCalls    int
	upsertCalls int
}

func (f *fakeBriefRepo) GetForDate(context.Context, uuid.UUID, time.Time) (domain.DailyBrief, error) {
	f.getCalls++
	if f.getErr != nil {
		return domain.DailyBrief{}, f.getErr
	}
	return f.get, nil
}

func (f *fakeBriefRepo) Upsert(context.Context, uuid.UUID, time.Time, domain.DailyBrief) error {
	f.upsertCalls++
	return nil
}

func (f *fakeBriefRepo) LastForcedAt(context.Context, uuid.UUID) (time.Time, error) {
	return time.Time{}, nil
}
