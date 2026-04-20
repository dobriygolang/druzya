package domain

import (
	"errors"
	"time"

	"druz9/shared/enums"
)

// DefaultDedupWindow is the no-resend window for identical (user, type) pairs.
// Bible §3.11 "no spamming the same notification within 30 min".
const DefaultDedupWindow = 30 * time.Minute

// ErrNoTarget is returned by a sender when the user has no identity for that
// channel (e.g. Telegram chat_id unset). The worker uses this to fall through
// to the next enabled channel instead of marking the row failed.
var ErrNoTarget = errors.New("notify: no target for channel")

// DefaultPreferences returns the prefs used when no row exists yet. The user
// gets Telegram-only, all opt-ins on.
func DefaultPreferences() Preferences {
	return Preferences{
		Channels: []enums.NotificationChannel{
			enums.NotificationChannelTelegram,
		},
		WeeklyReportEnabled:       true,
		SkillDecayWarningsEnabled: true,
	}
}

// ShouldNotify decides whether a given event type should be delivered right now
// given the user's preferences and recent-send history.
//
//	pref       — the user's Preferences (or DefaultPreferences if missing).
//	typ        — the notification category.
//	now        — wall-clock (inject for testability).
//	lastSent   — the most recent LogEntry.SentAt for (user, typ), or nil.
//	force      — bypass the quiet-hours check (used for MatchStarted).
//
// Returns (allowed, reason). `reason` is a short enum-ish string describing
// why we skipped; empty when allowed. Dedup check is on the *caller's* side
// (they pass `lastSent`) so the core function stays pure.
func ShouldNotify(pref Preferences, typ enums.NotificationType, now time.Time, lastSent *time.Time, force bool) (bool, string) {
	// Per-type opt-outs first.
	switch typ { //nolint:exhaustive // only types with explicit opt-outs need branches
	case enums.NotificationTypeWeeklyReport:
		if !pref.WeeklyReportEnabled {
			return false, "weekly_report_disabled"
		}
	case enums.NotificationTypeSkillDecay:
		if !pref.SkillDecayWarningsEnabled {
			return false, "skill_decay_disabled"
		}
	}

	// Dedup window — skip if we sent this same type recently.
	if lastSent != nil && now.Sub(*lastSent) < DefaultDedupWindow {
		return false, "dedup_window"
	}

	// Quiet hours — honour unless force=true.
	if !force && pref.Quiet.Set && InQuietHours(pref.Quiet, now) {
		return false, "quiet_hours"
	}

	// At least one channel must be enabled.
	if len(pref.Channels) == 0 {
		return false, "no_channels"
	}

	return true, ""
}

// InQuietHours reports whether `now`'s time-of-day falls into [From,To).
// Handles the wrap-around case (22:00 → 08:00).
func InQuietHours(q QuietHours, now time.Time) bool {
	if !q.Set {
		return false
	}
	fromMin := q.From.Hour()*60 + q.From.Minute()
	toMin := q.To.Hour()*60 + q.To.Minute()
	nowMin := now.Hour()*60 + now.Minute()

	if fromMin == toMin {
		return false // degenerate: no window
	}
	if fromMin < toMin {
		return nowMin >= fromMin && nowMin < toMin
	}
	// Wraps midnight: e.g. from=22:00, to=08:00.
	return nowMin >= fromMin || nowMin < toMin
}

// PickChannel returns the first preferred channel the user has enabled, in the
// canonical priority order: telegram > email > push. Returns ("", false) if the
// user has no enabled channels (caller treats as no-op).
func PickChannel(pref Preferences) (enums.NotificationChannel, bool) {
	for _, c := range []enums.NotificationChannel{
		enums.NotificationChannelTelegram,
		enums.NotificationChannelEmail,
		enums.NotificationChannelPush,
	} {
		if pref.HasChannel(c) {
			return c, true
		}
	}
	return "", false
}

// ValidateChannels checks every value in the slice against NotificationChannel.IsValid.
func ValidateChannels(chs []enums.NotificationChannel) error {
	for _, c := range chs {
		if !c.IsValid() {
			return ErrInvalidChannel
		}
	}
	return nil
}

// MustForceDelivery lists the types that bypass quiet hours because the
// event is time-sensitive (cannot be queued until morning). Bible §3.11.
func MustForceDelivery(typ enums.NotificationType) bool {
	switch typ { //nolint:exhaustive
	case enums.NotificationTypeMatchFound:
		return true
	}
	return false
}
