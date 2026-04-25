package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/admin/domain"
)

type fakeProber struct {
	out []domain.StatusServiceState
	err error
}

func (f *fakeProber) Probe(_ context.Context) ([]domain.StatusServiceState, error) {
	return f.out, f.err
}

type fakeIncidents struct {
	recent   []domain.StatusIncident
	downtime int64
	err      error
}

func (f *fakeIncidents) Recent(_ context.Context, _ int) ([]domain.StatusIncident, error) {
	return f.recent, f.err
}
func (f *fakeIncidents) DowntimeSeconds(_ context.Context, _ time.Duration, _ time.Time) (int64, error) {
	return f.downtime, f.err
}
func (f *fakeIncidents) DailyBuckets(_ context.Context, _ string, _ int, _ time.Time) ([]domain.StatusDayBucket, error) {
	return nil, f.err
}

func TestGetStatus_Do_OperationalAggregation(t *testing.T) {
	t.Parallel()
	uc := &GetStatus{
		Prober: &fakeProber{out: []domain.StatusServiceState{
			{Name: "PostgreSQL", Slug: "postgres", Status: domain.StatusOperational, Uptime30D: 100},
			{Name: "Redis", Slug: "redis", Status: domain.StatusOperational, Uptime30D: 100},
		}},
		Incidents: &fakeIncidents{},
		Now:       func() time.Time { return time.Unix(1700000000, 0) },
	}
	page, err := uc.Do(context.Background())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if page.OverallStatus != domain.StatusOperational {
		t.Fatalf("overall: want operational, got %s", page.OverallStatus)
	}
	if page.Uptime90D != 100.0 {
		t.Fatalf("uptime90d: want 100, got %f", page.Uptime90D)
	}
}

func TestGetStatus_Do_DegradedAggregation(t *testing.T) {
	t.Parallel()
	uc := &GetStatus{
		Prober: &fakeProber{out: []domain.StatusServiceState{
			{Name: "PostgreSQL", Slug: "postgres", Status: domain.StatusOperational},
			{Name: "Redis", Slug: "redis", Status: domain.StatusDegraded},
			{Name: "Judge0", Slug: "judge0", Status: domain.StatusOperational},
		}},
		Incidents: &fakeIncidents{},
	}
	page, err := uc.Do(context.Background())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if page.OverallStatus != domain.StatusDegraded {
		t.Fatalf("overall: want degraded, got %s", page.OverallStatus)
	}
}

func TestGetStatus_Do_DownBeatsDegraded(t *testing.T) {
	t.Parallel()
	uc := &GetStatus{
		Prober: &fakeProber{out: []domain.StatusServiceState{
			{Name: "PostgreSQL", Slug: "postgres", Status: domain.StatusDegraded},
			{Name: "Redis", Slug: "redis", Status: domain.StatusDown},
		}},
		Incidents: &fakeIncidents{},
	}
	page, _ := uc.Do(context.Background())
	if page.OverallStatus != domain.StatusDown {
		t.Fatalf("overall: want down, got %s", page.OverallStatus)
	}
}

func TestGetStatus_Do_UptimeFromDowntime(t *testing.T) {
	t.Parallel()
	// 90d window = 7,776,000 sec. 60s downtime ⇒ ≈99.99923%.
	uc := &GetStatus{
		Prober:    &fakeProber{out: nil},
		Incidents: &fakeIncidents{downtime: 60},
	}
	page, err := uc.Do(context.Background())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if page.Uptime90D >= 100 {
		t.Fatalf("downtime should drop uptime, got %f", page.Uptime90D)
	}
	if page.Uptime90D < 99.99 {
		t.Fatalf("60s of downtime over 90d should be ≥ 99.99%%, got %f", page.Uptime90D)
	}
}

func TestGetStatus_Do_ProbeErrorPropagates(t *testing.T) {
	t.Parallel()
	want := errors.New("probe boom")
	uc := &GetStatus{
		Prober:    &fakeProber{err: want},
		Incidents: &fakeIncidents{},
	}
	if _, err := uc.Do(context.Background()); !errors.Is(err, want) {
		t.Fatalf("expected probe error to wrap, got %v", err)
	}
}

func TestUptimePercent_Bounds(t *testing.T) {
	t.Parallel()
	if got := uptimePercent(0, 0); got != 100.0 {
		t.Fatalf("zero window must return 100, got %f", got)
	}
	if got := uptimePercent(int64(time.Hour.Seconds())*1000, time.Hour); got != 0 {
		t.Fatalf("downtime > window must clamp at 0, got %f", got)
	}
	w := 7 * 24 * time.Hour
	got := uptimePercent(int64(w.Seconds()/2), w)
	if got < 49.99 || got > 50.01 {
		t.Fatalf("half-down should be ≈50%%, got %f", got)
	}
}
