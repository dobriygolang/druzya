// Package ports test suite for DailyServer. Mirrors the layout of
// profile/ports/server_test.go and rating/ports/server_test.go.
//
// Note: GetKata pulls in TaskRepo + SkillRepo + KataRepo, so the
// "Happy" path needs all three wired. We use the mockgen-generated
// mocks under daily/domain/mocks/.
package ports

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"druz9/daily/app"
	"druz9/daily/domain"
	"druz9/daily/domain/mocks"
	sharedDomain "druz9/shared/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"
	sharedMw "druz9/shared/pkg/middleware"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// fakeJudge always returns passed=true; matches the prod stub.
type fakeJudge struct{ passed bool }

func (f fakeJudge) Submit(_ context.Context, _, _ string, _ domain.TaskPublic) (bool, int, int, error) {
	return f.passed, 1, 1, nil
}

// noopBus discards every Publish.
type noopBus struct{}

func (noopBus) Publish(_ context.Context, _ sharedDomain.Event) error { return nil }
func (noopBus) Subscribe(_ string, _ sharedDomain.Handler)            {}

func fixedNow(t time.Time) func() time.Time { return func() time.Time { return t } }

func newTestDailyServer(_ *testing.T,
	tasks domain.TaskRepo,
	skills domain.SkillRepo,
	katas domain.KataRepo,
	streaks domain.StreakRepo,
	cal domain.CalendarRepo,
	now time.Time,
	passed bool,
) *DailyServer {
	log := silentLogger()
	h := NewHandler(Handler{
		GetKata:        &app.GetKata{Skills: skills, Tasks: tasks, Katas: katas, Now: fixedNow(now)},
		GetKataBySlug:  &app.GetKataBySlug{Tasks: tasks},
		SubmitKata:     &app.SubmitKata{Tasks: tasks, Katas: katas, Streaks: streaks, Judge: fakeJudge{passed: passed}, Bus: noopBus{}, Log: log, Now: fixedNow(now)},
		GetStreak:      &app.GetStreak{Streaks: streaks, Katas: katas, Now: fixedNow(now)},
		GetCalendar:    &app.GetCalendar{Cal: cal, Now: fixedNow(now)},
		UpsertCalendar: &app.UpsertCalendar{Cal: cal, Now: fixedNow(now)},
		Log:            log,
	})
	return NewDailyServer(h)
}

func sampleTask() domain.TaskPublic {
	return domain.TaskPublic{
		ID:         uuid.New(),
		Slug:       "two-sum",
		Title:      "Two Sum",
		Section:    enums.SectionAlgorithms,
		Difficulty: enums.DifficultyEasy,
	}
}

