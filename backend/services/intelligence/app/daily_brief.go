// Package app — intelligence use cases. Pure orchestrators wiring the
// reader-adapters + LLM synthesiser + cache repo. No HTTP / proto types.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// CacheTTL — кеш дневного брифа. 6 часов покрывает «утренняя сессия →
// обед → вечер» без перегенераций; за пределами окна юзер скорее всего
// уже накопил новые reflection'ы и стоит пересчитать.
const CacheTTL = 6 * time.Hour

// ForceCooldown — минимальный интервал между принудительными regenerate'ами.
// 1 час не даёт нагенерировать ⌘R-спамом и не сжигает LLM-квоту.
const ForceCooldown = time.Hour

// GetDailyBrief — use case для GetDailyBrief RPC.
type GetDailyBrief struct {
	Briefs      domain.DailyBriefRepo
	Focus       domain.FocusReader
	Plans       domain.PlanReader
	Notes       domain.NotesReader
	Synthesiser domain.BriefSynthesizer
	Log         *slog.Logger
	Now         func() time.Time
}

// GetDailyBriefInput — параметры use case'а.
type GetDailyBriefInput struct {
	UserID uuid.UUID
	Force  bool
}

// Do возвращает кешированный (или свежесинтезированный) бриф.
//
// Cache flow:
//  1. force=false  → cache hit < CacheTTL → return.
//  2. force=true   → проверяем cooldown (1h с предыдущей generated_at);
//     нарушен → ErrRateLimited.
//  3. cache miss / force valid → собираем prompt-input + вызываем
//     Synthesise + Upsert + return.
//
// Anti-fallback: при ErrLLMUnavailable use-case проксирует ошибку
// неизменной — клиент покажет «Coach is offline», а не fake brief.
func (uc *GetDailyBrief) Do(ctx context.Context, in GetDailyBriefInput) (domain.DailyBrief, error) {
	now := uc.Now().UTC()
	today := now.Truncate(24 * time.Hour)

	// 1. Try cache.
	if !in.Force {
		cached, err := uc.Briefs.GetForDate(ctx, in.UserID, today)
		if err == nil {
			if now.Sub(cached.GeneratedAt) < CacheTTL {
				return cached, nil
			}
		} else if !errors.Is(err, domain.ErrNotFound) {
			return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: cache lookup: %w", err)
		}
	}

	// 2. Force cooldown gate.
	if in.Force {
		last, err := uc.Briefs.LastForcedAt(ctx, in.UserID)
		if err != nil {
			return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: lastForcedAt: %w", err)
		}
		if !last.IsZero() && now.Sub(last) < ForceCooldown {
			return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: %w", domain.ErrRateLimited)
		}
	}

	// 3. Build prompt input.
	since14 := today.Add(-14 * 24 * time.Hour)
	since7 := today.Add(-7 * 24 * time.Hour)

	focus, err := uc.Focus.LastNDays(ctx, in.UserID, 7)
	if err != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: focus: %w", err)
	}
	skipped, err := uc.Plans.SkippedItems(ctx, in.UserID, since14)
	if err != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: skipped: %w", err)
	}
	completed, err := uc.Plans.CompletedItems(ctx, in.UserID, since7)
	if err != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: completed: %w", err)
	}
	refl, err := uc.Notes.RecentReflections(ctx, in.UserID, 5)
	if err != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: reflections: %w", err)
	}
	recent, err := uc.Notes.RecentNotes(ctx, in.UserID, 5)
	if err != nil {
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: recent notes: %w", err)
	}

	brief, err := uc.Synthesiser.Synthesise(ctx, domain.BriefPromptInput{
		UserID:          in.UserID,
		Today:           today,
		FocusDays:       focus,
		SkippedRecent:   skipped,
		CompletedRecent: completed,
		Reflections:     refl,
		RecentNotes:     recent,
	})
	if err != nil {
		// Pass-through — пусть transport сам решит как 503-ить.
		return domain.DailyBrief{}, fmt.Errorf("intelligence.GetDailyBrief.Do: synthesise: %w", err)
	}
	brief.GeneratedAt = now

	if err := uc.Briefs.Upsert(ctx, in.UserID, today, brief); err != nil {
		// Cache-write fail — НЕ блокируем юзера. Бриф уже синтезирован,
		// возвращаем его; следующий вызов просто пере-синтезирует. Логируем
		// чтобы оператор видел persistent-faults.
		uc.Log.Warn("intelligence.GetDailyBrief.Do: cache upsert failed",
			slog.Any("err", err), slog.String("user_id", in.UserID.String()))
	}
	return brief, nil
}
