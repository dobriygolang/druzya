package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"druz9/curation/domain"

	"github.com/google/uuid"
)

// fakeOverrideRepo — in-memory test double.
type fakeOverrideRepo struct {
	rows []Override
}

func (r *fakeOverrideRepo) Insert(_ context.Context, ov Override) (Override, error) {
	if ov.ID == uuid.Nil {
		ov.ID = uuid.New()
	}
	r.rows = append(r.rows, ov)
	return ov, nil
}

func (r *fakeOverrideRepo) List(_ context.Context, userID uuid.UUID, t Target) ([]Override, error) {
	out := []Override{}
	for _, ov := range r.rows {
		if ov.UserID != userID {
			continue
		}
		if t.AtlasNodeID != "" && ov.Target.AtlasNodeID != t.AtlasNodeID {
			continue
		}
		out = append(out, ov)
	}
	return out, nil
}

func (r *fakeOverrideRepo) DeleteByURL(_ context.Context, _ uuid.UUID, _ Target, _ string, _ OverrideAction) error {
	return nil
}

type fakePromotionTracker struct {
	bumpCount int
	lastURL   string
}

func (p *fakePromotionTracker) BumpAdded(_ context.Context, url, _ string) error {
	p.bumpCount++
	p.lastURL = url
	return nil
}
func (p *fakePromotionTracker) UpdateQuality(_ context.Context, _ string, _ float32) error {
	return nil
}

type fakeReputation struct{ bumpedHosts []string }

func (r *fakeReputation) BumpUnhelpful(_ context.Context, host string) error {
	r.bumpedHosts = append(r.bumpedHosts, host)
	return nil
}
func (r *fakeReputation) IsBlocked(_ context.Context, _ string) (bool, error) { return false, nil }

func validResource() domain.Resource {
	return domain.Resource{
		URL:      "https://example.com/post",
		Title:    "Title",
		Why:      "useful",
		Kind:     domain.KindArticle,
		Level:    domain.LevelB,
		Priority: domain.PrioritySupplement,
	}
}

func TestAddResource_RejectsInvalidTarget(t *testing.T) {
	uc := AddResource{Repo: &fakeOverrideRepo{}, Promotion: &fakePromotionTracker{}}
	_, err := uc.Do(context.Background(), AddResourceInput{
		UserID:   uuid.New(),
		Target:   Target{}, // empty — invalid
		Resource: validResource(),
	})
	if err == nil {
		t.Fatal("expected invalid target error")
	}
}

func TestAddResource_BumpsPromotionForNodeTarget(t *testing.T) {
	repo := &fakeOverrideRepo{}
	prom := &fakePromotionTracker{}
	uc := AddResource{Repo: repo, Promotion: prom}
	_, err := uc.Do(context.Background(), AddResourceInput{
		UserID:   uuid.New(),
		Target:   Target{AtlasNodeID: "ml_classical"},
		Resource: validResource(),
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if prom.bumpCount != 1 || prom.lastURL != "https://example.com/post" {
		t.Errorf("promotion not bumped: count=%d url=%q", prom.bumpCount, prom.lastURL)
	}
}

func TestAddResource_PropagatesValidationErrors(t *testing.T) {
	uc := AddResource{Repo: &fakeOverrideRepo{}, Promotion: &fakePromotionTracker{}}
	r := validResource()
	r.URL = "not-a-url"
	_, err := uc.Do(context.Background(), AddResourceInput{
		UserID: uuid.New(), Target: Target{AtlasNodeID: "ml"}, Resource: r,
	})
	if err == nil || !errors.Is(err, domain.ErrInvalidResource) {
		t.Fatalf("expected ErrInvalidResource, got %v", err)
	}
}

func TestMarkUnhelpful_BumpsReputation(t *testing.T) {
	rep := &fakeReputation{}
	uc := MarkUnhelpful{Repo: &fakeOverrideRepo{}, Reputation: rep}
	err := uc.Do(context.Background(), uuid.New(),
		Target{AtlasNodeID: "ml"}, "https://blogspam.test/x", "trash")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(rep.bumpedHosts) != 1 || rep.bumpedHosts[0] != "blogspam.test" {
		t.Errorf("reputation not bumped properly: %v", rep.bumpedHosts)
	}
}

func TestApplyOverrides_FiltersHidden(t *testing.T) {
	repo := &fakeOverrideRepo{}
	userID := uuid.New()
	target := Target{AtlasNodeID: "ml"}
	// Pre-seed: hide a curated URL.
	_, _ = repo.Insert(context.Background(), Override{
		UserID: userID, Target: target,
		URL:    "https://strang.example/ch3",
		Action: ActionHidden, Payload: []byte(`{}`),
	})
	uc := ApplyOverrides{Repo: repo}
	base := domain.ResourceList{
		{URL: "https://strang.example/ch3", Title: "Strang", Why: "x", Kind: domain.KindBook, Level: domain.LevelB, Priority: domain.PriorityCore},
		{URL: "https://kept.example", Title: "Kept", Why: "x", Kind: domain.KindArticle, Level: domain.LevelB, Priority: domain.PrioritySupplement},
	}
	out, err := uc.Do(context.Background(), userID, target, base)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 1 || out[0].URL != "https://kept.example" {
		t.Errorf("hidden URL not filtered: %+v", out)
	}
}

func TestApplyOverrides_AddsUserResources(t *testing.T) {
	repo := &fakeOverrideRepo{}
	userID := uuid.New()
	target := Target{AtlasNodeID: "ml"}
	r := validResource()
	r.URL = "https://my.example/post"
	payload, _ := domain.ResourceList{r}.Marshal()
	_, _ = repo.Insert(context.Background(), Override{
		UserID: userID, Target: target,
		URL: r.URL, Action: ActionAdded, Payload: payload,
	})
	uc := ApplyOverrides{Repo: repo}
	out, err := uc.Do(context.Background(), userID, target, nil)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 1 || out[0].URL != "https://my.example/post" {
		t.Errorf("user-added not appended: %+v", out)
	}
}

func TestJsonString_EscapesQuotes(t *testing.T) {
	got := jsonString(`he said "hi"`)
	if !strings.Contains(got, `\"hi\"`) {
		t.Errorf("quote not escaped: %s", got)
	}
}
