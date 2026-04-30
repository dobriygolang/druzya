package app

import (
	"context"
	"testing"

	"druz9/ai_mock/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// Senior SD parallels the English HR test in create_session_test.go —
// CreateSession must skip Tasks.PickForSession and persist the session
// with TaskID = uuid.Nil. Different section, same gate (IsTaskBased).

func TestCreateSession_SystemDesignSenior_SkipsTaskPick(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc, sessions, tasks, users, companies := newCreateSessionUC(t, ctrl)

	userID := uuid.New()
	companyID := uuid.New()

	users.EXPECT().Get(gomock.Any(), userID).Return(domain.UserContext{}, nil)
	companies.EXPECT().Get(gomock.Any(), companyID).Return(domain.CompanyContext{Name: "Avito"}, nil)
	// tasks must NOT be called for senior SD; gomock fails on any
	// unexpected call by default.
	_ = tasks

	sessions.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, s domain.Session) (domain.Session, error) {
			if s.TaskID != uuid.Nil {
				t.Errorf("senior SD session must persist TaskID = uuid.Nil, got %v", s.TaskID)
			}
			if s.Section != enums.SectionSystemDesignSenior {
				t.Errorf("section must round-trip; got %v", s.Section)
			}
			return s, nil
		})

	in := CreateSessionInput{
		UserID:      userID,
		CompanyID:   companyID,
		Section:     enums.SectionSystemDesignSenior,
		Difficulty:  enums.DifficultyMedium,
		DurationMin: 45,
	}
	if _, err := uc.Do(context.Background(), in); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}
