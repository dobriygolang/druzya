package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"druz9/subscription/domain"

	"github.com/google/uuid"
)

// TierSource — откуда взялся текущий tier. Используется UI чтобы показать
// бейдж «Pro» vs «Pro via BYOK» vs «Tutor mode».
type TierSource string

const (
	// SourceFree — нет ни paid Pro, ни валидного BYOK.
	SourceFree TierSource = "free"
	// SourcePro — обычный paid Pro (Stripe/Boosty/Admin grant).
	SourcePro TierSource = "pro"
	// SourceBYOK — юзер привязал свой LLM key → Pro features unlocked.
	SourceBYOK TierSource = "byok"
	// SourceTutor — юзер выступает tutor'ом (опт-in role). NOT a paywall:
	// tutor-mode свободен независимо от tier'а. Возвращается только если
	// нет ни pro, ни byok (т.е. в обычной ситуации tutor доминирует над
	// free но не над paid Pro).
	SourceTutor TierSource = "tutor"
)

// TierInfo — DTO use-case'а. Полнее чем domain.Subscription: содержит явный
// source + опциональный BYOK provider (для UI бейджа).
type TierInfo struct {
	Tier         domain.Tier
	Source       TierSource
	ExpiresAt    *time.Time
	BYOKProvider domain.BYOKProvider // пусто если source!="byok"
}

// TutorChecker — port для определения «есть ли у юзера активные студенты».
// Реализуется в monolith/services/adapters.go через ListTutorStudents из
// tutor-домена. Pure-read; failure не должен валить CheckTier (graceful).
type TutorChecker interface {
	IsTutor(ctx context.Context, userID uuid.UUID) (bool, error)
}

// CheckTier — главный use-case Stream-C: возвращает эффективный tier юзера
// с явным указанием источника. Логика приоритизации:
//
//	paid Pro (active subscriptions) > BYOK (validated key) > tutor-role > free
//
// Если paid Pro есть — он doминирует, даже если у юзера ещё и BYOK ключ
// привязан (BYOK не платный, paid даёт expiry/billing).
type CheckTier struct {
	GetTierUC *GetTier
	BYOKRepo  domain.BYOKRepo
	Tutor     TutorChecker // optional — может быть nil (skip tutor-detection)
}

// NewCheckTier — конструктор. BYOKRepo обязателен; Tutor может быть nil
// (тогда source='tutor' никогда не вернётся).
func NewCheckTier(getTier *GetTier, byok domain.BYOKRepo, tutor TutorChecker) *CheckTier {
	return &CheckTier{GetTierUC: getTier, BYOKRepo: byok, Tutor: tutor}
}

// Do вычисляет TierInfo. Не падает при partial failures: ошибка от BYOKRepo
// логически downgrade'ит юзера до free (или paid Pro если он был).
func (uc *CheckTier) Do(ctx context.Context, userID uuid.UUID) (TierInfo, error) {
	sub, err := uc.GetTierUC.DoFull(ctx, userID)
	if err != nil {
		return TierInfo{}, fmt.Errorf("subscription.CheckTier: get_tier: %w", err)
	}
	now := uc.now()
	activeTier := sub.ActiveAt(now)
	// 1) paid Pro (или Max) → wins.
	if activeTier != domain.TierFree {
		return TierInfo{
			Tier:      activeTier,
			Source:    SourcePro,
			ExpiresAt: sub.CurrentPeriodEnd,
		}, nil
	}
	// 2) BYOK → Pro-features unlocked.
	if uc.BYOKRepo != nil {
		key, kerr := uc.BYOKRepo.Get(ctx, userID)
		if kerr == nil && key.IsActive() {
			return TierInfo{
				Tier:         domain.TierPro,
				Source:       SourceBYOK,
				BYOKProvider: key.Provider,
			}, nil
		}
		// ErrNotFound — нормальный случай, не error. Остальное — log
		// best-effort и идём дальше: не блокируем CheckTier.
		if kerr != nil && !errors.Is(kerr, domain.ErrNotFound) {
			// non-fatal: продолжаем
			_ = kerr
		}
	}
	// 3) Tutor-mode → информационный source (тоже Free тarif).
	if uc.Tutor != nil {
		isTutor, terr := uc.Tutor.IsTutor(ctx, userID)
		if terr == nil && isTutor {
			return TierInfo{Tier: domain.TierFree, Source: SourceTutor}, nil
		}
	}
	// 4) Иначе — free.
	return TierInfo{Tier: domain.TierFree, Source: SourceFree}, nil
}

func (uc *CheckTier) now() time.Time {
	if uc.GetTierUC != nil && uc.GetTierUC.Clock != nil {
		return uc.GetTierUC.Clock.Now()
	}
	return time.Now().UTC()
}
