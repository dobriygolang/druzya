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
)

func (t NotificationType) IsValid() bool {
	switch t {
	case NotificationTypeWeeklyReport, NotificationTypeWelcome, NotificationTypeAssignmentDueSoon:
		return true
	}
	return false
}

func (t NotificationType) String() string { return string(t) }
