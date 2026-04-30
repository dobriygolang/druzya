package app

import (
	"context"
	"testing"

	"druz9/ai_mock/domain"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// TL/EM parallels the English HR + senior SD tests — CreateSession
// must skip Tasks.PickForSession via Section.IsTaskBased() and
// persist the session with TaskID = uuid.Nil.

func TestCreateSession_TechLeadEM_SkipsTaskPick(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc, sessions, tasks, users, companies := newCreateSessionUC(t, ctrl)

	userID := uuid.New()
	companyID := uuid.New()

	users.EXPECT().Get(gomock.Any(), userID).Return(domain.UserContext{}, nil)
	companies.EXPECT().Get(gomock.Any(), companyID).Return(domain.CompanyContext{Name: "Ozon"}, nil)
	// tasks.PickForSession must NOT be called for TL/EM; gomock fails
	// on unexpected calls by default.
	_ = tasks

	sessions.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, s domain.Session) (domain.Session, error) {
			if s.TaskID != uuid.Nil {
				t.Errorf("TL/EM session must persist TaskID = uuid.Nil, got %v", s.TaskID)
			}
			if s.Section != enums.SectionTechLeadEM {
				t.Errorf("section must round-trip; got %v", s.Section)
			}
			return s, nil
		})

	in := CreateSessionInput{
		UserID:      userID,
		CompanyID:   companyID,
		Section:     enums.SectionTechLeadEM,
		Difficulty:  enums.DifficultyMedium,
		DurationMin: 45,
	}
	if _, err := uc.Do(context.Background(), in); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}
