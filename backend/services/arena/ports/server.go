// Package ports exposes the arena domain via Connect-RPC.
//
// ArenaServer implements druz9v1connect.ArenaServiceHandler (generated from
// proto/druz9/v1/arena.proto). It is mounted in main.go via
// NewArenaServiceHandler + vanguard, so the same handlers serve both the
// native Connect path (/druz9.v1.ArenaService/*) and the REST paths
// (/api/v1/arena/*) declared via google.api.http annotations.
//
// The /ws/arena/{matchId} WebSocket is NOT part of Connect — it stays in
// ws.go / ws_handler.go as a raw chi route.
package ports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"druz9/arena/app"
	"druz9/arena/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Compile-time assertion — ArenaServer satisfies the generated handler.
var _ druz9v1connect.ArenaServiceHandler = (*ArenaServer)(nil)

// ArenaServer adapts arena use cases to the Connect handler interface.
type ArenaServer struct {
	Find      *app.FindMatch
	Cancel    *app.CancelSearch
	Confirm   *app.ConfirmReady
	Submit    *app.SubmitCode
	Get       *app.GetMatch
	History   *app.GetMyMatches
	Timeouts  *app.HandleReadyCheckTimeout
	UserEloFn UserEloFunc
	Log       *slog.Logger
}

// UserEloFunc resolves the user's ELO for a section. Injected so arena stays
// decoupled from the rating domain (no cross-imports).
type UserEloFunc func(ctx any, userID uuid.UUID, section enums.Section) int

// NewArenaServer wires an ArenaServer.
func NewArenaServer(
	find *app.FindMatch,
	cancel *app.CancelSearch,
	confirm *app.ConfirmReady,
	submit *app.SubmitCode,
	get *app.GetMatch,
	history *app.GetMyMatches,
	timeouts *app.HandleReadyCheckTimeout,
	eloFn UserEloFunc,
	log *slog.Logger,
) *ArenaServer {
	return &ArenaServer{
		Find: find, Cancel: cancel, Confirm: confirm, Submit: submit, Get: get,
		History:  history,
		Timeouts: timeouts, UserEloFn: eloFn, Log: log,
	}
}

// GetMyMatches implements (GET /api/v1/arena/matches/my).
//
// Возвращает страницу истории матчей текущего пользователя (filters по
// mode/section). Раньше был chi-route в history.go (теперь удалён).
func (s *ArenaServer) GetMyMatches(
	ctx context.Context,
	req *connect.Request[pb.GetMyMatchesRequest],
) (*connect.Response[pb.GetMyMatchesResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	mode := arenaModeFromProto(req.Msg.GetMode())
	section := sectionFromProto(req.Msg.GetSection())
	out, err := s.History.Do(ctx, app.GetMyMatchesInput{
		UserID:  uid,
		Limit:   int(req.Msg.GetLimit()),
		Offset:  int(req.Msg.GetOffset()),
		Mode:    mode,
		Section: section,
	})
	if err != nil {
		return nil, fmt.Errorf("arena.GetMyMatches: %w", s.toConnectErr(err))
	}
	items := make([]*pb.MatchHistoryEntry, 0, len(out.Items))
	for _, e := range out.Items {
		items = append(items, &pb.MatchHistoryEntry{
			MatchId:           e.MatchID.String(),
			FinishedAt:        timestamppb.New(e.FinishedAt),
			Mode:              arenaModeToProto(e.Mode),
			Section:           sectionToProto(e.Section),
			OpponentUsername:  e.OpponentUsername,
			OpponentAvatarUrl: e.OpponentAvatarURL,
			Result:            e.Result,
			LpChange:          int32(e.LPChange),
			DurationSeconds:   int32(e.DurationSeconds),
		})
	}
	return connect.NewResponse(&pb.GetMyMatchesResponse{
		Items: items,
		Total: int32(out.Total),
	}), nil
}

// ── Connect handlers ──────────────────────────────────────────────────────

// FindMatch implements (POST /api/v1/arena/match/find).
func (s *ArenaServer) FindMatch(
	ctx context.Context,
	req *connect.Request[pb.FindMatchRequest],
) (*connect.Response[pb.MatchQueueResponse], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	section := sectionFromProto(req.Msg.GetSection())
	mode := arenaModeFromProto(req.Msg.GetMode())
	if !section.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid section"))
	}
	if !mode.IsValid() {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("invalid mode"))
	}
	elo := domain.InitialELO
	if s.UserEloFn != nil {
		elo = s.UserEloFn(ctx, uid, section)
	}
	out, err := s.Find.Do(ctx, app.EnqueueInput{
		UserID:  uid,
		Elo:     elo,
		Section: section,
		Mode:    mode,
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	resp := &pb.MatchQueueResponse{
		Status:           out.Status,
		QueuePosition:    int32(out.QueuePosition),
		EstimatedWaitSec: int32(out.EstWaitSec),
	}
	if out.MatchID != nil {
		resp.MatchId = out.MatchID.String()
	}
	return connect.NewResponse(resp), nil
}

// CancelSearch implements (DELETE /api/v1/arena/match/cancel).
func (s *ArenaServer) CancelSearch(
	ctx context.Context,
	_ *connect.Request[pb.CancelMatchRequest],
) (*connect.Response[pb.CancelMatchRequest], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	if err := s.Cancel.Do(ctx, uid); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.CancelMatchRequest{}), nil
}

