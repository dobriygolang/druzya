// Package ports exposes the cohort domain via Connect-RPC.
//
// CohortServer implements druz9v1connect.CohortServiceHandler (generated from
// proto/druz9/v1/cohort.proto). It is mounted in main.go via
// NewCohortServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.CohortService/*) and the REST paths declared
// via google.api.http (/api/v1/cohort/*).
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/cohort/app"
	"druz9/cohort/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — CohortServer satisfies the generated handler.
var _ druz9v1connect.CohortServiceHandler = (*CohortServer)(nil)

// CohortServer adapts cohort use cases to Connect.
type CohortServer struct {
	MyCohortUC   *app.GetMyCohort
	GetUC        *app.GetCohort
	WarUC        *app.GetWar
	ContributeUC *app.Contribute
	TopUC        *app.ListTopCohorts
	Log          *slog.Logger
}

// NewCohortServer wires a CohortServer.
func NewCohortServer(
	my *app.GetMyCohort,
	g *app.GetCohort,
	w *app.GetWar,
	c *app.Contribute,
	top *app.ListTopCohorts,
	log *slog.Logger,
) *CohortServer {
	return &CohortServer{MyCohortUC: my, GetUC: g, WarUC: w, ContributeUC: c, TopUC: top, Log: log}
}

// ListTopCohorts implements druz9.v1.CohortService/ListTopCohorts.
//
// Public — без auth (для не-членов когорты). Раньше был chi-route в rest.go.
func (s *CohortServer) ListTopCohorts(
	ctx context.Context,
	req *connect.Request[pb.ListTopCohortsRequest],
) (*connect.Response[pb.ListTopCohortsResponse], error) {
	limit := int(req.Msg.GetLimit())
	if limit <= 0 {
		limit = domain.DefaultTopCohortsLimit
	}
	out, err := s.TopUC.Do(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("cohort.ListTopCohorts: %w", s.toConnectErr(err))
	}
	items := make([]*pb.TopCohortSummary, 0, len(out))
	for _, g := range out {
		items = append(items, &pb.TopCohortSummary{
			CohortId:     g.CohortID.String(),
			Name:         g.Name,
			Emblem:       g.Emblem,
			MembersCount: int32(g.MembersCount),
			EloTotal:     int32(g.EloTotal),
			WarsWon:      int32(g.WarsWon),
			Rank:         int32(g.Rank),
		})
	}
	return connect.NewResponse(&pb.ListTopCohortsResponse{Items: items}), nil
}

