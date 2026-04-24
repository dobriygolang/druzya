package cache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"druz9/vacancies/domain"
)

// stubListing implements listingReader.
type stubListing struct {
	v   domain.Vacancy
	err error
}

func (s *stubListing) Get(_ domain.Source, _ string) (domain.Vacancy, error) {
	return s.v, s.err
}

// stubFetcher counts FetchDetails calls; the produced VacancyDetails embeds
// listing and tags the call number into OurTeam so tests can assert the
// served entry didn't change unexpectedly.
type stubFetcher struct {
	src     domain.Source
	calls   atomic.Int64
	delay   time.Duration
	failNum int32
}

func (f *stubFetcher) Source() domain.Source { return f.src }
func (f *stubFetcher) FetchDetails(_ context.Context, externalID string, listing domain.Vacancy) (domain.VacancyDetails, error) {
	n := f.calls.Add(1)
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.failNum != 0 && int32(n) == f.failNum {
		return domain.VacancyDetails{}, errors.New("simulated fetch failure")
	}
	return domain.VacancyDetails{
		Vacancy:         listing,
		DescriptionHTML: "<p>fetch " + externalID + "</p>",
	}, nil
}

// fakeClock lets us advance time deterministically.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (f *fakeClock) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}
func (f *fakeClock) advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.now = f.now.Add(d)
}

func TestDetailsCache_Singleflight(t *testing.T) {
	t.Parallel()
	listing := &stubListing{v: domain.Vacancy{Source: domain.SourceYandex, ExternalID: "x", Title: "T"}}
	f := &stubFetcher{src: domain.SourceYandex, delay: 50 * time.Millisecond}
	dc := NewDetails(listing, []DetailFetcher{f}, testLog(), DetailsOptions{})

	const N = 100
	var wg sync.WaitGroup
	wg.Add(N)
	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			_, err := dc.Get(context.Background(), domain.SourceYandex, "x")
			if err != nil {
				t.Errorf("Get: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := f.calls.Load(); got != 1 {
		t.Errorf("singleflight: expected exactly 1 fetch, got %d", got)
	}
}

func TestDetailsCache_StaleWhileRevalidate(t *testing.T) {
	t.Parallel()
	listing := &stubListing{v: domain.Vacancy{Source: domain.SourceYandex, ExternalID: "x", Title: "T"}}
	f := &stubFetcher{src: domain.SourceYandex}
	clk := &fakeClock{now: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
	dc := NewDetails(listing, []DetailFetcher{f}, testLog(), DetailsOptions{TTL: time.Hour, Clock: clk})

	// Cold miss → 1 fetch
	if _, err := dc.Get(context.Background(), domain.SourceYandex, "x"); err != nil {
		t.Fatalf("cold miss: %v", err)
	}
	if got := f.calls.Load(); got != 1 {
		t.Fatalf("expected 1 fetch after cold miss, got %d", got)
	}

	// Within TTL → no extra fetch
	clk.advance(30 * time.Minute)
	if _, err := dc.Get(context.Background(), domain.SourceYandex, "x"); err != nil {
		t.Fatalf("fresh hit: %v", err)
	}
	if got := f.calls.Load(); got != 1 {
		t.Fatalf("fresh hit triggered extra fetch: %d", got)
	}

	// Past TTL → serves stale, kicks background refresh
	clk.advance(2 * time.Hour)
	if _, err := dc.Get(context.Background(), domain.SourceYandex, "x"); err != nil {
		t.Fatalf("stale read: %v", err)
	}
	// Background refresh runs in a goroutine; poll briefly.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if f.calls.Load() == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := f.calls.Load(); got != 2 {
		t.Fatalf("stale-while-revalidate did not refresh: calls=%d", got)
	}
}

func TestDetailsCache_FailureDegradesToListing(t *testing.T) {
	t.Parallel()
	listing := &stubListing{v: domain.Vacancy{Source: domain.SourceYandex, ExternalID: "x", Title: "T"}}
	// Always-failing fetcher
	f := &stubFetcher{src: domain.SourceYandex, failNum: 1}
	dc := NewDetails(listing, []DetailFetcher{f}, testLog(), DetailsOptions{})
	d, err := dc.Get(context.Background(), domain.SourceYandex, "x")
	if err != nil {
		t.Fatalf("failure should be downgraded, not returned: %v", err)
	}
	if d.Vacancy.Title != "T" {
		t.Errorf("listing not preserved on failure: %+v", d)
	}
	if d.DescriptionHTML != "" {
		t.Errorf("anti-fallback violated: rich block populated despite failure: %q", d.DescriptionHTML)
	}
}

func TestDetailsCache_ListingNotFound(t *testing.T) {
	t.Parallel()
	listing := &stubListing{err: domain.ErrNotFound}
	f := &stubFetcher{src: domain.SourceYandex}
	dc := NewDetails(listing, []DetailFetcher{f}, testLog(), DetailsOptions{})
	if _, err := dc.Get(context.Background(), domain.SourceYandex, "x"); err == nil {
		t.Fatalf("expected ErrNotFound")
	} else if !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("error chain: %v", err)
	}
}
