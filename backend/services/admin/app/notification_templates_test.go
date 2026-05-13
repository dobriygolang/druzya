package app

import (
	"context"
	"errors"
	"testing"

	"druz9/admin/domain"
	"druz9/admin/domain/mocks"

	"go.uber.org/mock/gomock"
)

func TestCreateNotificationTemplate_RejectsBadChannel(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &CreateNotificationTemplate{Repo: mocks.NewMockNotificationTemplateRepo(ctrl)}
	_, err := uc.Do(context.Background(), domain.NotificationTemplateUpsert{
		Slug: "x", Channel: "fax", BodyTemplate: "hi",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateNotificationTemplate_EmailRequiresSubject(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc := &CreateNotificationTemplate{Repo: mocks.NewMockNotificationTemplateRepo(ctrl)}
	_, err := uc.Do(context.Background(), domain.NotificationTemplateUpsert{
		Slug: "x", Channel: domain.NotificationChannelEmail, BodyTemplate: "body",
	})
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreateNotificationTemplate_TGOK(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	repo := mocks.NewMockNotificationTemplateRepo(ctrl)
	repo.EXPECT().Create(gomock.Any(), gomock.Any()).Return(domain.NotificationTemplate{Slug: "x"}, nil)
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
	ctrl := gomock.NewController(t)
	uc := &ListNotificationTemplates{Repo: mocks.NewMockNotificationTemplateRepo(ctrl)}
	_, err := uc.Do(context.Background(), "fax", false)
	if !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}
