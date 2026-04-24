package app

import (
	"context"
	"fmt"
	"log/slog"

	"druz9/notify/domain"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
)

// Handlers groups the notify event handlers so wiring in main.go is compact.
// Each method matches sharedDomain.Handler.
type Handlers struct {
	Send  *SendNotification
	Prefs domain.PreferencesRepo // для OnTelegramChatLinked; nil-safe если не нужен
	Log   *slog.Logger
}

// NewHandlers constructs a Handlers set.
func NewHandlers(send *SendNotification, log *slog.Logger) *Handlers {
	return &Handlers{Send: send, Log: log}
}

// WithPrefs добавляет PreferencesRepo чтобы handler мог обслуживать
// TelegramChatLinked (persist chat_id). Разделено с NewHandlers чтобы не
// ломать существующие каллеры — Prefs требуется только для одного event'а.
func (h *Handlers) WithPrefs(prefs domain.PreferencesRepo) *Handlers {
	h.Prefs = prefs
	return h
}

// OnTelegramChatLinked сохраняет telegram_chat_id в notification_preferences
// ЕДИНСТВЕННЫМ криптографически-безопасным путём: event публикуется auth-сервисом
// после успешного `/start <code>` → PollTelegramCode, где code однократный и
// создан на сайте в авторизованной сессии. Старая команда `/link <username>` в
// боте была уязвимой (любой мог захватить чужие уведомления) и отключена.
//
// Партиальный UNIQUE на telegram_chat_id в БД (миграция 00017) гарантирует
// что даже при race условии один чат не попадёт к двум user_id. Если SetTelegramChatID
// вернул constraint violation — логируем WARN и возвращаем ошибку (bus пропустит
// event в dead-letter при наличии; иначе retry'нется при следующем /start).
func (h *Handlers) OnTelegramChatLinked(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.TelegramChatLinked)
	if !ok {
		return fmt.Errorf("notify.OnTelegramChatLinked: unexpected event %T", ev)
	}
	if h.Prefs == nil {
		// Defensive — wiring забыли прицепить Prefs. Логируем громко, чтобы
		// bug всплыл сразу, но не паникуем.
		h.Log.ErrorContext(ctx, "notify.OnTelegramChatLinked: Prefs not wired",
			slog.String("user_id", e.UserID.String()))
		return fmt.Errorf("notify.OnTelegramChatLinked: Prefs repo not configured")
	}
	chatID := fmt.Sprintf("%d", e.ChatID)
	if err := h.Prefs.SetTelegramChatID(ctx, e.UserID, chatID); err != nil {
		h.Log.WarnContext(ctx, "notify.OnTelegramChatLinked: SetTelegramChatID failed",
			slog.String("user_id", e.UserID.String()),
			slog.Int64("chat_id", e.ChatID),
			slog.Any("err", err))
		return fmt.Errorf("notify.OnTelegramChatLinked: %w", err)
	}
	h.Log.InfoContext(ctx, "notify.chat_linked",
		slog.String("user_id", e.UserID.String()),
		slog.Int64("chat_id", e.ChatID))
	return nil
}

// ── Daily ────────────────────────────────────────────────────────────────

// OnDailyKataCompleted congratulates on streak milestones.
func (h *Handlers) OnDailyKataCompleted(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataCompleted)
	if !ok {
		return fmt.Errorf("notify.OnDailyKataCompleted: unexpected event %T", ev)
	}
	milestone := ""
	switch e.StreakNew {
	case 7:
		milestone = "Неделя подряд!"
	case 30:
		milestone = "Месяц подряд — это уже привычка."
	case 100:
		milestone = "100 дней! Легенда."
	}
	return h.Send.Do(ctx, SendInput{
		UserID: e.UserID,
		Type:   enums.NotificationTypeDailyKata,
		Payload: map[string]any{
			"MissedStreak": false,
			"Streak":       e.StreakNew,
			"XP":           e.XPEarned,
			"Milestone":    milestone,
		},
	})
}

// OnDailyKataMissed sends a freeze-token prompt.
func (h *Handlers) OnDailyKataMissed(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataMissed)
	if !ok {
		return fmt.Errorf("notify.OnDailyKataMissed: unexpected event %T", ev)
	}
	return h.Send.Do(ctx, SendInput{
		UserID: e.UserID,
		Type:   enums.NotificationTypeDailyKata,
		Payload: map[string]any{
			"MissedStreak": true,
			"StreakLost":   e.StreakLost,
			"FreezeUsed":   e.FreezeUsed,
		},
	})
}

// ── Arena ────────────────────────────────────────────────────────────────

// OnMatchStarted notifies each participant the match is live.
func (h *Handlers) OnMatchStarted(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.MatchStarted)
	if !ok {
		return fmt.Errorf("notify.OnMatchStarted: unexpected event %T", ev)
	}
	var errs []error
	for _, uid := range e.Players {
		if err := h.Send.Do(ctx, SendInput{
			UserID: uid,
			Type:   enums.NotificationTypeMatchFound,
			Payload: map[string]any{
				"Section":   string(e.Section),
				"TaskTitle": "",
			},
			Force: true, // match starting NOW — bypass quiet hours.
		}); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return fmt.Errorf("notify.OnMatchStarted: %d errors: %w", len(errs), errs[0])
	}
	return nil
}

