// user_notifications.go — use cases для in-app notifications feed.
//
// Subscribers слушают cross-domain events и пишут UserNotification.Insert.
// HTTP-handler'ы (см. ports) вызывают List/MarkRead/MarkAllRead/Prefs.
package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"druz9/notify/domain"
	sharedDomain "druz9/shared/domain"

	"github.com/google/uuid"
)

// ListUserNotifications — GET /notifications.
type ListUserNotifications struct {
	Repo  domain.UserNotificationRepo
	Prefs domain.NotificationPrefsRepo
	Log   *slog.Logger
}

// Do возвращает страницу (всегда non-nil).
func (uc *ListUserNotifications) Do(ctx context.Context, uid uuid.UUID, f domain.NotificationFilter) ([]domain.UserNotification, error) {
	out, err := uc.Repo.ListByUser(ctx, uid, f)
	if err != nil {
		return nil, fmt.Errorf("notify.ListUser: %w", err)
	}
	return out, nil
}

// CountUnread — GET /notifications/unread_count.
type CountUnread struct {
	Repo domain.UserNotificationRepo
}

// Do возвращает unread count.
func (uc *CountUnread) Do(ctx context.Context, uid uuid.UUID) (int, error) {
	n, err := uc.Repo.CountUnread(ctx, uid)
	if err != nil {
		return n, fmt.Errorf("notify.CountUnread: %w", err)
	}
	return n, nil
}

// MarkRead / MarkAllRead обёртки.
type MarkRead struct{ Repo domain.UserNotificationRepo }

// Do mark single.
func (uc *MarkRead) Do(ctx context.Context, id int64, uid uuid.UUID) error {
	if err := uc.Repo.MarkRead(ctx, id, uid); err != nil {
		return fmt.Errorf("notify.MarkRead: %w", err)
	}
	return nil
}

// MarkAllRead обёртка.
type MarkAllRead struct{ Repo domain.UserNotificationRepo }

// Do mark all.
func (uc *MarkAllRead) Do(ctx context.Context, uid uuid.UUID) (int64, error) {
	n, err := uc.Repo.MarkAllRead(ctx, uid)
	if err != nil {
		return n, fmt.Errorf("notify.MarkAllRead: %w", err)
	}
	return n, nil
}

// GetPrefs / UpdatePrefs.
type GetPrefs struct{ Repo domain.NotificationPrefsRepo }

// Do get.
func (uc *GetPrefs) Do(ctx context.Context, uid uuid.UUID) (domain.NotificationPrefs, error) {
	p, err := uc.Repo.Get(ctx, uid)
	if err != nil {
		return p, fmt.Errorf("notify.GetPrefs: %w", err)
	}
	return p, nil
}

// UpdatePrefs upsert + return.
type UpdatePrefs struct{ Repo domain.NotificationPrefsRepo }

// Do upsert.
func (uc *UpdatePrefs) Do(ctx context.Context, p domain.NotificationPrefs) (domain.NotificationPrefs, error) {
	out, err := uc.Repo.Upsert(ctx, p)
	if err != nil {
		return out, fmt.Errorf("notify.UpdatePrefs: %w", err)
	}
	return out, nil
}

// ── Cross-domain subscribers ────────────────────────────────────────────────

// FeedHandlers — обработчики событий, пишущие in-app feed entries.
type FeedHandlers struct {
	Repo  domain.UserNotificationRepo
	Prefs domain.NotificationPrefsRepo
	Log   *slog.Logger
}

// NewFeedHandlers конструктор.
func NewFeedHandlers(repo domain.UserNotificationRepo, prefs domain.NotificationPrefsRepo, log *slog.Logger) *FeedHandlers {
	if log == nil {
		log = slog.Default()
	}
	return &FeedHandlers{Repo: repo, Prefs: prefs, Log: log}
}

// OnArenaMatchCompleted — пишет win/lose в каналах wins/match.
func (h *FeedHandlers) OnArenaMatchCompleted(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.MatchCompleted)
	if !ok {
		return nil
	}
	// Победителю.
	if !h.shouldDeliver(ctx, e.WinnerID, "wins") {
		// silence/disabled — пропускаем
	} else {
		_, err := h.Repo.Insert(ctx, domain.UserNotification{
			UserID:  e.WinnerID,
			Channel: "wins",
			Type:    "win",
			Title:   "Победа",
			Body:    fmt.Sprintf("Победа в матче · +%d ELO", elo(e, e.WinnerID)),
			Payload: map[string]any{
				"match_id": e.MatchID.String(),
				"section":  string(e.Section),
				"elo":      elo(e, e.WinnerID),
			},
			Priority: 1,
		})
		if err != nil {
			h.Log.WarnContext(ctx, "notify.feed.OnMatchCompleted: insert win failed", slog.Any("err", err))
		}
	}
	// Проигравшим.
	for _, l := range e.LoserIDs {
		if !h.shouldDeliver(ctx, l, "match") {
			continue
		}
		_, err := h.Repo.Insert(ctx, domain.UserNotification{
			UserID:  l,
			Channel: "match",
			Type:    "loss",
			Title:   "Поражение",
			Body:    fmt.Sprintf("Матч завершён · %d ELO", elo(e, l)),
			Payload: map[string]any{
				"match_id": e.MatchID.String(),
				"section":  string(e.Section),
				"elo":      elo(e, l),
			},
		})
		if err != nil {
			h.Log.WarnContext(ctx, "notify.feed.OnMatchCompleted: insert loss failed", slog.Any("err", err))
		}
	}
	return nil
}

