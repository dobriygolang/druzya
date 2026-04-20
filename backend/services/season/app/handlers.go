package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/season/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// pointsHandler is the shared apply-and-publish tail used by every event
// handler in this file. It:
//   1. resolves the current season (no-op if there isn't one),
//   2. atomically bumps SP,
//   3. recomputes + persists the tier,
//   4. publishes season.PointsEarned.
type pointsHandler struct {
	Seasons domain.SeasonRepo
	Tiers   domain.TierRepo
	Bus     sharedDomain.Bus
	Log     *slog.Logger
}

func (h *pointsHandler) apply(ctx context.Context, userID uuid.UUID, delta int, source string) error {
	if delta <= 0 {
		return nil
	}
	s, err := h.Seasons.GetCurrent(ctx)
	if err != nil {
		// No current season = nothing to credit against. Log + bail.
		h.Log.DebugContext(ctx, "season.handlers: no current season, skipping", slog.Any("err", err))
		return nil
	}
	total, err := h.Seasons.IncrementPoints(ctx, userID, s.ID, delta)
	if err != nil {
		return fmt.Errorf("IncrementPoints: %w", err)
	}
	ladder, err := h.Tiers.Tracks(ctx, s.ID, domain.TrackFree)
	if err != nil {
		return fmt.Errorf("Tiers.Tracks: %w", err)
	}
	newTier := domain.ComputeTier(total, ladder)
	if err := h.Seasons.UpdateTier(ctx, userID, s.ID, newTier); err != nil {
		return fmt.Errorf("UpdateTier: %w", err)
	}
	if h.Bus != nil {
		if perr := h.Bus.Publish(ctx, sharedDomain.SeasonPointsEarned{
			UserID:   userID,
			SeasonID: s.ID,
			Points:   delta,
			Source:   source,
		}); perr != nil {
			h.Log.WarnContext(ctx, "season.handlers: publish SeasonPointsEarned", slog.Any("err", perr))
		}
	}
	return nil
}

// OnXPGained converts a progress.XPGained event into Season Points at a fixed
// 10 XP → 1 SP ratio. Rounding is floor — partial remainders are discarded.
//
// STUB: the ratio should come from dynamic_config (key "sp_per_xp_ratio"),
// see the env var suggestion in WIRING.md.
type OnXPGained struct {
	pointsHandler
}

// NewOnXPGained wires the handler.
func NewOnXPGained(seasons domain.SeasonRepo, tiers domain.TierRepo, bus sharedDomain.Bus, log *slog.Logger) *OnXPGained {
	return &OnXPGained{pointsHandler{Seasons: seasons, Tiers: tiers, Bus: bus, Log: log}}
}

// Handle implements sharedDomain.Handler.
func (h *OnXPGained) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.XPGained)
	if !ok {
		return fmt.Errorf("season.OnXPGained: unexpected event %T", ev)
	}
	sp := e.Amount / domain.DefaultSPPerXPRatio
	if sp <= 0 {
		return nil
	}
	if err := h.apply(ctx, e.UserID, sp, domain.SourceXP); err != nil {
		return fmt.Errorf("season.OnXPGained: %w", err)
	}
	return nil
}

// OnMatchCompleted awards +50 SP to the match winner. Losers get nothing here
// (they might get XP → SP via OnXPGained though, which is fine).
type OnMatchCompleted struct {
	pointsHandler
}

// NewOnMatchCompleted wires the handler.
func NewOnMatchCompleted(seasons domain.SeasonRepo, tiers domain.TierRepo, bus sharedDomain.Bus, log *slog.Logger) *OnMatchCompleted {
	return &OnMatchCompleted{pointsHandler{Seasons: seasons, Tiers: tiers, Bus: bus, Log: log}}
}

// Handle implements sharedDomain.Handler.
func (h *OnMatchCompleted) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.MatchCompleted)
	if !ok {
		return fmt.Errorf("season.OnMatchCompleted: unexpected event %T", ev)
	}
	if e.WinnerID == uuid.Nil {
		return nil
	}
	if err := h.apply(ctx, e.WinnerID, domain.PointsMatchWin, domain.SourceMatchWin); err != nil {
		return fmt.Errorf("season.OnMatchCompleted: %w", err)
	}
	return nil
}

// OnDailyKataCompleted awards +30 SP (×3 when cursed).
type OnDailyKataCompleted struct {
	pointsHandler
}

// NewOnDailyKataCompleted wires the handler.
func NewOnDailyKataCompleted(seasons domain.SeasonRepo, tiers domain.TierRepo, bus sharedDomain.Bus, log *slog.Logger) *OnDailyKataCompleted {
	return &OnDailyKataCompleted{pointsHandler{Seasons: seasons, Tiers: tiers, Bus: bus, Log: log}}
}

// Handle implements sharedDomain.Handler.
func (h *OnDailyKataCompleted) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataCompleted)
	if !ok {
		return fmt.Errorf("season.OnDailyKataCompleted: unexpected event %T", ev)
	}
	pts := domain.PointsDailyKata
	if e.IsCursed {
		pts = domain.PointsDailyKataCurse
	}
	if err := h.apply(ctx, e.UserID, pts, domain.SourceDailyKata); err != nil {
		return fmt.Errorf("season.OnDailyKataCompleted: %w", err)
	}
	return nil
}

// OnMockSessionFinished awards +80 SP when the mock wasn't abandoned and the
// overall score is ≥ MockMinScoreForSP.
type OnMockSessionFinished struct {
	pointsHandler
}

// NewOnMockSessionFinished wires the handler.
func NewOnMockSessionFinished(seasons domain.SeasonRepo, tiers domain.TierRepo, bus sharedDomain.Bus, log *slog.Logger) *OnMockSessionFinished {
	return &OnMockSessionFinished{pointsHandler{Seasons: seasons, Tiers: tiers, Bus: bus, Log: log}}
}

// Handle implements sharedDomain.Handler.
func (h *OnMockSessionFinished) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.MockSessionFinished)
	if !ok {
		return fmt.Errorf("season.OnMockSessionFinished: unexpected event %T", ev)
	}
	if e.Abandoned || e.OverallScore < domain.MockMinScoreForSP {
		return nil
	}
	if err := h.apply(ctx, e.UserID, domain.PointsMockFinished, domain.SourceMockDone); err != nil {
		return fmt.Errorf("season.OnMockSessionFinished: %w", err)
	}
	return nil
}

// SubscribeHandlers registers the four season handlers with the bus. Call once
// in main.go after building the handler struct pointers.
func SubscribeHandlers(bus sharedDomain.Bus, xp *OnXPGained, win *OnMatchCompleted, kata *OnDailyKataCompleted, mock *OnMockSessionFinished) {
	bus.Subscribe(sharedDomain.XPGained{}.Topic(), xp.Handle)
	bus.Subscribe(sharedDomain.MatchCompleted{}.Topic(), win.Handle)
	bus.Subscribe(sharedDomain.DailyKataCompleted{}.Topic(), kata.Handle)
	bus.Subscribe(sharedDomain.MockSessionFinished{}.Topic(), mock.Handle)
}
