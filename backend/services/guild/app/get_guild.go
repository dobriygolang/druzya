package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/guild/domain"

	"github.com/google/uuid"
)

// GetGuild returns the public view of a guild (id-addressed).
type GetGuild struct {
	Guilds domain.GuildRepo
	Wars   domain.WarRepo
	Clock  domain.Clock
}

// Do loads the guild + members + current war id.
func (uc *GetGuild) Do(ctx context.Context, guildID uuid.UUID) (domain.Guild, error) {
	g, err := uc.Guilds.GetGuild(ctx, guildID)
	if err != nil {
		return domain.Guild{}, fmt.Errorf("guild.GetGuild: %w", err)
	}
	members, err := uc.Guilds.ListGuildMembers(ctx, g.ID)
	if err != nil {
		return domain.Guild{}, fmt.Errorf("guild.GetGuild: members: %w", err)
	}
	g.Members = members
	if war, err := uc.Wars.GetCurrentWarForGuild(ctx, g.ID, uc.clockNow()); err == nil {
		id := war.ID
		g.CurrentWarID = &id
	} else if !errors.Is(err, domain.ErrNotFound) {
		return domain.Guild{}, fmt.Errorf("guild.GetGuild: war: %w", err)
	}
	return g, nil
}

func (uc *GetGuild) clockNow() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