// OnMatchCompleted sends win/loss DMs with ELO delta.
func (h *Handlers) OnMatchCompleted(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.MatchCompleted)
	if !ok {
		return fmt.Errorf("notify.OnMatchCompleted: unexpected event %T", ev)
	}
	for uid, delta := range e.EloDeltas {
		won := uid == e.WinnerID
		if err := h.Send.Do(ctx, SendInput{
			UserID: uid,
			Type:   enums.NotificationTypeMatchResult,
			Payload: map[string]any{
				"Section":  string(e.Section),
				"EloDelta": delta,
				"Won":      won,
			},
		}); err != nil {
			h.Log.WarnContext(ctx, "notify.OnMatchCompleted: send failed",
				slog.String("user_id", uid.String()), slog.Any("err", err))
		}
	}
	return nil
}

// ── Cohort ────────────────────────────────────────────────────────────────

// OnCohortWarStarted broadcasts to every member (STUB: needs cohort roster,
// which we don't have locally). Currently no-ops — the cohort domain should
// iterate members and publish per-user events in a future iteration.
func (h *Handlers) OnCohortWarStarted(ctx context.Context, ev sharedDomain.Event) error {
	_, ok := ev.(sharedDomain.CohortWarStarted)
	if !ok {
		return fmt.Errorf("notify.OnCohortWarStarted: unexpected event %T", ev)
	}
	// STUB: we need a CohortRoster read-through to fan out. Flag for follow-up.
	h.Log.InfoContext(ctx, "notify.OnCohortWarStarted: noop (needs roster)")
	return nil
}

// OnCohortWarFinished same STUB caveat as above.
func (h *Handlers) OnCohortWarFinished(ctx context.Context, ev sharedDomain.Event) error {
	_, ok := ev.(sharedDomain.CohortWarFinished)
	if !ok {
		return fmt.Errorf("notify.OnCohortWarFinished: unexpected event %T", ev)
	}
	h.Log.InfoContext(ctx, "notify.OnCohortWarFinished: noop (needs roster)")
	return nil
}

// ── Subscription / Auth / Skill ───────────────────────────────────────────

// OnSubscriptionActivated confirms the Premium upgrade.
func (h *Handlers) OnSubscriptionActivated(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.SubscriptionActivated)
	if !ok {
		return fmt.Errorf("notify.OnSubscriptionActivated: unexpected event %T", ev)
	}
	// We reuse the SeasonEnding template bucket for "has an Until". A dedicated
	// template is better — TODO: add NotificationTypeSubscriptionActivated to
	// shared/enums/notification.go then switch here.
	return h.Send.Do(ctx, SendInput{
		UserID: e.UserID,
		Type:   enums.NotificationTypeSeasonEnding,
		Payload: map[string]any{
			"Until": e.Until.Format("02.01.2006"),
		},
	})
}

// OnSkillDecayed warns about stale skill nodes.
func (h *Handlers) OnSkillDecayed(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.SkillDecayed)
	if !ok {
		return fmt.Errorf("notify.OnSkillDecayed: unexpected event %T", ev)
	}
	return h.Send.Do(ctx, SendInput{
		UserID: e.UserID,
		Type:   enums.NotificationTypeSkillDecay,
		Payload: map[string]any{
			"NodeKey":      e.NodeKey,
			"DaysInactive": e.DaysInactive,
		},
	})
}

// OnUserRegistered welcomes new users. Uses the DailyKata template slot as a
// placeholder with MissedStreak=false and a one-off payload.
// STUB: a dedicated Welcome template should land in a follow-up.
func (h *Handlers) OnUserRegistered(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.UserRegistered)
	if !ok {
		return fmt.Errorf("notify.OnUserRegistered: unexpected event %T", ev)
	}
	// Delivery is best-effort — new users likely don't have a telegram_chat_id
	// yet; the Sender returns ErrNoTarget and the worker falls through/logs.
	return h.Send.Do(ctx, SendInput{
		UserID: e.UserID,
		Type:   enums.NotificationTypeDailyKata, // reuse slot; STUB
		Payload: map[string]any{
			"MissedStreak": false,
			"Streak":       0,
			"XP":           0,
			"Milestone":    "Добро пожаловать в druz9! Открой сайт и выбери первую Kata.",
		},
	})
}

// ── Slot ─────────────────────────────────────────────────────────────────

// OnSlotBooked confirms the booking to the candidate.
func (h *Handlers) OnSlotBooked(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.SlotBooked)
	if !ok {
		return fmt.Errorf("notify.OnSlotBooked: unexpected event %T", ev)
	}
	return h.Send.Do(ctx, SendInput{
		UserID: e.CandidateID,
		Type:   enums.NotificationTypeSlotReminder,
		Payload: map[string]any{
			"StartsAt":    e.StartsAt.Format("02.01.2006 15:04"),
			"Interviewer": "интервьюер", // STUB: would need profile read-through
		},
	})
}

// ── Weekly report (internal event) ────────────────────────────────────────

// OnWeeklyReportDue receives the local-domain event emitted by the scheduler.
func (h *Handlers) OnWeeklyReportDue(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(domain.WeeklyReportDue)
	if !ok {
		return fmt.Errorf("notify.OnWeeklyReportDue: unexpected event %T", ev)
	}
	return h.Send.Do(ctx, SendInput{
		UserID: e.UserID,
		Type:   enums.NotificationTypeWeeklyReport,
		Payload: map[string]any{
			"Period":  e.At.Format("02.01.2006"),
			"Summary": "Открой сайт, чтобы увидеть полный отчёт.",
		},
	})
}
