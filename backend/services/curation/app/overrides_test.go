package app_test

import (
	"context"
	"errors"
	"testing"

	"druz9/curation/app"
	"druz9/curation/app/mocks"
	"druz9/curation/domain"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

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
	ctrl := gomock.NewController(t)
	uc := app.AddResource{
		Repo:      mocks.NewMockOverrideRepo(ctrl),
		Promotion: mocks.NewMockPromotionTracker(ctrl),
	}
	_, err := uc.Do(context.Background(), app.AddResourceInput{
		UserID:   uuid.New(),
		Target:   app.Target{}, // empty — invalid
		Resource: validResource(),
	})
	if err == nil {
		t.Fatal("expected invalid target error")
	}
}

func TestAddResource_BumpsPromotionForNodeTarget(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockOverrideRepo(ctrl)
	repo.EXPECT().Insert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ov app.Override) (app.Override, error) {
			ov.ID = uuid.New()
			return ov, nil
		},
	)
	prom := mocks.NewMockPromotionTracker(ctrl)
	var bumpedURL string
	prom.EXPECT().BumpAdded(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, url, _ string) error {
			bumpedURL = url
			return nil
		},
	)

	uc := app.AddResource{Repo: repo, Promotion: prom}
	_, err := uc.Do(context.Background(), app.AddResourceInput{
		UserID:   uuid.New(),
		Target:   app.Target{AtlasNodeID: "ml_classical"},
		Resource: validResource(),
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if bumpedURL != "https://example.com/post" {
		t.Errorf("promotion not bumped: url=%q", bumpedURL)
	}
}

func TestAddResource_PropagatesValidationErrors(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := app.AddResource{
		Repo:      mocks.NewMockOverrideRepo(ctrl),
		Promotion: mocks.NewMockPromotionTracker(ctrl),
	}
	r := validResource()
	r.URL = "not-a-url"
	_, err := uc.Do(context.Background(), app.AddResourceInput{
		UserID: uuid.New(), Target: app.Target{AtlasNodeID: "ml"}, Resource: r,
	})
	if err == nil || !errors.Is(err, domain.ErrInvalidResource) {
		t.Fatalf("expected ErrInvalidResource, got %v", err)
	}
}

func TestMarkUnhelpful_BumpsReputation(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockOverrideRepo(ctrl)
	repo.EXPECT().Insert(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, ov app.Override) (app.Override, error) {
			ov.ID = uuid.New()
			return ov, nil
		},
	)
	rep := mocks.NewMockDomainReputationRepo(ctrl)
	var bumpedHosts []string
	rep.EXPECT().BumpUnhelpful(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, host string) error {
			bumpedHosts = append(bumpedHosts, host)
			return nil
		},
	)

	uc := app.MarkUnhelpful{Repo: repo, Reputation: rep}
	err := uc.Do(context.Background(), uuid.New(),
		app.Target{AtlasNodeID: "ml"}, "https://blogspam.test/x", "trash")
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(bumpedHosts) != 1 || bumpedHosts[0] != "blogspam.test" {
		t.Errorf("reputation not bumped properly: %v", bumpedHosts)
	}
}

func TestApplyOverrides_FiltersHidden(t *testing.T) {
	ctrl := gomock.NewController(t)
	userID := uuid.New()
	target := app.Target{AtlasNodeID: "ml"}
	repo := mocks.NewMockOverrideRepo(ctrl)
	// Pre-seeded: hide a curated URL.
	repo.EXPECT().List(gomock.Any(), userID, target).Return([]app.Override{
		{
			UserID: userID, Target: target,
			URL:    "https://strang.example/ch3",
			Action: app.ActionHidden, Payload: []byte(`{}`),
		},
	}, nil)

	uc := app.ApplyOverrides{Repo: repo}
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
	ctrl := gomock.NewController(t)
	userID := uuid.New()
	target := app.Target{AtlasNodeID: "ml"}
	r := validResource()
	r.URL = "https://my.example/post"
	payload, _ := domain.ResourceList{r}.Marshal()

	repo := mocks.NewMockOverrideRepo(ctrl)
	repo.EXPECT().List(gomock.Any(), userID, target).Return([]app.Override{
		{
			UserID: userID, Target: target,
			URL: r.URL, Action: app.ActionAdded, Payload: payload,
		},
	}, nil)

	uc := app.ApplyOverrides{Repo: repo}
	out, err := uc.Do(context.Background(), userID, target, nil)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out) != 1 || out[0].URL != "https://my.example/post" {
		t.Errorf("user-added not appended: %+v", out)
	}
}
