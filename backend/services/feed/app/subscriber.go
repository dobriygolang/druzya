// Package app wires bus subscriptions that convert raw domain events into
// anonymized FeedEvents the public WS hub broadcasts.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	feeddomain "druz9/feed/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
)

// Broadcaster is the narrow output port — the ws hub implements it.
type Broadcaster interface {
	Broadcast(e feeddomain.FeedEvent)
}

// Subscriber wires bus topics → anonymized feed events.
type Subscriber struct {
	Out Broadcaster
	Log *slog.Logger
}

// Register subscribes to every bus topic we translate into the public feed.
// Called once at boot from cmd/monolith.
func (s *Subscriber) Register(bus sharedDomain.Bus) {
	bus.Subscribe(sharedDomain.MatchCompleted{}.Topic(), s.onMatchCompleted)
	bus.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), s.onKataCompleted)
	bus.Subscribe(sharedDomain.SkillNodeUnlocked{}.Topic(), s.onNodeUnlocked)
	bus.Subscribe(sharedDomain.CohortWarStarted{}.Topic(), s.onCohortWarStarted)
	bus.Subscribe(sharedDomain.LevelUp{}.Topic(), s.onLevelUp)
}

func (s *Subscriber) onMatchCompleted(_ context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.MatchCompleted)
	if !ok {
		return nil
	}
	winner := feeddomain.Handle(ev.WinnerID)
	section := sectionLabel(ev.Section)
	s.Out.Broadcast(feeddomain.FeedEvent{
		Kind: feeddomain.KindMatchWin,
		Text: fmt.Sprintf("⚔ %s won on the %s arena", winner, section),
		At:   time.Now().UTC(),
	})
	for _, loser := range ev.LoserIDs {
		s.Out.Broadcast(feeddomain.FeedEvent{
			Kind: feeddomain.KindMatchLoss,
			Text: fmt.Sprintf("%s was defeated in %s", feeddomain.Handle(loser), section),
			At:   time.Now().UTC(),
		})
	}
	return nil
}

func (s *Subscriber) onKataCompleted(_ context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.DailyKataCompleted)
	if !ok {
		return nil
	}
	h := feeddomain.Handle(ev.UserID)
	txt := fmt.Sprintf("✦ %s extended a Daily Kata streak to %d days (+%d XP)", h, ev.StreakNew, ev.XPEarned)
	if ev.IsCursed {
		txt = fmt.Sprintf("✦ %s conquered a CURSED Kata · streak %d · +%d XP", h, ev.StreakNew, ev.XPEarned)
	}
	s.Out.Broadcast(feeddomain.FeedEvent{Kind: feeddomain.KindKataDone, Text: txt, At: time.Now().UTC()})
	return nil
}

func (s *Subscriber) onNodeUnlocked(_ context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.SkillNodeUnlocked)
	if !ok {
		return nil
	}
	s.Out.Broadcast(feeddomain.FeedEvent{
		Kind: feeddomain.KindNodeUnlocked,
		Text: fmt.Sprintf("◈ %s unlocked %q (%s)", feeddomain.Handle(ev.UserID), ev.NodeKey, sectionLabel(ev.Section)),
		At:   time.Now().UTC(),
	})
	return nil
}

func (s *Subscriber) onCohortWarStarted(_ context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.CohortWarStarted)
	if !ok {
		return nil
	}
	s.Out.Broadcast(feeddomain.FeedEvent{
		Kind: feeddomain.KindCohortWar,
		Text: fmt.Sprintf("⚔ A cohort war has begun (ends %s)", ev.EndsAt.UTC().Format(time.RFC1123)),
		At:   time.Now().UTC(),
	})
	return nil
}

func (s *Subscriber) onLevelUp(_ context.Context, e sharedDomain.Event) error {
	ev, ok := e.(sharedDomain.LevelUp)
	if !ok {
		return nil
	}
	s.Out.Broadcast(feeddomain.FeedEvent{
		Kind: feeddomain.KindLevelUp,
		Text: fmt.Sprintf("⚜ %s ascended to level %d", feeddomain.Handle(ev.UserID), ev.LevelNew),
		At:   time.Now().UTC(),
	})
	return nil
}

func sectionLabel(s enums.Section) string {
	switch s {
	case enums.SectionAlgorithms:
		return "Algorithms"
	case enums.SectionSQL:
		return "SQL"
	case enums.SectionGo:
		return "Go"
	case enums.SectionSystemDesign:
		return "System Design"
	case enums.SectionBehavioral:
		return "Behavioral"
	}
	return string(s)
}
