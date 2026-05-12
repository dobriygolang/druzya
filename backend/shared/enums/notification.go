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
	NotificationTypeWeeklyReport      NotificationType = "weekly_report"
	NotificationTypeWelcome           NotificationType = "welcome"
	NotificationTypeAssignmentDueSoon NotificationType = "assignment_due_soon"
	// NotificationTypeTrialExpiring — daily cron в subscription пушит
	// эту нотификацию за ~24h до конца trial Pro. Outbound TG / email +
	// fallback. См. backend/services/subscription/app/notify_trial_expiring.go.
	NotificationTypeTrialExpiring NotificationType = "trial_expiring"
)

func (t NotificationType) IsValid() bool {
	switch t {
	case NotificationTypeWeeklyReport,
		NotificationTypeWelcome,
		NotificationTypeAssignmentDueSoon,
		NotificationTypeTrialExpiring:
		return true
	}
	return false
}

func (t NotificationType) String() string { return string(t) }
