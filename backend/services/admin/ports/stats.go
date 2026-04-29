// stats.go — Connect-RPC adapter for the public stats / languages /
// onboarding-preview endpoints.
//
// Synthetic data (languages, preview-kata) lives here rather than in the
// app layer because it has no persistence — it's a wire-format contract,
// not business logic. If/when these gain real backing the data layer can
// move to admin/app + admin/infra without touching the proto surface.
package ports

import (
	"context"
	"errors"
	"hash/crc32"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	"druz9/admin/app"
	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
)

type StatsServer struct {
	PublicStatsUC *app.PublicStats
	Incidents     domain.IncidentRepo
	Now           func() time.Time
	Log           *slog.Logger
}

var _ druz9v1connect.StatsServiceHandler = (*StatsServer)(nil)

func (s *StatsServer) GetPublicStats(
	ctx context.Context,
	_ *connect.Request[pb.GetPublicStatsRequest],
) (*connect.Response[pb.PublicStats], error) {
	out, err := s.PublicStatsUC.Do(ctx)
	if err != nil && s.Log != nil {
		// Soft-fail: treat as zeros and log. Same behaviour as the chi
		// handler had — public stats endpoint should never 5xx.
		s.Log.WarnContext(ctx, "stats.GetPublicStats", slog.Any("err", err))
	}
	return connect.NewResponse(&pb.PublicStats{
		UsersCount:   int32(out.UsersCount),
		ActiveToday:  int32(out.ActiveToday),
		MatchesTotal: int32(out.MatchesTotal),
	}), nil
}

// supportedLanguages mirrors the canonical list the chi handler used to
// hard-code. Synthetic counters for now (deterministic per slug — same
// slug always returns the same numbers); real per-language usage stats
// land here when the data layer ships.
var supportedLanguages = []*pb.LanguageItem{
	{Slug: "go", Name: "Go", Symbol: "Go", Color: "#22D3EE"},
	{Slug: "python", Name: "Python", Symbol: "Py", Color: "#582CFF"},
	{Slug: "java", Name: "Java", Symbol: "Jv", Color: "#F472B6"},
	{Slug: "javascript", Name: "JavaScript", Symbol: "JS", Color: "#FBBF24", TextColor: "#0A0A0F"},
	{Slug: "typescript", Name: "TypeScript", Symbol: "TS", Color: "#22D3EE"},
	{Slug: "cpp", Name: "C++", Symbol: "C++", Color: "#2D1B4D"},
	{Slug: "rust", Name: "Rust", Symbol: "Rs", Color: "#EF4444"},
	{Slug: "kotlin", Name: "Kotlin", Symbol: "Kt", Color: "#FBBF24", TextColor: "#0A0A0F"},
	{Slug: "swift", Name: "Swift", Symbol: "Sw", Color: "#F472B6"},
	{Slug: "sql", Name: "SQL", Symbol: "SQL", Color: "#10B981"},
	{Slug: "csharp", Name: "C#", Symbol: "C#", Color: "#6D43FF"},
	{Slug: "ruby", Name: "Ruby", Symbol: "Rb", Color: "#EF4444"},
	{Slug: "php", Name: "PHP", Symbol: "PHP", Color: "#6D43FF"},
}

func (s *StatsServer) ListLanguages(
	_ context.Context,
	_ *connect.Request[pb.ListLanguagesRequest],
) (*connect.Response[pb.LanguageList], error) {
	out := &pb.LanguageList{Items: make([]*pb.LanguageItem, 0, len(supportedLanguages))}
	for _, src := range supportedLanguages {
		sum := crc32.ChecksumIEEE([]byte(src.Slug))
		// Build a fresh proto message rather than copying — proto messages
		// embed sync.Mutex via MessageState and govet's copylocks rejects
		// the value-copy.
		out.Items = append(out.Items, &pb.LanguageItem{
			Slug: src.Slug, Name: src.Name, Symbol: src.Symbol,
			Color: src.Color, TextColor: src.TextColor,
			PlayersActive: int32(sum%5000) + 100,
			KataCount:     int32(sum%50) + 5,
		})
	}
	return connect.NewResponse(out), nil
}

func (s *StatsServer) GetOnboardingPreviewKata(
	_ context.Context,
	_ *connect.Request[pb.GetOnboardingPreviewKataRequest],
) (*connect.Response[pb.OnboardingPreviewKata], error) {
	out := &pb.OnboardingPreviewKata{
		Slug:       "two-sum",
		Title:      "Two Sum",
		Tags:       []string{"Easy", "Hash Map", "Array"},
		Difficulty: "easy",
		Description: "Given an array of integers `nums` and an integer `target`, " +
			"return indices of the two numbers such that they add up to target. " +
			"You may assume that each input has exactly one solution.",
		StarterCode: "func twoSum(nums []int, target int) []int {\n" +
			"  m := map[int]int{}\n" +
			"  for i, v := range nums {\n" +
			"    if j, ok := m[target-v]; ok {\n" +
			"      return []int{j, i}\n" +
			"    }\n" +
			"    m[v] = i\n" +
			"  }\n" +
			"  return nil\n" +
			"}\n",
		TestsTotal:  3,
		TestsPassed: 0,
	}
	return connect.NewResponse(out), nil
}

func (s *StatsServer) GetStatusHistory(
	ctx context.Context,
	req *connect.Request[pb.GetStatusHistoryRequest],
) (*connect.Response[pb.StatusHistoryResponse], error) {
	if s.Incidents == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("history unavailable"))
	}
	days := int(req.Msg.Days)
	if days <= 0 {
		days = 30
	}
	if days > 90 {
		days = 90
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	buckets, err := s.Incidents.DailyBuckets(ctx, req.Msg.Service, days, now)
	if err != nil {
		if s.Log != nil {
			s.Log.WarnContext(ctx, "stats.GetStatusHistory", slog.Any("err", err))
		}
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("history unavailable"))
	}
	out := &pb.StatusHistoryResponse{
		Service: req.Msg.Service,
		Days:    int32(days),
		Buckets: make([]*pb.StatusHistoryDay, 0, len(buckets)),
	}
	for _, b := range buckets {
		out.Buckets = append(out.Buckets, &pb.StatusHistoryDay{
			Day:    b.Day.Format("2006-01-02"),
			Status: string(b.Status),
		})
	}
	return connect.NewResponse(out), nil
}

// Compile-time guard that we implement every generated method.
var _ = errors.New