// GetMatch implements (GET /api/v1/arena/match/{match_id}).
func (s *ArenaServer) GetMatch(
	ctx context.Context,
	req *connect.Request[pb.GetMatchRequest],
) (*connect.Response[pb.ArenaMatch], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	matchID, err := uuid.Parse(req.Msg.GetMatchId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid match_id: %w", err))
	}
	view, err := s.Get.Do(ctx, matchID)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	// Only participants may view the match — bible §11 leakage prevention.
	authorized := false
	for _, p := range view.Participants {
		if p.UserID == uid {
			authorized = true
			break
		}
	}
	if !authorized {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("forbidden"))
	}
	// On-demand timeout sweep so ready-check expiry is observed without a
	// separate cron.
	if s.Timeouts != nil {
		_ = s.Timeouts.Sweep(ctx, matchID)
	}
	return connect.NewResponse(toArenaMatchProto(view)), nil
}

// ConfirmReady implements (POST /api/v1/arena/match/{match_id}/confirm).
func (s *ArenaServer) ConfirmReady(
	ctx context.Context,
	req *connect.Request[pb.ConfirmMatchRequest],
) (*connect.Response[pb.ConfirmMatchRequest], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	matchID, err := uuid.Parse(req.Msg.GetMatchId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid match_id: %w", err))
	}
	if err := s.Confirm.Do(ctx, matchID, uid); err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.ConfirmMatchRequest{}), nil
}

// SubmitCode implements (POST /api/v1/arena/match/{match_id}/submit).
func (s *ArenaServer) SubmitCode(
	ctx context.Context,
	req *connect.Request[pb.SubmitCodeRequest],
) (*connect.Response[pb.SubmitResult], error) {
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	matchID, err := uuid.Parse(req.Msg.GetMatchId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid match_id: %w", err))
	}
	lang := languageFromProto(req.Msg.GetLanguage())
	res, err := s.Submit.Do(ctx, app.SubmitCodeInput{
		MatchID:  matchID,
		UserID:   uid,
		Code:     req.Msg.GetCode(),
		Language: lang,
	})
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(&pb.SubmitResult{
		Passed:      res.Passed,
		TestsTotal:  int32(res.TestsTotal),
		TestsPassed: int32(res.TestsPassed),
		RuntimeMs:   int32(res.RuntimeMs),
		MemoryKb:    int32(res.MemoryKB),
	}), nil
}

// ── error mapping ─────────────────────────────────────────────────────────

func (s *ArenaServer) toConnectErr(err error) error {
	switch {
	case errors.Is(err, domain.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, domain.ErrCodeTooLarge):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("code exceeds 50KB limit"))
	case errors.Is(err, domain.ErrAlreadyInQueue):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("already in queue"))
	case errors.Is(err, domain.ErrNotParticipant):
		return connect.NewError(connect.CodePermissionDenied, errors.New("forbidden"))
	case errors.Is(err, domain.ErrMatchStateWrong):
		return connect.NewError(connect.CodeInvalidArgument, errors.New("match not in required state"))
	default:
		s.Log.Error("arena: unexpected error", slog.Any("err", err))
		return connect.NewError(connect.CodeInternal, errors.New("arena failure"))
	}
}

// ── converters (domain → proto) ───────────────────────────────────────────

