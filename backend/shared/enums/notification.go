package enums

type NotificationChannel string

const (
	NotificationChannelTelegram NotificationChannel = "telegram"
	NotificationChannelEmail    NotificationChannel = "email"
	NotificationChannelPush     NotificationChannel = "push"
)

func (c NotificationChannel) IsValid() bool {
	switch c {
	case NotificationChannelTelegram, NotificationChannelEmail, NotificationChannelPush:
		return true
	}
	return false
}

func (c NotificationChannel) String() string { return string(c) }

type NotificationType string

const (
	NotificationTypeSlotReminder    NotificationType = "slot_reminder"
	NotificationTypeMatchFound      NotificationType = "match_found"
	NotificationTypeMatchResult     NotificationType = "match_result"
	NotificationTypeWeeklyReport    NotificationType = "weekly_report"
	NotificationTypeSkillDecay      NotificationType = "skill_decay"
	NotificationTypeSeasonEnding    NotificationType = "season_ending"
	NotificationTypeDailyKata       NotificationType = "daily_kata"
)

func (t NotificationType) IsValid() bool {
	switch t {
	case NotificationTypeSlotReminder, NotificationTypeMatchFound, NotificationTypeMatchResult,
		NotificationTypeWeeklyReport, NotificationTypeSkillDecay,
		NotificationTypeSeasonEnding, NotificationTypeDailyKata:
		return true
	}
	return false
}

func (t NotificationType) String() string { return string(t) }
