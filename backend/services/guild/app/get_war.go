package app

import (
	"context"
	"fmt"
	"time"

	"druz9/guild/domain"

	"github.com/google/uuid"
)

// WarView is the hydrated projection returned by GetWar. The ports layer
// converts it to the apigen.GuildWar DTO.
type WarView struct {
	War    domain.War
	GuildA domain.Guild
	GuildB domain.Guild
	Lines  []domain.WarLine
}

// GetWar returns the current war for a guild plus its tallied lines.
type GetWar struct {
	Guilds domain.GuildRepo
	Wars   domain.WarRepo
	Clock  domain.Clock
}

// Do loads the current war and expands it into the 5 WarLine view.
func (uc *GetWar) Do(ctx context.Context, guildID uuid.UUID) (WarView, error) {
	war, err := uc.Wars.GetCurrentWarForGuild(ctx, guildID, uc.clockNow())
	if err != nil {
		return WarView{}, fmt.Errorf("guild.GetWar: %w", err)
	}
	a, err := uc.Guilds.GetGuild(ctx, war.GuildAID)
	if err != nil {
		return WarView{}, fmt.Errorf("guild.GetWar: guild A: %w", err)
	}
	b, err := uc.Guilds.GetGuild(ctx, war.GuildBID)
	if err != nil {
		return WarView{}, fmt.Errorf("guild.GetWar: guild B: %w", err)
	}
	contribs, err := uc.Wars.ListContributions(ctx, war.ID)
	if err != nil {
		return WarView{}, fmt.Errorf("guild.GetWar: contribs: %w", err)
	}
	return WarView{
		War:    war,
		GuildA: a,
		GuildB: b,
		Lines:  domain.TallyLines(war, contribs),
	}, nil
}

func (uc *GetWar) clockNow() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