// GetMyCohort implements druz9.v1.CohortService/GetMyCohort.
//
// Sanctum-bug 2026-04: a brand-new user with no cohort membership used to
// trigger a Connect NotFound (HTTP 404 + code:5) which the browser logged
// noisily on /sanctum even though SanctumPage handles "no cohort" gracefully.
// Fix: surface the empty state as a successful response with an empty Cohort
// proto (id == ""). Frontend treats that as null. NetTab no longer screams.
func (s *CohortServer) GetMyCohort(
	ctx context.Context,
	_ *connect.Request[pb.GetMyCohortRequest],
) (*connect.Response[pb.Cohort], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	g, err := s.MyCohortUC.Do(ctx, uid)
	if err != nil {
		// Honest empty state for "no cohort yet" — return an empty Cohort
		// envelope rather than 404. Real backend errors still propagate.
		if errors.Is(err, domain.ErrNotFound) {
			return connect.NewResponse(&pb.Cohort{}), nil
		}
		return nil, fmt.Errorf("cohort.GetMyCohort: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toCohortProto(g)), nil
}

// GetCohort implements druz9.v1.CohortService/GetCohort.
func (s *CohortServer) GetCohort(
	ctx context.Context,
	req *connect.Request[pb.GetCohortRequest],
) (*connect.Response[pb.Cohort], error) {
	cohortID, err := uuid.Parse(req.Msg.GetCohortId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cohort_id: %w", err))
	}
	g, err := s.GetUC.Do(ctx, cohortID)
	if err != nil {
		return nil, fmt.Errorf("cohort.GetCohort: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toCohortProto(g)), nil
}

// GetWar implements druz9.v1.CohortService/GetWar.
func (s *CohortServer) GetWar(
	ctx context.Context,
	req *connect.Request[pb.GetCohortWarRequest],
) (*connect.Response[pb.CohortWar], error) {
	cohortID, err := uuid.Parse(req.Msg.GetCohortId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cohort_id: %w", err))
	}
	view, err := s.WarUC.Do(ctx, cohortID)
	if err != nil {
		return nil, fmt.Errorf("cohort.GetWar: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWarProto(view)), nil
}

// Contribute implements druz9.v1.CohortService/Contribute.
func (s *CohortServer) Contribute(
	ctx context.Context,
	req *connect.Request[pb.ContributeRequest],
) (*connect.Response[pb.CohortWar], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	cohortID, err := uuid.Parse(m.GetCohortId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cohort_id: %w", err))
	}
	out, err := s.ContributeUC.Do(ctx, app.ContributeInput{
		CohortID: cohortID,
		UserID:   uid,
		Section:  sectionFromProto(m.GetSection()),
		Code:     m.GetCode(),
		Language: languageFromProto(m.GetLanguage()),
	})
	if err != nil {
		return nil, fmt.Errorf("cohort.Contribute: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWarProto(out.WarView)), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *CohortServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrNotMember),
		errors.Is(err, domain.ErrCohortMismatch):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrWrongSection),
		errors.Is(err, domain.ErrWarNotActive),
		errors.Is(err, domain.ErrCodeTooLarge),
		errors.Is(err, domain.ErrInvalidSection),
		errors.Is(err, domain.ErrInvalidLanguage):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		// Unknown error path = 500. Логируем ПОЛНУЮ цепочку ошибок через %+v,
		// чтобы в Grafana Loki можно было отфильтровать по подстроке "cohort:"
		// и сразу увидеть где именно упало (сache/pg/war/singleflight/...).
		// Клиенту отдаём opaque "cohort failure" без утечки внутренностей.
		if s.Log != nil {
			s.Log.Error("cohort: unexpected error",
				slog.String("err", fmt.Sprintf("%+v", err)),
				slog.String("err_type", fmt.Sprintf("%T", err)))
		}
		return connect.NewError(connect.CodeInternal, errors.New("cohort failure"))
	}
}

// ── converters (domain → proto) ────────────────────────────────────────────

func toCohortProto(g domain.Cohort) *pb.Cohort {
	out := &pb.Cohort{
		Id:        g.ID.String(),
		Name:      g.Name,
		Emblem:    g.Emblem,
		CohortElo: int32(g.CohortElo),
		Members:   make([]*pb.CohortMember, 0, len(g.Members)),
	}
	if g.CurrentWarID != nil {
		out.CurrentWarId = g.CurrentWarID.String()
	}
	for _, m := range g.Members {
		gm := &pb.CohortMember{
			UserId:   m.UserID.String(),
			Username: m.Username,
			Role:     m.Role,
		}
		if !m.JoinedAt.IsZero() {
			gm.JoinedAt = timestamppb.New(m.JoinedAt.UTC())
		}
		if m.AssignedSection != nil {
			gm.AssignedSection = sectionToProto(*m.AssignedSection)
		}
		out.Members = append(out.Members, gm)
	}
	return out
}

func toWarProto(v app.WarView) *pb.CohortWar {
	out := &pb.CohortWar{
		Id:        v.War.ID.String(),
		WeekStart: v.War.WeekStart.Format("2006-01-02"),
		WeekEnd:   v.War.WeekEnd.Format("2006-01-02"),
		CohortA: &pb.CohortSummary{
			Id:     v.CohortA.ID.String(),
			Name:   v.CohortA.Name,
			Emblem: v.CohortA.Emblem,
		},
		CohortB: &pb.CohortSummary{
			Id:     v.CohortB.ID.String(),
			Name:   v.CohortB.Name,
			Emblem: v.CohortB.Emblem,
		},
		Lines: make([]*pb.WarLine, 0, len(v.Lines)),
	}
	if v.War.WinnerID != nil {
		out.WinnerCohortId = v.War.WinnerID.String()
	}
	for _, l := range v.Lines {
		line := &pb.WarLine{
			Section: sectionToProto(l.Section),
			ScoreA:  int32(l.ScoreA),
			ScoreB:  int32(l.ScoreB),
		}
		for _, c := range l.Contributors {
			line.Contributors = append(line.Contributors, &pb.WarLineContributor{
				UserId:   c.UserID.String(),
				Username: c.Username,
				Side:     string(c.Side),
				Score:    int32(c.Score),
			})
		}
		out.Lines = append(out.Lines, line)
	}
	return out
}

// ── common enum adapters (shared with other domain ports in the same module) ──

func sectionFromProto(s pb.Section) enums.Section {
	switch s {
	case pb.Section_SECTION_UNSPECIFIED:
		return ""
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

func languageFromProto(l pb.Language) enums.Language {
	switch l {
	case pb.Language_LANGUAGE_UNSPECIFIED:
		return ""
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
	default:
		return ""
	}
}
