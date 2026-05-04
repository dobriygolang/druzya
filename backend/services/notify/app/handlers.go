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

// OnUserRegistered sends a welcome notification to new users.
// Delivery is best-effort — new users don't have a telegram_chat_id yet;
// the Sender returns ErrNoTarget and the worker logs + continues.
func (h *Handlers) OnUserRegistered(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.UserRegistered)
	if !ok {
		return fmt.Errorf("notify.OnUserRegistered: unexpected event %T", ev)
	}
	return h.Send.Do(ctx, SendInput{
		UserID: e.UserID,
		Type:   enums.NotificationTypeWelcome,
		Payload: map[string]any{
			"Username": e.Username,
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

