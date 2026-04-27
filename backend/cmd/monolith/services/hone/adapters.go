// adapters.go — cross-domain adapters owned by hone wiring.
//
// Three thin shims:
//   - NewHoneSkillAtlasAdapter — wraps honeInfra.NewSkillAtlasReader so
//     bootstrap doesn't need to know about hone-infra packages directly.
//   - NewHoneTierAdapter        — same for the subscription-tier reader.
//   - NewHoneNotificationAdapter — bridges the notify TG-bot onto
//     hone.domain.NotificationSender for the Cue-followup feature.
//
// Used to live in monolith services/adapters.go; moved here so hone
// owns its own outbound adapters (microservice-extraction friendly).
package hone

import (
	"context"
	"errors"
	"fmt"

	honeDomain "druz9/hone/domain"
	honeInfra "druz9/hone/infra"
	notifyDomain "druz9/notify/domain"
	notifyInfra "druz9/notify/infra"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewHoneSkillAtlasAdapter — thin wrapper preserving bootstrap-API.
func NewHoneSkillAtlasAdapter(pool *pgxpool.Pool) honeDomain.SkillAtlasReader {
	return honeInfra.NewSkillAtlasReader(pool)
}

// NewHoneTierAdapter — thin wrapper preserving bootstrap-API.
func NewHoneTierAdapter(pool *pgxpool.Pool) honeDomain.TierReader {
	return honeInfra.NewTierReader(pool)
}

// honeNotificationAdapter implements hone.domain.NotificationSender. Used
// for one feature: SendCueSessionToTelegram — push markdown summary of a
// meeting from the Hone app to the user's personal TG chat.
//
// Why not via notifyApp.SendNotification.Do (the full pipeline):
//   - SendNotification requires a cuekey'ed NotificationType + ready
//     Template — but here body is dynamic (user markdown). Re-flowing
//     pipeline for one call isn't worth it.
//   - For feature-degradation (user not linked to TG) we want a
//     user-facing message ("telegram not linked"), not a silent skip.
//
// Resolves chat_id via PreferencesRepo (same place /start <code> writes).
// If chat_id is empty → ok=false, message="telegram not linked".
// Send errors (network/429/etc) bubble up — caller returns 5xx.
type honeNotificationAdapter struct {
	bot   *notifyInfra.TelegramBot
	prefs notifyDomain.PreferencesRepo
}

// NewHoneNotificationAdapter — constructor for monolith bootstrap.
// nil-safe: if bot or prefs are nil returns nil — Hone treats that
// as "TG follow-up disabled" (see types.go HoneNotificationSender doc).
func NewHoneNotificationAdapter(bot *notifyInfra.TelegramBot, prefs notifyDomain.PreferencesRepo) honeDomain.NotificationSender {
	if bot == nil || prefs == nil {
		return nil
	}
	return &honeNotificationAdapter{bot: bot, prefs: prefs}
}

// SendCueFollowup sends a markdown meeting-summary to the user's
// personal TG chat. Returns (ok=true, "") on success, (ok=false, message)
// when the user isn't linked, (false, "", err) on infra error.
func (a *honeNotificationAdapter) SendCueFollowup(ctx context.Context, userID uuid.UUID, title, bodyMD string) (bool, string, error) {
	pref, err := a.prefs.Get(ctx, userID)
	if err != nil {
		if errors.Is(err, notifyDomain.ErrNotFound) {
			return false, "telegram not linked", nil
		}
		return false, "", fmt.Errorf("hone.notificationAdapter: prefs: %w", err)
	}
	if pref.TelegramChatID == "" {
		return false, "telegram not linked", nil
	}
	text := title
	if text == "" {
		text = "Meeting notes"
	}
	if bodyMD != "" {
		text = text + "\n\n" + bodyMD
	}
	tpl := notifyDomain.Template{Text: text}
	if err := a.bot.Send(ctx, userID, pref.TelegramChatID, tpl); err != nil {
		if errors.Is(err, notifyDomain.ErrNoTarget) {
			return false, "telegram not linked", nil
		}
		return false, "", fmt.Errorf("hone.notificationAdapter: send: %w", err)
	}
	return true, "", nil
}
