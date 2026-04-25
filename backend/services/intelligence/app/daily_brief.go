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
	// Memory — optional. С ним brief получает «past coach interactions»
	// в prompt и каждое generated brief пишется как brief_emitted episode.
	Memory *Memory

	// ── Cross-product readers (все nullable) ──
	//
	// Все шесть — opt-in. Если nil, соответствующая секция prompt'а
	// просто не наполняется. Это позволяет частичный rollout: сначала
	// поднимаем Mocks, потом добавляем Arena, и т.д.
	Mocks        domain.MockReader
	Kata         domain.KataReader
	Arena        domain.ArenaReader
	Queue        domain.QueueReader
	Skills       domain.SkillReader
	DailyNotes   domain.DailyNoteReader
	Calendar     domain.CalendarReader
	MockMessages domain.MockMessagesReader
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

	// Cross-product сигналы — best-effort. Любой reader-error игнорируем
	// и шлём пустой массив: лучше brief без mock-секции чем 503 на весь
	// Coach.
	var (
		mocks      []domain.MockSessionSummary
		kataStreak domain.KataStreak
		kataRecent []domain.KataAttempt
		arena      []domain.ArenaMatchSummary
		queue      domain.QueueSnapshot
		weakSkills []domain.SkillWeak
		dailyNotes []domain.DailyNoteHead
	)
	if uc.Mocks != nil {
		if v, mErr := uc.Mocks.LastNFinished(ctx, in.UserID, 5); mErr == nil {
			mocks = v
		} else if uc.Log != nil {
			uc.Log.Warn("intelligence.GetDailyBrief: mocks reader failed",
				slog.Any("err", mErr))
		}
	}
	if uc.Kata != nil {
		if v, kErr := uc.Kata.GetStreak(ctx, in.UserID); kErr == nil {
			kataStreak = v
		}
		if v, kErr := uc.Kata.LastNAttempts(ctx, in.UserID, 7); kErr == nil {
			kataRecent = v
		}
	}
	if uc.Arena != nil {
		if v, aErr := uc.Arena.LastNMatches(ctx, in.UserID, 5); aErr == nil {
			arena = v
		}
	}
	if uc.Queue != nil {
		if v, qErr := uc.Queue.TodaySnapshot(ctx, in.UserID); qErr == nil {
			queue = v
		}
	}
	if uc.Skills != nil {
		if v, sErr := uc.Skills.WeakestN(ctx, in.UserID, 5); sErr == nil {
			weakSkills = v
		}
	}
	if uc.DailyNotes != nil {
		if v, dErr := uc.DailyNotes.RecentDailyNotes(ctx, in.UserID, 3); dErr == nil {
			dailyNotes = v
		}
	}
	var (
		upcoming []domain.UpcomingInterview
		keywords []domain.MockKeywords
	)
	if uc.Calendar != nil {
		if v, cErr := uc.Calendar.UpcomingInterviews(ctx, in.UserID, 30); cErr == nil {
			upcoming = v
		}
	}
	if uc.MockMessages != nil {
		if v, kErr := uc.MockMessages.TopKeywords(ctx, in.UserID, 14, 12); kErr == nil {
			keywords = v
		}
	}

	brief, err := uc.Synthesiser.Synthesise(ctx, domain.BriefPromptInput{
		UserID:             in.UserID,
		Today:              today,
		FocusDays:          focus,
		SkippedRecent:      skipped,
		CompletedRecent:    completed,
		Reflections:        refl,
		RecentNotes:        recent,
		Mocks:              mocks,
		KataStreak:         kataStreak,
		KataRecent:         kataRecent,
		Arena:              arena,
		Queue:              queue,
		WeakSkills:         weakSkills,
		DailyNotes:         dailyNotes,
		UpcomingInterviews: upcoming,
		MockKeywords:       keywords,
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