func TestDailyServer_GetKata_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tasks := mocks.NewMockTaskRepo(ctrl)
	skills := mocks.NewMockSkillRepo(ctrl)
	katas := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2030, 6, 4, 12, 0, 0, 0, time.UTC) // Tuesday
	today := now.Truncate(24 * time.Hour)
	task := sampleTask()
	skills.EXPECT().WeakestNode(gomock.Any(), uid).Return(domain.NodeWeakness{
		Section: enums.SectionAlgorithms, Difficulty: enums.DifficultyEasy, Progress: 10,
	}, nil)
	tasks.EXPECT().ListActiveBySectionDifficulty(gomock.Any(), enums.SectionAlgorithms, gomock.Any()).
		Return([]domain.TaskPublic{task}, nil)
	katas.EXPECT().GetOrAssign(gomock.Any(), uid, today, task.ID, gomock.Any(), gomock.Any()).
		Return(domain.Assignment{UserID: uid, KataDate: today, TaskID: task.ID}, true, nil)

	srv := newTestDailyServer(t, tasks, skills, katas, nil, nil, now, true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetKata(ctx, connect.NewRequest(&pb.GetDailyKataRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetTask().GetSlug() != "two-sum" {
		t.Fatalf("got %+v", resp.Msg)
	}
	if resp.Msg.GetDate() != today.Format("2006-01-02") {
		t.Fatalf("date mismatch: %s", resp.Msg.GetDate())
	}
}

func TestDailyServer_GetKata_Unauthenticated(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	srv := newTestDailyServer(t,
		mocks.NewMockTaskRepo(ctrl), mocks.NewMockSkillRepo(ctrl), mocks.NewMockKataRepo(ctrl),
		nil, nil, time.Now().UTC(), true)
	_, err := srv.GetKata(context.Background(), connect.NewRequest(&pb.GetDailyKataRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}

func TestDailyServer_GetKata_NoTasks_Internal(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tasks := mocks.NewMockTaskRepo(ctrl)
	skills := mocks.NewMockSkillRepo(ctrl)
	katas := mocks.NewMockKataRepo(ctrl)
	uid := uuid.New()
	skills.EXPECT().WeakestNode(gomock.Any(), uid).Return(domain.NodeWeakness{
		Section: enums.SectionAlgorithms, Difficulty: enums.DifficultyEasy,
	}, nil)
	tasks.EXPECT().ListActiveBySectionDifficulty(gomock.Any(), gomock.Any(), gomock.Any()).
		Return(nil, nil)
	srv := newTestDailyServer(t, tasks, skills, katas, nil, nil, time.Now().UTC(), true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetKata(ctx, connect.NewRequest(&pb.GetDailyKataRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInternal {
		t.Fatalf("expected Internal, got %v", err)
	}
}

func TestDailyServer_GetStreak_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	katas := mocks.NewMockKataRepo(ctrl)
	streaks := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2030, 6, 4, 12, 0, 0, 0, time.UTC)
	today := now.Truncate(24 * time.Hour)
	pass := true
	streaks.EXPECT().Get(gomock.Any(), uid).Return(domain.StreakState{CurrentStreak: 5, LongestStreak: 9, FreezeTokens: 1}, nil)
	katas.EXPECT().HistoryLast30(gomock.Any(), uid, today).Return([]domain.HistoryEntry{
		{Date: today, TaskID: uuid.New(), Passed: &pass},
	}, nil)

	srv := newTestDailyServer(t, nil, nil, katas, streaks, nil, now, true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetStreak(ctx, connect.NewRequest(&pb.GetStreakRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetCurrent() != 5 {
		t.Fatalf("got %+v", resp.Msg)
	}
	if resp.Msg.GetLongest() != 9 {
		t.Fatalf("longest mismatch: %d", resp.Msg.GetLongest())
	}
}

func TestDailyServer_GetStreak_NewUser(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	katas := mocks.NewMockKataRepo(ctrl)
	streaks := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2030, 6, 4, 12, 0, 0, 0, time.UTC)
	today := now.Truncate(24 * time.Hour)
	// Brand-new user: streak repo returns ErrNotFound, app must treat as zero.
	streaks.EXPECT().Get(gomock.Any(), uid).Return(domain.StreakState{}, domain.ErrNotFound)
	katas.EXPECT().HistoryLast30(gomock.Any(), uid, today).Return([]domain.HistoryEntry{}, nil)

	srv := newTestDailyServer(t, nil, nil, katas, streaks, nil, now, true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetStreak(ctx, connect.NewRequest(&pb.GetStreakRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetCurrent() != 0 {
		t.Fatalf("expected zero streak, got %d", resp.Msg.GetCurrent())
	}
	if got := resp.Msg.GetHistory(); len(got) != 0 {
		t.Fatalf("expected empty history, got %d", len(got))
	}
}

func TestDailyServer_SubmitKata_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv := newTestDailyServer(t, nil, nil, nil, nil, nil, time.Now().UTC(), true)
	_, err := srv.SubmitKata(context.Background(),
		connect.NewRequest(&pb.SubmitKataRequest{Code: "x", Language: pb.Language_LANGUAGE_GO}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}

func TestDailyServer_SubmitKata_EmptyCode_InvalidArgument(t *testing.T) {
	t.Parallel()
	srv := newTestDailyServer(t, nil, nil, nil, nil, nil, time.Now().UTC(), true)
	ctx := sharedMw.WithUserID(context.Background(), uuid.New())
	_, err := srv.SubmitKata(ctx,
		connect.NewRequest(&pb.SubmitKataRequest{Code: "", Language: pb.Language_LANGUAGE_GO}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestDailyServer_SubmitKata_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tasks := mocks.NewMockTaskRepo(ctrl)
	katas := mocks.NewMockKataRepo(ctrl)
	streaks := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2030, 6, 4, 12, 0, 0, 0, time.UTC) // Tuesday → not cursed
	today := now.Truncate(24 * time.Hour)
	katas.EXPECT().HistoryLast30(gomock.Any(), uid, today).Return([]domain.HistoryEntry{}, nil).Times(1)
	// SubmitKata now hydrates the task before calling Judge so the real
	// sandbox adapter can load test_cases by id; uuid.Nil is acceptable here
	// because the fakeJudge ignores the task field.
	tasks.EXPECT().GetByID(gomock.Any(), gomock.Any()).Return(sampleTask(), nil)
	katas.EXPECT().MarkSubmitted(gomock.Any(), uid, today, true).Return(nil)
	streaks.EXPECT().Get(gomock.Any(), uid).Return(domain.StreakState{}, nil)
	streaks.EXPECT().Update(gomock.Any(), uid, gomock.Any()).Return(nil)

	srv := newTestDailyServer(t, tasks, nil, katas, streaks, nil, now, true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.SubmitKata(ctx,
		connect.NewRequest(&pb.SubmitKataRequest{Code: "func main(){}", Language: pb.Language_LANGUAGE_GO}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if !resp.Msg.GetPassed() {
		t.Fatal("expected passed=true")
	}
	if resp.Msg.GetXpEarned() != int32(app.XPKataDaily) {
		t.Fatalf("xp mismatch: %d", resp.Msg.GetXpEarned())
	}
}

func TestDailyServer_SubmitKata_AlreadySubmitted(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	katas := mocks.NewMockKataRepo(ctrl)
	streaks := mocks.NewMockStreakRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2030, 6, 4, 12, 0, 0, 0, time.UTC)
	today := now.Truncate(24 * time.Hour)
	pass := true
	katas.EXPECT().HistoryLast30(gomock.Any(), uid, today).Return([]domain.HistoryEntry{
		{Date: today, TaskID: uuid.New(), Passed: &pass},
	}, nil)

	srv := newTestDailyServer(t, nil, nil, katas, streaks, nil, now, true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.SubmitKata(ctx,
		connect.NewRequest(&pb.SubmitKataRequest{Code: "x", Language: pb.Language_LANGUAGE_GO}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeAlreadyExists {
		t.Fatalf("expected AlreadyExists, got %v", err)
	}
}

func TestDailyServer_GetCalendar_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cal := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2030, 6, 4, 12, 0, 0, 0, time.UTC)
	today := now.Truncate(24 * time.Hour)
	cal.EXPECT().GetActive(gomock.Any(), uid, today).Return(domain.InterviewCalendar{
		ID:            uuid.New(),
		UserID:        uid,
		CompanyID:     uuid.New(),
		Role:          "be",
		InterviewDate: today.AddDate(0, 0, 14),
	}, nil)

	srv := newTestDailyServer(t, nil, nil, nil, nil, cal, now, true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetCalendar(ctx, connect.NewRequest(&pb.GetCalendarRequest{}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetRole() != "be" {
		t.Fatalf("got %+v", resp.Msg)
	}
}

func TestDailyServer_GetCalendar_NewUser_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	cal := mocks.NewMockCalendarRepo(ctrl)
	uid := uuid.New()
	now := time.Date(2030, 6, 4, 12, 0, 0, 0, time.UTC)
	today := now.Truncate(24 * time.Hour)
	cal.EXPECT().GetActive(gomock.Any(), uid, today).Return(domain.InterviewCalendar{}, domain.ErrNotFound)

	srv := newTestDailyServer(t, nil, nil, nil, nil, cal, now, true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetCalendar(ctx, connect.NewRequest(&pb.GetCalendarRequest{}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

// ── GetKataBySlug ─────────────────────────────────────────────────────────

func TestDailyServer_GetKataBySlug_Happy(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tasks := mocks.NewMockTaskRepo(ctrl)
	uid := uuid.New()
	task := sampleTask()
	tasks.EXPECT().GetBySlug(gomock.Any(), "two-sum").Return(task, nil)

	srv := newTestDailyServer(t, tasks, nil, nil, nil, nil, time.Now().UTC(), true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	resp, err := srv.GetKataBySlug(ctx, connect.NewRequest(&pb.GetKataBySlugRequest{Slug: "two-sum"}))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if resp.Msg.GetTask().GetSlug() != "two-sum" {
		t.Fatalf("got %+v", resp.Msg)
	}
	if resp.Msg.GetTask().GetTitle() != "Two Sum" {
		t.Fatalf("title mismatch: %s", resp.Msg.GetTask().GetTitle())
	}
}

func TestDailyServer_GetKataBySlug_NotFound(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	tasks := mocks.NewMockTaskRepo(ctrl)
	uid := uuid.New()
	tasks.EXPECT().GetBySlug(gomock.Any(), "no-such").Return(domain.TaskPublic{}, domain.ErrNotFound)

	srv := newTestDailyServer(t, tasks, nil, nil, nil, nil, time.Now().UTC(), true)
	ctx := sharedMw.WithUserID(context.Background(), uid)
	_, err := srv.GetKataBySlug(ctx, connect.NewRequest(&pb.GetKataBySlugRequest{Slug: "no-such"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeNotFound {
		t.Fatalf("expected NotFound, got %v", err)
	}
}

func TestDailyServer_GetKataBySlug_EmptySlug_InvalidArgument(t *testing.T) {
	t.Parallel()
	srv := newTestDailyServer(t, nil, nil, nil, nil, nil, time.Now().UTC(), true)
	ctx := sharedMw.WithUserID(context.Background(), uuid.New())
	_, err := srv.GetKataBySlug(ctx, connect.NewRequest(&pb.GetKataBySlugRequest{Slug: ""}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeInvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", err)
	}
}

func TestDailyServer_GetKataBySlug_Unauthenticated(t *testing.T) {
	t.Parallel()
	srv := newTestDailyServer(t, nil, nil, nil, nil, nil, time.Now().UTC(), true)
	_, err := srv.GetKataBySlug(context.Background(), connect.NewRequest(&pb.GetKataBySlugRequest{Slug: "two-sum"}))
	var ce *connect.Error
	if !errors.As(err, &ce) || ce.Code() != connect.CodeUnauthenticated {
		t.Fatalf("expected Unauthenticated, got %v", err)
	}
}
