package app

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"druz9/shared/enums"
	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// fakeBoostySource — табличный источник для тестов sync'а.
type fakeBoostySource struct {
	subs []BoostySubscriberSnapshot
	err  error
}

func (f *fakeBoostySource) ListSubscribers(_ context.Context, _ int) ([]BoostySubscriberSnapshot, error) {
	return f.subs, f.err
}

// fakeLinkRepo — минимальный Link-repo для sync-теста.
type fakeLinkRepo struct {
	byExt    map[string]uuid.UUID
	upserted int
}

func (f *fakeLinkRepo) Upsert(_ context.Context, _ domain.ProviderLink) error {
	f.upserted++
	return nil
}
func (f *fakeLinkRepo) Get(_ context.Context, _ uuid.UUID, _ domain.Provider) (domain.ProviderLink, error) {
	return domain.ProviderLink{}, domain.ErrNotFound
}
func (f *fakeLinkRepo) FindUserByExternalID(_ context.Context, _ domain.Provider, ext string) (uuid.UUID, error) {
	if uid, ok := f.byExt[ext]; ok {
		return uid, nil
	}
	return uuid.Nil, domain.ErrNotFound
}
func (f *fakeLinkRepo) ListByProvider(_ context.Context, _ domain.Provider, _, _ int) ([]domain.ProviderLink, error) {
	return nil, nil
}

func TestSyncBoosty_HappyPath(t *testing.T) {
	alice := uuid.New()
	bob := uuid.New()
	future := time.Now().Add(30 * 24 * time.Hour)
	subRepo := &fakeRepo{}
	dave := uuid.New()
	linkRepo := &fakeLinkRepo{byExt: map[string]uuid.UUID{
		"alice": alice,
		"bob":   bob,
		"dave":  dave, // привязан, но tier unknown → bad_tier
	}}
	src := &fakeBoostySource{subs: []BoostySubscriberSnapshot{
		{SubscriberID: "sub-1", Username: "alice", TierName: "Поддержка", ExpiresAt: &future, IsActive: true},
		{SubscriberID: "sub-2", Username: "bob", TierName: "Вознёсшийся", ExpiresAt: &future, IsActive: true},
		{SubscriberID: "sub-3", Username: "charlie", TierName: "Поддержка", ExpiresAt: &future, IsActive: true}, // no link
		{SubscriberID: "sub-4", Username: "dave", TierName: "НеизвестныйУровень", IsActive: true},               // bad tier
	}}
	set := NewSetTier(subRepo, fakeClock{now: time.Now()}, slog.Default())
	tierMap := map[string]domain.Tier{
		"Поддержка":   enums.SubscriptionPlanSeeker,
		"Вознёсшийся": enums.SubscriptionPlanAscendant,
	}
	sync := NewSyncBoosty(src, linkRepo, set, tierMap, slog.Default())

	res, err := sync.Do(context.Background())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if res.TotalFetched != 4 {
		t.Errorf("total=%d want 4", res.TotalFetched)
	}
	if res.Upserted != 2 {
		t.Errorf("upserted=%d want 2", res.Upserted)
	}
	if res.SkippedNoLink != 1 {
		t.Errorf("no_link=%d want 1", res.SkippedNoLink)
	}
	if res.SkippedBadTier != 1 {
		t.Errorf("bad_tier=%d want 1", res.SkippedBadTier)
	}
}

func TestSyncBoosty_SourceError(t *testing.T) {
	src := &fakeBoostySource{err: errors.New("network")}
	sync := NewSyncBoosty(src, &fakeLinkRepo{}, nil, nil, slog.Default())
	_, err := sync.Do(context.Background())
	if err == nil {
		t.Fatal("want err on source failure")
	}
}

func TestParseTierMapping(t *testing.T) {
	m := ParseTierMapping("Поддержка:seeker,Вознёсшийся:ascendant, Junk")
	if m["Поддержка"] != enums.SubscriptionPlanSeeker {
		t.Fatalf("Поддержка → %q", m["Поддержка"])
	}
	if m["Вознёсшийся"] != enums.SubscriptionPlanAscendant {
		t.Fatalf("Вознёсшийся → %q", m["Вознёсшийся"])
	}
	if _, ok := m["Junk"]; ok {
		t.Fatal("Junk without : must be skipped")
	}
	if len(ParseTierMapping("")) != 0 {
		t.Fatal("empty input → empty map")
	}
}
