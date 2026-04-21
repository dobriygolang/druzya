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
	"time"

	"druz9/daily/app"
	"druz9/daily/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
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

// GetCalendar implements druz9.v1.DailyService/GetCalendar.
func (s *DailyServer) GetCalendar(
	ctx context.Context,
	_ *connect.Request[pb.GetCalendarRequest],
) (*connect.Response[pb.InterviewCalendar], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	c, err := s.H.GetCalendar.Do(ctx, uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, fmt.Errorf("daily.GetCalendar: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toCalendarProto(c)), nil
}

// UpsertCalendar implements druz9.v1.DailyService/UpsertCalendar.
func (s *DailyServer) UpsertCalendar(
	ctx context.Context,
	req *connect.Request[pb.UpsertCalendarRequest],
) (*connect.Response[pb.InterviewCalendar], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	companyID, err := uuid.Parse(m.GetCompanyId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid company_id: %w", err))
	}
	interviewDate, err := time.Parse("2006-01-02", m.GetInterviewDate())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid interview_date: %w", err))
	}
	c, err := s.H.UpsertCalendar.Do(ctx, app.UpsertCalendarInput{
		UserID:        uid,
		CompanyID:     companyID,
		Role:          m.GetRole(),
		InterviewDate: interviewDate,
		CurrentLevel:  m.GetCurrentLevel(),
	})
	if err != nil {
		return nil, fmt.Errorf("daily.UpsertCalendar: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toCalendarProto(c)), nil
}

// CreateAutopsy implements druz9.v1.DailyService/CreateAutopsy.
func (s *DailyServer) CreateAutopsy(
	ctx context.Context,
	req *connect.Request[pb.CreateAutopsyRequest],
) (*connect.Response[pb.InterviewAutopsy], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	companyID, err := uuid.Parse(m.GetCompanyId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid company_id: %w", err))
	}
	section := sectionFromProto(m.GetSection())
	if !section.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid section"))
	}
	outcome := domain.AutopsyOutcome(m.GetOutcome())
	if !outcome.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid outcome"))
	}
	var interviewDate *time.Time
	if raw := m.GetInterviewDate(); raw != "" {
		d, parseErr := time.Parse("2006-01-02", raw)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid interview_date: %w", parseErr))
		}
		interviewDate = &d
	}
	a, err := s.H.CreateAutopsy.Do(ctx, app.CreateAutopsyInput{
		UserID:        uid,
		CompanyID:     companyID,
		Section:       section,
		Outcome:       outcome,
		InterviewDate: interviewDate,
		Questions:     m.GetQuestions(),
		Answers:       m.GetAnswers(),
		Notes:         m.GetNotes(),
	})
	if err != nil {
		return nil, fmt.Errorf("daily.CreateAutopsy: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toAutopsyProto(a)), nil
}

// GetAutopsy implements druz9.v1.DailyService/GetAutopsy.
func (s *DailyServer) GetAutopsy(
	ctx context.Context,
	req *connect.Request[pb.GetAutopsyRequest],
) (*connect.Response[pb.InterviewAutopsy], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	autopsyID, err := uuid.Parse(req.Msg.GetAutopsyId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid autopsy_id: %w", err))
	}
	a, err := s.H.GetAutopsy.Do(ctx, autopsyID)
	if err != nil {
		return nil, fmt.Errorf("daily.GetAutopsy: %w", s.toConnectErr(err))
	}
	if a.UserID != uid {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("not owner"))
	}
	return connect.NewResponse(toAutopsyProto(a)), nil
}

// ── error mapping ──────────────────────────────────────────────────────────

func (s *DailyServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrAlreadySubmitted):
		return connect.NewError(connect.CodeAlreadyExists, err)
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

func toCalendarProto(c domain.InterviewCalendar) *pb.InterviewCalendar {
	out := &pb.InterviewCalendar{
		Id:            c.ID.String(),
		Role:          c.Role,
		InterviewDate: c.InterviewDate.Format("2006-01-02"),
		DaysLeft:      int32(c.DaysLeft),
		ReadinessPct:  int32(c.ReadinessPct),
	}
	if c.CompanyID != (uuid.UUID{}) {
		out.CompanyId = c.CompanyID.String()
	}
	return out
}

func toAutopsyProto(a domain.Autopsy) *pb.InterviewAutopsy {
	out := &pb.InterviewAutopsy{
		Id:      a.ID.String(),
		Status:  string(a.Status),
		Outcome: a.Outcome.String(),
	}
	if !a.CreatedAt.IsZero() {
		out.CreatedAt = timestamppb.New(a.CreatedAt.UTC())
	}
	if a.ShareSlug != "" {
		out.ShareUrl = "/autopsy/" + a.ShareSlug
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
