// Package ports exposes the guild domain via Connect-RPC.
//
// GuildServer implements druz9v1connect.GuildServiceHandler (generated from
// proto/druz9/v1/guild.proto). It is mounted in main.go via
// NewGuildServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.GuildService/*) and the REST paths declared
// via google.api.http (/api/v1/guild/*).
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/guild/app"
	"druz9/guild/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — GuildServer satisfies the generated handler.
var _ druz9v1connect.GuildServiceHandler = (*GuildServer)(nil)

// GuildServer adapts guild use cases to Connect.
type GuildServer struct {
	MyGuildUC    *app.GetMyGuild
	GetUC        *app.GetGuild
	WarUC        *app.GetWar
	ContributeUC *app.Contribute
	TopUC        *app.ListTopGuilds
	Log          *slog.Logger
}

// NewGuildServer wires a GuildServer.
func NewGuildServer(
	my *app.GetMyGuild,
	g *app.GetGuild,
	w *app.GetWar,
	c *app.Contribute,
	top *app.ListTopGuilds,
	log *slog.Logger,
) *GuildServer {
	return &GuildServer{MyGuildUC: my, GetUC: g, WarUC: w, ContributeUC: c, TopUC: top, Log: log}
}

// ListTopGuilds implements druz9.v1.GuildService/ListTopGuilds.
//
// Public — без auth (для не-членов гильдии). Раньше был chi-route в rest.go.
func (s *GuildServer) ListTopGuilds(
	ctx context.Context,
	req *connect.Request[pb.ListTopGuildsRequest],
) (*connect.Response[pb.ListTopGuildsResponse], error) {
	limit := int(req.Msg.GetLimit())
	if limit <= 0 {
		limit = domain.DefaultTopGuildsLimit
	}
	out, err := s.TopUC.Do(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("guild.ListTopGuilds: %w", s.toConnectErr(err))
	}
	items := make([]*pb.TopGuildSummary, 0, len(out))
	for _, g := range out {
		items = append(items, &pb.TopGuildSummary{
			GuildId:      g.GuildID.String(),
			Name:         g.Name,
			Emblem:       g.Emblem,
			MembersCount: int32(g.MembersCount),
			EloTotal:     int32(g.EloTotal),
			WarsWon:      int32(g.WarsWon),
			Rank:         int32(g.Rank),
		})
	}
	return connect.NewResponse(&pb.ListTopGuildsResponse{Items: items}), nil
}

// GetMyGuild implements druz9.v1.GuildService/GetMyGuild.
//
// Sanctum-bug 2026-04: a brand-new user with no guild membership used to
// trigger a Connect NotFound (HTTP 404 + code:5) which the browser logged
// noisily on /sanctum even though SanctumPage handles "no guild" gracefully.
// Fix: surface the empty state as a successful response with an empty Guild
// proto (id == ""). Frontend treats that as null. NetTab no longer screams.
func (s *GuildServer) GetMyGuild(
	ctx context.Context,
	_ *connect.Request[pb.GetMyGuildRequest],
) (*connect.Response[pb.Guild], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	g, err := s.MyGuildUC.Do(ctx, uid)
	if err != nil {
		// Honest empty state for "no guild yet" — return an empty Guild
		// envelope rather than 404. Real backend errors still propagate.
		if errors.Is(err, domain.ErrNotFound) {
			return connect.NewResponse(&pb.Guild{}), nil
		}
		return nil, fmt.Errorf("guild.GetMyGuild: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toGuildProto(g)), nil
}

// GetGuild implements druz9.v1.GuildService/GetGuild.
func (s *GuildServer) GetGuild(
	ctx context.Context,
	req *connect.Request[pb.GetGuildRequest],
) (*connect.Response[pb.Guild], error) {
	guildID, err := uuid.Parse(req.Msg.GetGuildId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid guild_id: %w", err))
	}
	g, err := s.GetUC.Do(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("guild.GetGuild: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toGuildProto(g)), nil
}

// GetWar implements druz9.v1.GuildService/GetWar.
func (s *GuildServer) GetWar(
	ctx context.Context,
	req *connect.Request[pb.GetGuildWarRequest],
) (*connect.Response[pb.GuildWar], error) {
	guildID, err := uuid.Parse(req.Msg.GetGuildId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid guild_id: %w", err))
	}
	view, err := s.WarUC.Do(ctx, guildID)
	if err != nil {
		return nil, fmt.Errorf("guild.GetWar: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWarProto(view)), nil
}

// Contribute implements druz9.v1.GuildService/Contribute.
func (s *GuildServer) Contribute(
	ctx context.Context,
	req *connect.Request[pb.ContributeRequest],
) (*connect.Response[pb.GuildWar], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	m := req.Msg
	guildID, err := uuid.Parse(m.GetGuildId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid guild_id: %w", err))
	}
	out, err := s.ContributeUC.Do(ctx, app.ContributeInput{
		GuildID:  guildID,
		UserID:   uid,
		Section:  sectionFromProto(m.GetSection()),
		Code:     m.GetCode(),
		Language: languageFromProto(m.GetLanguage()),
	})
	if err != nil {
		return nil, fmt.Errorf("guild.Contribute: %w", s.toConnectErr(err))
	}
	return connect.NewResponse(toWarProto(out.WarView)), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *GuildServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrNotMember),
		errors.Is(err, domain.ErrGuildMismatch):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, domain.ErrWrongSection),
		errors.Is(err, domain.ErrWarNotActive),
		errors.Is(err, domain.ErrCodeTooLarge),
		errors.Is(err, domain.ErrInvalidSection),
		errors.Is(err, domain.ErrInvalidLanguage):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		if s.Log != nil {
			s.Log.Error("guild: unexpected error", slog.Any("err", err))
		}
		return connect.NewError(connect.CodeInternal, errors.New("guild failure"))
	}
}

// ── converters (domain → proto) ────────────────────────────────────────────

func toGuildProto(g domain.Guild) *pb.Guild {
	out := &pb.Guild{
		Id:       g.ID.String(),
		Name:     g.Name,
		Emblem:   g.Emblem,
		GuildElo: int32(g.GuildElo),
		Members:  make([]*pb.GuildMember, 0, len(g.Members)),
	}
	if g.CurrentWarID != nil {
		out.CurrentWarId = g.CurrentWarID.String()
	}
	for _, m := range g.Members {
		gm := &pb.GuildMember{
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

func toWarProto(v app.WarView) *pb.GuildWar {
	out := &pb.GuildWar{
		Id:        v.War.ID.String(),
		WeekStart: v.War.WeekStart.Format("2006-01-02"),
		WeekEnd:   v.War.WeekEnd.Format("2006-01-02"),
		GuildA: &pb.GuildSummary{
			Id:     v.GuildA.ID.String(),
			Name:   v.GuildA.Name,
			Emblem: v.GuildA.Emblem,
		},
		GuildB: &pb.GuildSummary{
			Id:     v.GuildB.ID.String(),
			Name:   v.GuildB.Name,
			Emblem: v.GuildB.Emblem,
		},
		Lines: make([]*pb.WarLine, 0, len(v.Lines)),
	}
	if v.War.WinnerID != nil {
		out.WinnerGuildId = v.War.WinnerID.String()
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
