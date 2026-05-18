//go:generate mockgen -package mocks -destination mocks/notification_templates_mock.go -source notification_templates.go

// notification_templates.go — notification template entity.
//
// Admin-curated message templates для notify service. Per-channel
// (email/tg/push/in_app); subject_template пустой для tg/push.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// NotificationChannel — discrete set, validated в use cases.
const (
	NotificationChannelEmail = "email"
	NotificationChannelTG    = "tg"
	NotificationChannelPush  = "push"
	NotificationChannelInApp = "in_app"
)

// NotificationTemplate mirrors a notification_templates row.
type NotificationTemplate struct {
	ID              uuid.UUID
	Slug            string
	Channel         string
	SubjectTemplate string
	BodyTemplate    string
	Variables       []string
	Description     string
	IsActive        bool
	CreatedBy       *uuid.UUID
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// NotificationTemplateUpsert — create payload.
type NotificationTemplateUpsert struct {
	Slug            string
	Channel         string
	SubjectTemplate string
	BodyTemplate    string
	Variables       []string
	Description     string
	IsActive        bool
	CreatedBy       *uuid.UUID
}

// NotificationTemplatePatch — partial update payload (pointer-fields).
type NotificationTemplatePatch struct {
	Channel         *string
	SubjectTemplate *string
	BodyTemplate    *string
	Variables       *[]string
	Description     *string
	IsActive        *bool
}

// NotificationTemplateRepo — persistence port.
type NotificationTemplateRepo interface {
	List(ctx context.Context, channel string, activeOnly bool) ([]NotificationTemplate, error)
	GetByID(ctx context.Context, id uuid.UUID) (NotificationTemplate, error)
	Create(ctx context.Context, in NotificationTemplateUpsert) (NotificationTemplate, error)
	Update(ctx context.Context, id uuid.UUID, in NotificationTemplatePatch) (NotificationTemplate, error)
	Deactivate(ctx context.Context, id uuid.UUID) error
}
