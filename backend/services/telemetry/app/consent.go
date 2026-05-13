// Package app — telemetry consent UCs.
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/telemetry/domain"

	"github.com/google/uuid"
)

// GetConsent — read UC. Returns (consent, exists, err). exists=false → row
// нет в БД, client должен использовать default per-surface semantics.
type GetConsent struct {
	Consent domain.ConsentRepo
}

func (uc *GetConsent) Do(ctx context.Context, userID uuid.UUID, surfaceStr string) (domain.Consent, bool, error) {
	surface := domain.Surface(strings.ToLower(strings.TrimSpace(surfaceStr)))
	if !surface.IsValid() {
		return domain.Consent{}, false, fmt.Errorf("telemetry.GetConsent: %w", domain.ErrInvalidSurface)
	}
	c, exists, err := uc.Consent.Get(ctx, userID, surface)
	if err != nil {
		return domain.Consent{}, false, err
	}
	return c, exists, nil
}

// SetConsent — write UC. Upsert'ит row + side-effect: при opt-out
// делаем best-effort sink.DeleteUser в background (sink сам решает,
// поддерживает ли это).
type SetConsent struct {
	Consent domain.ConsentRepo
	Sink    domain.AnalyticsSink
	Anon    domain.IDAnonymizer
	Now     func() time.Time
}

func (uc *SetConsent) Do(ctx context.Context, userID uuid.UUID, surfaceStr string, optedIn bool, version int32) error {
	surface := domain.Surface(strings.ToLower(strings.TrimSpace(surfaceStr)))
	if !surface.IsValid() {
		return fmt.Errorf("telemetry.SetConsent: %w", domain.ErrInvalidSurface)
	}
	now := time.Now().UTC()
	if uc.Now != nil {
		now = uc.Now().UTC()
	}
	if version <= 0 {
		version = domain.LatestConsentVersion
	}
	c := domain.Consent{
		UserID:         userID,
		Surface:        surface,
		OptedIn:        optedIn,
		ConsentVersion: version,
		UpdatedAt:      now,
	}
	if err := uc.Consent.Upsert(ctx, c); err != nil {
		return err
	}
	// Opt-out → ask sink to forget. Best-effort; sink errors не propagate
	// (consent уже записан, side-effect — second-best).
	if !optedIn && uc.Sink != nil && uc.Anon != nil {
		anonID := uc.Anon.Anonymize(userID)
		_ = uc.Sink.DeleteUser(ctx, anonID)
	}
	return nil
}
