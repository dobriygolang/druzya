package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/admin/domain"
	"druz9/admin/domain/mocks"

	"go.uber.org/mock/gomock"
)

func TestGetStatus_Do_OperationalAggregation(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	prober := mocks.NewMockStatusProber(ctrl)
	prober.EXPECT().Probe(gomock.Any()).Return([]domain.StatusServiceState{
		{Name: "PostgreSQL", Slug: "postgres", Status: domain.StatusOperational, Uptime30D: 100},
		{Name: "Redis", Slug: "redis", Status: domain.StatusOperational, Uptime30D: 100},
	}, nil)
	incidents := mocks.NewMockIncidentRepo(ctrl)
	incidents.EXPECT().Recent(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	incidents.EXPECT().DowntimeSeconds(gomock.Any(), gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	incidents.EXPECT().DailyBuckets(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()

	uc := &GetStatus{
		Prober:    prober,
		Incidents: incidents,
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
	ctrl := gomock.NewController(t)
	prober := mocks.NewMockStatusProber(ctrl)
	prober.EXPECT().Probe(gomock.Any()).Return([]domain.StatusServiceState{
		{Name: "PostgreSQL", Slug: "postgres", Status: domain.StatusOperational},
		{Name: "Redis", Slug: "redis", Status: domain.StatusDegraded},
		{Name: "Judge0", Slug: "judge0", Status: domain.StatusOperational},
	}, nil)
	incidents := mocks.NewMockIncidentRepo(ctrl)
	incidents.EXPECT().Recent(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	incidents.EXPECT().DowntimeSeconds(gomock.Any(), gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	incidents.EXPECT().DailyBuckets(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	uc := &GetStatus{
		Prober:    prober,
		Incidents: incidents,
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
	ctrl := gomock.NewController(t)
	prober := mocks.NewMockStatusProber(ctrl)
	prober.EXPECT().Probe(gomock.Any()).Return([]domain.StatusServiceState{
		{Name: "PostgreSQL", Slug: "postgres", Status: domain.StatusDegraded},
		{Name: "Redis", Slug: "redis", Status: domain.StatusDown},
	}, nil)
	incidents := mocks.NewMockIncidentRepo(ctrl)
	incidents.EXPECT().Recent(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	incidents.EXPECT().DowntimeSeconds(gomock.Any(), gomock.Any(), gomock.Any()).Return(int64(0), nil).AnyTimes()
	incidents.EXPECT().DailyBuckets(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	uc := &GetStatus{
		Prober:    prober,
		Incidents: incidents,
	}
	page, _ := uc.Do(context.Background())
	if page.OverallStatus != domain.StatusDown {
		t.Fatalf("overall: want down, got %s", page.OverallStatus)
	}
}

func TestGetStatus_Do_UptimeFromDowntime(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	// 90d window = 7,776,000 sec. 60s downtime ⇒ ≈99.99923%.
	prober := mocks.NewMockStatusProber(ctrl)
	prober.EXPECT().Probe(gomock.Any()).Return(nil, nil)
	incidents := mocks.NewMockIncidentRepo(ctrl)
	incidents.EXPECT().Recent(gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	incidents.EXPECT().DowntimeSeconds(gomock.Any(), gomock.Any(), gomock.Any()).Return(int64(60), nil).AnyTimes()
	incidents.EXPECT().DailyBuckets(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()
	uc := &GetStatus{
		Prober:    prober,
		Incidents: incidents,
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
	ctrl := gomock.NewController(t)
	want := errors.New("probe boom")
	prober := mocks.NewMockStatusProber(ctrl)
	prober.EXPECT().Probe(gomock.Any()).Return(nil, want)
	incidents := mocks.NewMockIncidentRepo(ctrl)
	uc := &GetStatus{
		Prober:    prober,
		Incidents: incidents,
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