func toArenaMatchProto(v app.MatchView) *pb.ArenaMatch {
	m := v.Match
	out := &pb.ArenaMatch{
		Id:      m.ID.String(),
		Status:  matchStatusToProto(m.Status),
		Mode:    arenaModeToProto(m.Mode),
		Section: sectionToProto(m.Section),
	}
	if m.StartedAt != nil {
		out.StartedAt = timestamppb.New(m.StartedAt.UTC())
	}
	if m.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(m.FinishedAt.UTC())
	}
	if m.WinnerID != nil {
		out.WinnerUserId = m.WinnerID.String()
	}
	if v.Task != nil {
		out.Task = toArenaTaskProto(*v.Task)
	}
	if len(v.Participants) > 0 {
		out.Participants = make([]*pb.ArenaParticipant, 0, len(v.Participants))
		for _, p := range v.Participants {
			ap := &pb.ArenaParticipant{
				UserId:    p.UserID.String(),
				Team:      int32(p.Team),
				EloBefore: int32(p.EloBefore),
			}
			// Username is STUB-populated; profile cross-call deferred (same as
			// legacy REST path).
			if p.EloAfter != nil {
				ap.EloAfter = int32(*p.EloAfter)
			}
			if p.SolveTimeMs != nil {
				ap.SolveTimeMs = *p.SolveTimeMs
			}
			if p.SuspicionScore != nil {
				ap.SuspicionScore = float32(*p.SuspicionScore)
			}
			// MatchEnd-page enrichment: tier label + XP breakdown. Fields are
			// only populated for finished matches, otherwise frontend just sees
			// zero/empty and falls back to its loading skeleton.
			if m.Status == enums.MatchStatusFinished {
				eloFinal := p.EloBefore
				if p.EloAfter != nil {
					eloFinal = *p.EloAfter
				}
				cur, next := domain.TierLabel(eloFinal)
				ap.TierLabel = cur
				ap.NextTierLabel = next

				won := m.WinnerID != nil && *m.WinnerID == p.UserID
				draw := m.WinnerID == nil && m.Status == enums.MatchStatusFinished
				solveSec := 0
				if p.SolveTimeMs != nil {
					solveSec = int(*p.SolveTimeMs / 1000)
				}
				// firstTry: STUB (нет таблицы submissions per match).
				// Считаем true, если решил быстрее лимита и победил —
				// эвристика, чтобы breakdown был детерминированным.
				firstTry := won && solveSec > 0 && solveSec < domain.XPWinFastSeconds
				// streak: STUB — нужен отдельный счётчик в profile/season.
				// Берём 0; бонус пока не начисляется в UI.
				totalXP, items := domain.ComputeXP(won, draw, solveSec, firstTry, 0)
				ap.FinalXp = int32(totalXP)
				if len(items) > 0 {
					ap.XpBreakdown = make([]*pb.XPBreakdownItem, 0, len(items))
					for _, it := range items {
						ap.XpBreakdown = append(ap.XpBreakdown, &pb.XPBreakdownItem{
							Label:  it.Label,
							Amount: int32(it.Amount),
						})
					}
				}
			}
			out.Participants = append(out.Participants, ap)
		}
	}
	return out
}

func toArenaTaskProto(t domain.TaskPublic) *pb.ArenaTaskPublic {
	out := &pb.ArenaTaskPublic{
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

// ── enum adapters ─────────────────────────────────────────────────────────

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

func matchStatusToProto(m enums.MatchStatus) pb.MatchStatus {
	switch m {
	case enums.MatchStatusSearching:
		return pb.MatchStatus_MATCH_STATUS_SEARCHING
	case enums.MatchStatusConfirming:
		return pb.MatchStatus_MATCH_STATUS_CONFIRMING
	case enums.MatchStatusActive:
		return pb.MatchStatus_MATCH_STATUS_ACTIVE
	case enums.MatchStatusFinished:
		return pb.MatchStatus_MATCH_STATUS_FINISHED
	case enums.MatchStatusCancelled:
		return pb.MatchStatus_MATCH_STATUS_CANCELLED
	default:
		return pb.MatchStatus_MATCH_STATUS_UNSPECIFIED
	}
}

func arenaModeToProto(m enums.ArenaMode) pb.ArenaMode {
	switch m {
	case enums.ArenaModeSolo1v1:
		return pb.ArenaMode_ARENA_MODE_SOLO_1V1
	case enums.ArenaModeDuo2v2:
		return pb.ArenaMode_ARENA_MODE_DUO_2V2
	case enums.ArenaModeRanked:
		return pb.ArenaMode_ARENA_MODE_RANKED
	case enums.ArenaModeHardcore:
		return pb.ArenaMode_ARENA_MODE_HARDCORE
	case enums.ArenaModeCursed:
		return pb.ArenaMode_ARENA_MODE_CURSED
	default:
		return pb.ArenaMode_ARENA_MODE_UNSPECIFIED
	}
}

func arenaModeFromProto(m pb.ArenaMode) enums.ArenaMode {
	switch m {
	case pb.ArenaMode_ARENA_MODE_SOLO_1V1:
		return enums.ArenaModeSolo1v1
	case pb.ArenaMode_ARENA_MODE_DUO_2V2:
		return enums.ArenaModeDuo2v2
	case pb.ArenaMode_ARENA_MODE_RANKED:
		return enums.ArenaModeRanked
	case pb.ArenaMode_ARENA_MODE_HARDCORE:
		return enums.ArenaModeHardcore
	case pb.ArenaMode_ARENA_MODE_CURSED:
		return enums.ArenaModeCursed
	case pb.ArenaMode_ARENA_MODE_UNSPECIFIED:
		return ""
	default:
		return ""
	}
}
