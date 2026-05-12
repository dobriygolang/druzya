package app

import (
	"context"
	"errors"
	"testing"

	"druz9/admin/domain"

	"github.com/google/uuid"
)

type fakeNotifTplRepo struct {
	list      []domain.NotificationTemplate
	createIn  domain.NotificationTemplateUpsert
	createOut domain.NotificationTemplate
	listErr   error
	createErr error
}

func (f *fakeNotifTplRepo) List(_ context.Context, _ string, _ bool) ([]domain.NotificationTemplate, error) {
	return f.list, f.listErr
}
func (f *fakeNotifTplRepo) GetByID(_ context.Context, _ uuid.UUID) (domain.NotificationTemplate, error) {
	return domain.NotificationTemplate{}, domain.ErrNotFound
}
func (f *fakeNotifTplRepo) Create(_ context.Context, in domain.NotificationTemplateUpsert) (domain.NotificationTemplate, error) {
	f.createIn = in
	return f.createOut, f.createErr
}
func (f *fakeNotifTplRepo) Update(_ context.Context, _ uuid.UUID, _ domain.NotificationTemplatePatch) (domain.NotificationTemplate, error) {
	return domain.NotificationTemplate{}, nil
}
func (f *fakeNotifTplRepo) Deactivate(_ context.Context, _ uuid.UUID) error {
	return nil
}

func TestCreateNotificationTemplate_RejectsBadChannel(t *testing.T) {
	t.Parallel()
	uc := &CreateNotificationTemplate{Repo: &fakeNotifTplRepo{}}
	_, err := uc.Do(context.Background(), domain.NotificationTemplateUpsert{
		Slug: "x", Channel: "fax", BodyTemplate: "hi",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateNotificationTemplate_EmailRequiresSubject(t *testing.T) {
	t.Parallel()
	uc := &CreateNotificationTemplate{Repo: &fakeNotifTplRepo{}}
	_, err := uc.Do(context.Background(), domain.NotificationTemplateUpsert{
		Slug: "x", Channel: domain.NotificationChannelEmail, BodyTemplate: "body",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateNotificationTemplate_TGOK(t *testing.T) {
	t.Parallel()
	repo := &fakeNotifTplRepo{createOut: domain.NotificationTemplate{Slug: "x"}}
	uc := &CreateNotificationTemplate{Repo: repo}
	_, err := uc.Do(context.Background(), domain.NotificationTemplateUpsert{
		Slug: "x", Channel: domain.NotificationChannelTG, BodyTemplate: "hi {{u}}",
		Variables: []string{"{{u}}"},
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestListNotificationTemplates_RejectsBadChannelFilter(t *testing.T) {
	t.Parallel()
	uc := &ListNotificationTemplates{Repo: &fakeNotifTplRepo{}}
	_, err := uc.Do(context.Background(), "fax", false)
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
