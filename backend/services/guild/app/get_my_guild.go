// Package app contains the guild use cases. One file per endpoint / event
// subscription. Use cases never import infra and never touch the HTTP layer.
package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/guild/domain"

	"github.com/google/uuid"
)

// GetMyGuild resolves the guild the authenticated user belongs to together
// with the hydrated member list and the current-war id (nil if no war).
type GetMyGuild struct {
	Guilds domain.GuildRepo
	Wars   domain.WarRepo
	Clock  domain.Clock
}

// Do returns the hydrated guild view.
func (uc *GetMyGuild) Do(ctx context.Context, userID uuid.UUID) (domain.Guild, error) {
	g, err := uc.Guilds.GetMyGuild(ctx, userID)
	if err != nil {
		return domain.Guild{}, fmt.Errorf("guild.GetMyGuild: %w", err)
	}
	members, err := uc.Guilds.ListGuildMembers(ctx, g.ID)
	if err != nil {
		return domain.Guild{}, fmt.Errorf("guild.GetMyGuild: members: %w", err)
	}
	g.Members = members
	if war, err := uc.Wars.GetCurrentWarForGuild(ctx, g.ID, uc.clockNow()); err == nil {
		id := war.ID
		g.CurrentWarID = &id
	} else if !errors.Is(err, domain.ErrNotFound) {
		return domain.Guild{}, fmt.Errorf("guild.GetMyGuild: war: %w", err)
	}
	return g, nil
}

func (uc *GetMyGuild) clockNow() time.Time {
	if uc.Clock != nil {
		return uc.Clock.Now()
	}
	return time.Now().UTC()
}
