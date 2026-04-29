// polled.go — Connect-RPC adapters for the polled /current + /queue-stats
// endpoints. The chi-direct handlers in current_match.go and queue_stats.go
// remain (they still satisfy the *Handler / Finder ports for tests) but
// are no longer mounted by the wirer once these proto-driven methods take
// over.
package ports

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"connectrpc.com/connect"

	"druz9/arena/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"
)

func (s *ArenaServer) GetCurrentMatch(
	ctx context.Context,
	_ *connect.Request[pb.GetCurrentMatchRequest],
) (*connect.Response[pb.CurrentMatch], error) {
	if s.CurrentMatchRepo == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	uid, ok := sharedMw.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("unauthenticated"))
	}
	match, err := s.CurrentMatchRepo.FindCurrentMatch(ctx, uid)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errors.New("no current match"))
		}
		if s.Log != nil {
			s.Log.ErrorContext(ctx, "arena.GetCurrentMatch", slog.Any("err", err))
		}
		return nil, connect.NewError(connect.CodeInternal, errors.New("lookup failed"))
	}
	return connect.NewResponse(&pb.CurrentMatch{
		MatchId: match.ID.String(),
		Status:  string(match.Status),
		Mode:    string(match.Mode),
		Section: string(match.Section),
	}), nil
}

func (s *ArenaServer) GetArenaQueueStats(
	ctx context.Context,
	_ *connect.Request[pb.GetArenaQueueStatsRequest],
) (*connect.Response[pb.ArenaQueueStats], error) {
	if s.QueueRepo == nil {
		return nil, connect.NewError(connect.CodeUnavailable, errors.New("not_wired"))
	}
	rows := make([]*pb.QueueStatRow, 0, len(modesForLanding)*len(sectionsForLanding))
	byMode := make(map[string]int32, len(modesForLanding))
	for _, m := range modesForLanding {
		byMode[string(m)] = 0
		for _, sec := range sectionsForLanding {
			n, err := s.QueueRepo.Waiting(ctx, sec, m)
			if err != nil {
				if s.Log != nil {
					s.Log.WarnContext(ctx, "arena.GetArenaQueueStats: waiting failed",
						slog.String("mode", string(m)),
						slog.String("section", string(sec)),
						slog.Any("err", err))
				}
				return nil, connect.NewError(connect.CodeUnavailable,
					errors.New("queue stats unavailable"))
			}
			rows = append(rows, &pb.QueueStatRow{
				Mode:    string(m),
				Section: string(sec),
				Waiting: int32(n),
			})
			byMode[string(m)] += int32(n)
		}
	}
	return connect.NewResponse(&pb.ArenaQueueStats{
		Items:       rows,
		ByMode:      byMode,
		GeneratedAt: time.Now().UnixMilli(),
	}), nil
}

// keep the legacy enums symbol used elsewhere live
var _ = enums.MatchStatusActive
