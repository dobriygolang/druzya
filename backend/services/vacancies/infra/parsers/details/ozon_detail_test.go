package details

import (
	"context"
	"testing"

	"druz9/vacancies/domain"
)

func TestOzonDetail_NoOpReturnsListingWithSourceOnly(t *testing.T) {
	t.Parallel()
	f := NewOzon(testLog())
	listing := domain.Vacancy{Source: domain.SourceOzon, ExternalID: "abc", Title: "Backend"}
	d, err := f.FetchDetails(context.Background(), "abc", listing)
	if err != nil {
		t.Fatalf("FetchDetails: %v", err)
	}
	if !d.SourceOnly {
		t.Errorf("SourceOnly should be true for Ozon (no JSON detail endpoint)")
	}
	if d.Vacancy.Title != "Backend" {
		t.Errorf("listing pass-through lost")
	}
	if d.DescriptionHTML != "" {
		t.Errorf("anti-fallback: must NOT fabricate description, got: %q", d.DescriptionHTML)
	}
}
