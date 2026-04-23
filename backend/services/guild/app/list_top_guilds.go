package app

import (
	"context"
	"fmt"

	"druz9/guild/domain"
)

// ListTopGuilds is the use case behind the GET /api/v1/guilds/top REST
// endpoint. It exists alongside the four Connect-RPC use cases (GetMyGuild,
// GetGuild, GetWar, Contribute) — the contract was added without bumping the
// proto because the page that consumes it (top-guilds for non-members) is
// purely a read-only convenience, and the cache layer covers the hot path.
type ListTopGuilds struct {
	Guilds domain.GuildRepo
}

// Do clamps the requested limit and returns the leaderboard. The repository
// already enforces the same bounds; we duplicate them here so callers that
// bypass Postgres (e.g. tests with a memory repo) get the same shape.
func (uc *ListTopGuilds) Do(ctx context.Context, limit int) ([]domain.TopGuildSummary, error) {
	if limit <= 0 {
		limit = domain.DefaultTopGuildsLimit
	}
	if limit > domain.MaxTopGuildsLimit {
		limit = domain.MaxTopGuildsLimit
	}
	out, err := uc.Guilds.ListTopGuilds(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("guild.ListTopGuilds: %w", err)
	}
	return out, nil
}
