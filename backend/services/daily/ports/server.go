// Package ports exposes the daily domain via Connect-RPC.
//
// DailyServer implements druz9v1connect.DailyServiceHandler (generated from
// proto/druz9/v1/daily.proto). It is mounted in main.go via
// NewDailyServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.DailyService/*) and the REST paths declared
// via google.api.http (/api/v1/daily/*).
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/daily/app"
	"druz9/daily/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
)

// Compile-time assertion — DailyServer satisfies the generated handler.
var _ druz9v1connect.DailyServiceHandler = (*DailyServer)(nil)

// DailyServer adapts daily use cases to Connect.
type DailyServer struct {
	H *Handler
}

// NewDailyServer wires a DailyServer around the Handler.
func NewDailyServer(h *Handler) *DailyServer { return &DailyServer{H: h} }

// GetKata implements druz9.v1.DailyService/GetKata.
func (s *DailyServer) GetKata(
	ctx context.Context,
	_ *connect.Request[pb.GetDailyKataRequest],
) (*connect.Response[pb.DailyKata], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	k, err := s.H.GetKata.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("daily.GetKata: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.DailyKata{
		Date:             k.Date.Format("2006-01-02"),
		Task:             toTaskPublicProto(k.Task),
		IsCursed:         k.IsCursed,
		IsWeeklyBoss:     k.IsWeeklyBoss,
		AlreadySubmitted: k.AlreadyDone,
	}), nil
}

// GetKataBySlug implements druz9.v1.DailyService/GetKataBySlug. Unknown slug
// yields connect.CodeNotFound (HTTP 404 via the transcoder) — there is NO
// silent fallback to today's kata.
func (s *DailyServer) GetKataBySlug(
	ctx context.Context,
	req *connect.Request[pb.GetKataBySlugRequest],
) (*connect.Response[pb.GetKataBySlugResponse], error) {
	if _, ok := sharedMw.UserIDFromContext(ctx); !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	slug := req.Msg.GetSlug()
	if slug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("slug is required"))
	}
	t, err := s.H.GetKataBySlug.Do(ctx, slug)
	if err != nil {
		return nil, fmt.Errorf("daily.GetKataBySlug: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.GetKataBySlugResponse{
		Task: toTaskPublicProto(t),
	}), nil
}

// SubmitKata implements druz9.v1.DailyService/SubmitKata.
func (s *DailyServer) SubmitKata(
	ctx context.Context,
	req *connect.Request[pb.SubmitKataRequest],
) (*connect.Response[pb.KataResult], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	if m.GetCode() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("code is required"))
	}
	lang := languageFromProto(m.GetLanguage())
	if !lang.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid language"))
	}
	res, err := s.H.SubmitKata.Do(ctx, app.SubmitKataInput{
		UserID:   uid,
		Code:     m.GetCode(),
		Language: lang.String(),
	})
	if err != nil {
		if errors.Is(err, domain.ErrAlreadySubmitted) {
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}
		return nil, fmt.Errorf("daily.SubmitKata: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(&pb.KataResult{
		Passed:      res.Passed,
		TestsPassed: int32(res.TestsPassed),
		TestsTotal:  int32(res.TestsTotal),
		XpEarned:    int32(res.XPEarned),
		Streak:      toStreakInfoProto(res.Streak),
	}), nil
}

// GetStreak implements druz9.v1.DailyService/GetStreak.
func (s *DailyServer) GetStreak(
	ctx context.Context,
	_ *connect.Request[pb.GetStreakRequest],
) (*connect.Response[pb.StreakInfo], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	info, err := s.H.GetStreak.Do(ctx, uid)
	if err != nil {
		return nil, fmt.Errorf("daily.GetStreak: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toStreakInfoProto(info)), nil
}

// ── error mapping ──────────────────────────────────────────────────────────

func (s *DailyServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrAlreadySubmitted):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, domain.ErrSandboxUnavailable):
		s.H.Log.Warn("daily: sandbox unavailable", slog.Any("err", err))
		return connect.NewError(connect.CodeUnavailable, errors.New("sandbox unavailable"))
	default:
		s.H.Log.Error("daily: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("daily failure"))
	}
}

