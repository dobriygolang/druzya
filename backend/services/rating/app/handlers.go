// Package app contains the rating use cases and event handlers.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/rating/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
)

// OnMatchCompleted reacts to arena.MatchCompleted: applies pre-computed ELO
// deltas from the event to the participants' ratings, persists, and publishes
// per-participant RatingChanged events.
type OnMatchCompleted struct {
	Ratings domain.RatingRepo
	Bus     sharedDomain.Bus
	Log     *slog.Logger
}

// Handle implements sharedDomain.Handler.
func (h *OnMatchCompleted) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.MatchCompleted)
	if !ok {
		return fmt.Errorf("rating.OnMatchCompleted: unexpected event %T", ev)
	}
	for uid, delta := range e.EloDeltas {
		if err := h.applyDelta(ctx, uid, e.Section, delta, "arena", &e.MatchID); err != nil {
			return fmt.Errorf("rating.OnMatchCompleted: user %s: %w", uid, err)
		}
	}
	return nil
}

// OnDailyKataCompleted bumps the ELO of the task's section by a small amount
// on successful daily kata. STUB: currently we don't know the section from the
// event alone — the event only carries TaskID. Until a cross-domain read-through
// is added, we apply a small generic ELO bump in the algorithms section as the
// safest default, consistent with bible §3.6 "kata → mostly algorithms".
type OnDailyKataCompleted struct {
	Ratings domain.RatingRepo
	Bus     sharedDomain.Bus
	Log     *slog.Logger
}

// Handle implements sharedDomain.Handler.
func (h *OnDailyKataCompleted) Handle(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataCompleted)
	if !ok {
		return fmt.Errorf("rating.OnDailyKataCompleted: unexpected event %T", ev)
	}
	// STUB: resolve section from TaskID via daily/TaskRepo read-through. The
	// event does not carry Section today. Once the cross-domain read is added,
	// replace this constant with the real section.
	section := enums.SectionAlgorithms
	const bump = 4
	return h.applyDelta(ctx, e.UserID, section, bump, "kata", nil)
}

// applyDelta is the shared upsert+publish used by both handlers above.
func (h *OnDailyKataCompleted) applyDelta(ctx context.Context, userID uuid.UUID, section enums.Section, delta int, source string, matchID *uuid.UUID) error {
	return applyDelta(ctx, h.Ratings, h.Bus, h.Log, userID, section, delta, source, matchID)
}

func (h *OnMatchCompleted) applyDelta(ctx context.Context, userID uuid.UUID, section enums.Section, delta int, source string, matchID *uuid.UUID) error {
	return applyDelta(ctx, h.Ratings, h.Bus, h.Log, userID, section, delta, source, matchID)
}

// applyDelta reads the current rating, applies the delta, persists, and
// publishes a RatingChanged event. Repos must treat missing rows as "start
// at InitialELO".
func applyDelta(
	ctx context.Context,
	ratings domain.RatingRepo,
	bus sharedDomain.Bus,
	log *slog.Logger,
	userID uuid.UUID,
	section enums.Section,
	delta int,
	source string,
	matchID *uuid.UUID,
) error {
	list, err := ratings.List(ctx, userID)
	if err != nil {
		return fmt.Errorf("load ratings: %w", err)
	}
	// Find existing row (or seed).
	cur := domain.SectionRating{
		UserID:  userID,
		Section: section,
		Elo:     domain.InitialELO,
	}
	for _, r := range list {
		if r.Section == section {
			cur = r
			break
		}
	}
	oldElo := cur.Elo
	cur.Elo += delta
	cur.MatchesCount++
	now := time.Now().UTC()
	cur.LastMatchAt = &now
	cur.UpdatedAt = now
	if err := ratings.Upsert(ctx, cur); err != nil {
		return fmt.Errorf("upsert: %w", err)
	}
	if perr := bus.Publish(ctx, sharedDomain.RatingChanged{
		UserID:  userID,
		Section: section,
		EloOld:  oldElo,
		EloNew:  cur.Elo,
		Source:  source,
		MatchID: matchID,
	}); perr != nil {
		log.WarnContext(ctx, "rating.applyDelta: publish RatingChanged", slog.Any("err", perr))
	}
	return nil
}
