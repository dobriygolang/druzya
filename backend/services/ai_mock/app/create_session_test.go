package app

import (
	"context"
	"testing"
	"time"

	"druz9/ai_mock/domain"
	"druz9/ai_mock/domain/mocks"
	"druz9/shared/enums"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// English HR Wave 1 — CreateSession must skip the Tasks.PickForSession
// call and persist the session with TaskID = uuid.Nil. The downstream
// loaders (send_message, get_session, worker) branch on that nil to
// avoid hitting GetWithHint with a zero id.

// fixedNow is reserved for future tests that need a deterministic clock —
// keep the type and constructor reachable via the unused stub below so the
// linter doesn't flag them while we wait for the next harness.
type fixedNow struct{ t time.Time }

func (f fixedNow) Now() time.Time { return f.t }

var _ = fixedNow{}.Now

func newCreateSessionUC(t *testing.T, ctrl *gomock.Controller) (*CreateSession, *mocks.MockSessionRepo, *mocks.MockTaskRepo, *mocks.MockUserRepo, *mocks.MockCompanyRepo) {
	t.Helper()
	sessions := mocks.NewMockSessionRepo(ctrl)
	tasks := mocks.NewMockTaskRepo(ctrl)
	users := mocks.NewMockUserRepo(ctrl)
	companies := mocks.NewMockCompanyRepo(ctrl)
	uc := &CreateSession{
		Sessions:         sessions,
		Tasks:            tasks,
		Users:            users,
		Companies:        companies,
		DefaultModelFree: enums.LLMModelGPT4oMini,
		DefaultModelPaid: enums.LLMModelGPT4oMini,
		Now:              func() time.Time { return time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC) },
	}
	return uc, sessions, tasks, users, companies
}

func TestCreateSession_EnglishHR_SkipsTaskPickAndStoresNilTaskID(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc, sessions, tasks, users, companies := newCreateSessionUC(t, ctrl)

	userID := uuid.New()
	companyID := uuid.New()

	users.EXPECT().Get(gomock.Any(), userID).Return(domain.UserContext{}, nil)
	companies.EXPECT().Get(gomock.Any(), companyID).Return(domain.CompanyContext{Name: "Acme"}, nil)
	// Critical: PickForSession MUST NOT be called for English HR. ctrl
	// will FAIL the test on any unexpected call to tasks.* (gomock's
	// default for strict mocks).
	_ = tasks // referenced so the linter doesn't complain about unused

	sessions.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, s domain.Session) (domain.Session, error) {
			if s.TaskID != uuid.Nil {
				t.Errorf("English HR session must persist TaskID = uuid.Nil, got %v", s.TaskID)
			}
			if s.Section != enums.SectionEnglishHR {
				t.Errorf("Section should round-trip; got %v", s.Section)
			}
			return s, nil
		})

	in := CreateSessionInput{
		UserID:      userID,
		CompanyID:   companyID,
		Section:     enums.SectionEnglishHR,
		Difficulty:  enums.DifficultyMedium,
		DurationMin: 30,
	}
	if _, err := uc.Do(context.Background(), in); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestCreateSession_EngineeringSection_StillPicksTask(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	uc, sessions, tasks, users, companies := newCreateSessionUC(t, ctrl)

	userID := uuid.New()
	companyID := uuid.New()
	taskID := uuid.New()

	users.EXPECT().Get(gomock.Any(), userID).Return(domain.UserContext{}, nil)
	companies.EXPECT().Get(gomock.Any(), companyID).Return(domain.CompanyContext{Name: "Acme"}, nil)
	tasks.EXPECT().
		PickForSession(gomock.Any(), "algorithms", "medium").
		Return(domain.TaskWithHint{ID: taskID, Title: "Two Sum"}, nil)
	sessions.EXPECT().
		Create(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, s domain.Session) (domain.Session, error) {
			if s.TaskID != taskID {
				t.Errorf("engineering session must carry the picked TaskID, got %v want %v", s.TaskID, taskID)
			}
			return s, nil
		})

	in := CreateSessionInput{
		UserID:      userID,
		CompanyID:   companyID,
		Section:     enums.SectionAlgorithms,
		Difficulty:  enums.DifficultyMedium,
		DurationMin: 30,
	}
	if _, err := uc.Do(context.Background(), in); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}