// ── converters (domain → proto) ────────────────────────────────────────────

func toTaskPublicProto(t domain.TaskPublic) *pb.TaskPublic {
	out := &pb.TaskPublic{
		Id:            t.ID.String(),
		Slug:          t.Slug,
		Title:         t.Title,
		Description:   t.Description,
		Difficulty:    difficultyToProto(t.Difficulty),
		Section:       sectionToProto(t.Section),
		TimeLimitSec:  int32(t.TimeLimitSec),
		MemoryLimitMb: int32(t.MemoryLimitMB),
	}
	if len(t.StarterCode) > 0 {
		out.StarterCode = make(map[string]string, len(t.StarterCode))
		for k, v := range t.StarterCode {
			out.StarterCode[k] = v
		}
	}
	return out
}

func toStreakInfoProto(s domain.StreakInfo) *pb.StreakInfo {
	out := &pb.StreakInfo{
		Current:      int32(s.Current),
		Longest:      int32(s.Longest),
		FreezeTokens: int32(s.FreezeTokens),
	}
	for _, h := range s.History {
		entry := &pb.StreakHistoryEntry{}
		switch {
		case h == nil:
			entry.FreezeUsed = true
		default:
			entry.Passed = *h
		}
		out.History = append(out.History, entry)
	}
	return out
}

// ── enum adapters ──────────────────────────────────────────────────────────

func sectionFromProto(s pb.Section) enums.Section {
	switch s {
	case pb.Section_SECTION_ALGORITHMS:
		return enums.SectionAlgorithms
	case pb.Section_SECTION_SQL:
		return enums.SectionSQL
	case pb.Section_SECTION_GO:
		return enums.SectionGo
	case pb.Section_SECTION_SYSTEM_DESIGN:
		return enums.SectionSystemDesign
	case pb.Section_SECTION_BEHAVIORAL:
		return enums.SectionBehavioral
	case pb.Section_SECTION_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}

func sectionToProto(s enums.Section) pb.Section {
	switch s {
	case enums.SectionAlgorithms:
		return pb.Section_SECTION_ALGORITHMS
	case enums.SectionSQL:
		return pb.Section_SECTION_SQL
	case enums.SectionGo:
		return pb.Section_SECTION_GO
	case enums.SectionSystemDesign:
		return pb.Section_SECTION_SYSTEM_DESIGN
	case enums.SectionBehavioral:
		return pb.Section_SECTION_BEHAVIORAL
	default:
		return pb.Section_SECTION_UNSPECIFIED
	}
}

func difficultyToProto(d enums.Difficulty) pb.Difficulty {
	switch d {
	case enums.DifficultyEasy:
		return pb.Difficulty_DIFFICULTY_EASY
	case enums.DifficultyMedium:
		return pb.Difficulty_DIFFICULTY_MEDIUM
	case enums.DifficultyHard:
		return pb.Difficulty_DIFFICULTY_HARD
	default:
		return pb.Difficulty_DIFFICULTY_UNSPECIFIED
	}
}

func languageFromProto(l pb.Language) enums.Language {
	switch l {
	case pb.Language_LANGUAGE_GO:
		return enums.LanguageGo
	case pb.Language_LANGUAGE_PYTHON:
		return enums.LanguagePython
	case pb.Language_LANGUAGE_JAVASCRIPT:
		return enums.LanguageJavaScript
	case pb.Language_LANGUAGE_TYPESCRIPT:
		return enums.LanguageTypeScript
	case pb.Language_LANGUAGE_SQL:
		return enums.LanguageSQL
	case pb.Language_LANGUAGE_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}