func elo(e sharedDomain.MatchCompleted, uid uuid.UUID) int {
	if e.EloDeltas == nil {
		return 0
	}
	return e.EloDeltas[uid]
}

// OnFriendRequest подписывается на friends.RequestReceived через
// общий sharedDomain.Event (we type-assert внутри).
//
// Поскольку friends.FriendRequestReceived лежит в другом модуле и реализует
// sharedDomain.Event с Topic()=="friends.RequestReceived", мы дёргаем его
// через рефлексию-free type-проверку только по Topic().
func (h *FeedHandlers) OnFriendRequest(ctx context.Context, ev sharedDomain.Event) error {
	if ev.Topic() != "friends.RequestReceived" {
		return nil
	}
	// Извлекаем поля через FriendRequestPayloader, который реализован
	// adapter'ом в monolith services/friends.go (см. wiring).
	if pe, ok := ev.(friendRequestPayloader); ok {
		_, err := h.Repo.Insert(ctx, domain.UserNotification{
			UserID:  pe.Addressee(),
			Channel: "social",
			Type:    "friend_request",
			Title:   "Новая заявка в друзья",
			Body:    "Кто-то добавил тебя в друзья",
			Payload: map[string]any{
				"requester_id":  pe.Requester().String(),
				"friendship_id": pe.FriendshipID(),
			},
		})
		if err != nil {
			h.Log.WarnContext(ctx, "notify.feed.OnFriendRequest: insert failed", slog.Any("err", err))
		}
	}
	return nil
}

// friendRequestPayloader — узкий интерфейс, который должны удовлетворить
// события friends-домена. friends.FriendRequestReceived реализует его прямо
// в своём типе (см. friends/domain/events.go: Requester/Addressee — поля).
//
// Чтобы избежать import cycle, мы расширяем event этим runtime-протоколом
// через type-assert (см. сама adapter-функцию в monolith wiring или прямо
// здесь — проверка через interface).
type friendRequestPayloader interface {
	Requester() uuid.UUID
	Addressee() uuid.UUID
	FriendshipID() int64
}

// OnGuildWarStarted — guild channel.
func (h *FeedHandlers) OnGuildWarStarted(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.GuildWarStarted)
	if !ok {
		return nil
	}
	// Без guild_members-репо мы не знаем, кому слать. Скорее всего вырастет
	// отдельный publisher в guild-домене. На этот этап — лог-тейпинг.
	h.Log.InfoContext(ctx, "notify.feed.OnGuildWarStarted: no member-fanout yet",
		slog.String("war_id", e.WarID.String()))
	return nil
}

// OnGuildWarFinished — то же.
func (h *FeedHandlers) OnGuildWarFinished(ctx context.Context, ev sharedDomain.Event) error {
	_, _ = ev.(sharedDomain.GuildWarFinished)
	return nil
}

// OnDailyKataMissed — system channel: streak under attack.
func (h *FeedHandlers) OnDailyKataMissed(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataMissed)
	if !ok {
		return nil
	}
	if !h.shouldDeliver(ctx, e.UserID, "system") {
		return nil
	}
	body := fmt.Sprintf("Ты пропустил Daily · streak сброшен (-%d дней)", e.StreakLost)
	if e.FreezeUsed {
		body = "Streak Freeze активирован автоматически"
	}
	_, err := h.Repo.Insert(ctx, domain.UserNotification{
		UserID:  e.UserID,
		Channel: "system",
		Type:    "streak_at_risk",
		Title:   "Streak под угрозой",
		Body:    body,
	})
	if err != nil {
		return fmt.Errorf("notify.feed.OnDailyKataMissed: %w", err)
	}
	return nil
}

// OnDailyKataCompleted — wins channel + streak milestones.
func (h *FeedHandlers) OnDailyKataCompletedFeed(ctx context.Context, ev sharedDomain.Event) error {
	e, ok := ev.(sharedDomain.DailyKataCompleted)
	if !ok {
		return nil
	}
	if !h.shouldDeliver(ctx, e.UserID, "wins") {
		return nil
	}
	title := "Daily решён"
	body := fmt.Sprintf("+%d XP · streak %d", e.XPEarned, e.StreakNew)
	switch e.StreakNew {
	case 7, 30, 100:
		title = fmt.Sprintf("Streak %d дней!", e.StreakNew)
	}
	_, err := h.Repo.Insert(ctx, domain.UserNotification{
		UserID:  e.UserID,
		Channel: "wins",
		Type:    "daily_done",
		Title:   title,
		Body:    body,
		Payload: map[string]any{"streak": e.StreakNew, "xp": e.XPEarned},
	})
	if err != nil {
		return fmt.Errorf("notify.feed.OnDailyKataCompleted: %w", err)
	}
	return nil
}

// shouldDeliver — true если канал не выключен и не silenced.
func (h *FeedHandlers) shouldDeliver(ctx context.Context, uid uuid.UUID, channel string) bool {
	if h.Prefs == nil {
		return true
	}
	p, err := h.Prefs.Get(ctx, uid)
	if err != nil {
		// fail-open: если prefs недоступны — лучше показать, чем замолчать.
		return true
	}
	if p.IsSilenced(time.Now().UTC()) {
		return false
	}
	return p.IsChannelEnabled(channel)
}
