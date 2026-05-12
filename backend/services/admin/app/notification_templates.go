// notification_templates.go — Admin Phase 2: notification template UCs.
//
// CRUD over NotificationTemplateRepo. Validation:
//   - slug + body non-empty.
//   - channel в whitelist (email|tg|push|in_app).
//   - subject required when channel == email.
//   - variables match {{name}}.
package app

import (
	"context"
	"fmt"
	"strings"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

var allowedNotificationChannels = map[string]struct{}{
	domain.NotificationChannelEmail: {},
	domain.NotificationChannelTG:    {},
	domain.NotificationChannelPush:  {},
	domain.NotificationChannelInApp: {},
}

// ─────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────

// ListNotificationTemplates — channel filter optional (empty = all).
type ListNotificationTemplates struct {
	Repo domain.NotificationTemplateRepo
}

// Do — channel filter empty == all channels.
func (uc *ListNotificationTemplates) Do(ctx context.Context, channel string, activeOnly bool) ([]domain.NotificationTemplate, error) {
	if channel != "" {
		if _, ok := allowedNotificationChannels[channel]; !ok {
			return nil, fmt.Errorf("%w: unknown channel %q", domain.ErrInvalidInput, channel)
		}
	}
	out, err := uc.Repo.List(ctx, channel, activeOnly)
	if err != nil {
		return nil, fmt.Errorf("admin.ListNotificationTemplates: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────

// CreateNotificationTemplate — admin-only.
type CreateNotificationTemplate struct {
	Repo domain.NotificationTemplateRepo
}

// Do validates + persists.
func (uc *CreateNotificationTemplate) Do(ctx context.Context, in domain.NotificationTemplateUpsert) (domain.NotificationTemplate, error) {
	if err := validateNotifUpsert(in); err != nil {
		return domain.NotificationTemplate{}, err
	}
	out, err := uc.Repo.Create(ctx, in)
	if err != nil {
		return domain.NotificationTemplate{}, fmt.Errorf("admin.CreateNotificationTemplate: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Update
// ─────────────────────────────────────────────────────────────────────────

// UpdateNotificationTemplate — partial-patch UC.
type UpdateNotificationTemplate struct {
	Repo domain.NotificationTemplateRepo
}

// Do validates patch + delegates.
func (uc *UpdateNotificationTemplate) Do(ctx context.Context, id uuid.UUID, patch domain.NotificationTemplatePatch) (domain.NotificationTemplate, error) {
	if id == uuid.Nil {
		return domain.NotificationTemplate{}, fmt.Errorf("%w: id required", domain.ErrInvalidInput)
	}
	if err := validateNotifPatch(patch); err != nil {
		return domain.NotificationTemplate{}, err
	}
	out, err := uc.Repo.Update(ctx, id, patch)
	if err != nil {
		return domain.NotificationTemplate{}, fmt.Errorf("admin.UpdateNotificationTemplate: %w", err)
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Deactivate
// ─────────────────────────────────────────────────────────────────────────

// DeactivateNotificationTemplate — soft delete.
type DeactivateNotificationTemplate struct {
	Repo domain.NotificationTemplateRepo
}

// Do flips is_active to false.
func (uc *DeactivateNotificationTemplate) Do(ctx context.Context, id uuid.UUID) error {
	if id == uuid.Nil {
		return fmt.Errorf("%w: id required", domain.ErrInvalidInput)
	}
	if err := uc.Repo.Deactivate(ctx, id); err != nil {
		return fmt.Errorf("admin.DeactivateNotificationTemplate: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────

func validateNotifUpsert(in domain.NotificationTemplateUpsert) error {
	if strings.TrimSpace(in.Slug) == "" {
		return fmt.Errorf("%w: slug required", domain.ErrInvalidInput)
	}
	if strings.TrimSpace(in.BodyTemplate) == "" {
		return fmt.Errorf("%w: body_template required", domain.ErrInvalidInput)
	}
	if _, ok := allowedNotificationChannels[in.Channel]; !ok {
		return fmt.Errorf("%w: invalid channel %q", domain.ErrInvalidInput, in.Channel)
	}
	if in.Channel == domain.NotificationChannelEmail && strings.TrimSpace(in.SubjectTemplate) == "" {
		return fmt.Errorf("%w: subject_template required for email channel", domain.ErrInvalidInput)
	}
	if err := validateVariables(in.Variables); err != nil {
		return err
	}
	return nil
}

func validateNotifPatch(p domain.NotificationTemplatePatch) error {
	if p.BodyTemplate != nil && strings.TrimSpace(*p.BodyTemplate) == "" {
		return fmt.Errorf("%w: body_template cannot be blank", domain.ErrInvalidInput)
	}
	if p.Channel != nil {
		if _, ok := allowedNotificationChannels[*p.Channel]; !ok {
			return fmt.Errorf("%w: invalid channel %q", domain.ErrInvalidInput, *p.Channel)
		}
	}
	if p.Variables != nil {
		if err := validateVariables(*p.Variables); err != nil {
			return err
		}
	}
	return nil
}
