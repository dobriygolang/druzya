// Package domain содержит типизированные доменные события, публикуемые через EventBus.
// Домены не должны импортировать друг друга — общение идёт только через эти события.
package domain

import (
	"time"

	"druz9/shared/enums"

	"github.com/google/uuid"
)

// Event — маркерный интерфейс. Каждое событие обязано возвращать стабильное имя топика.
type Event interface {
	Topic() string
	OccurredAt() time.Time
}

type base struct {
	At time.Time `json:"at"`
}

func (b base) OccurredAt() time.Time { return b.At }

// ─────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────

type UserRegistered struct {
	base
	UserID   uuid.UUID          `json:"user_id"`
	Username string             `json:"username"`
	Provider enums.AuthProvider `json:"provider"`
}

func (UserRegistered) Topic() string { return "auth.UserRegistered" }

type UserLoggedIn struct {
	base
	UserID   uuid.UUID          `json:"user_id"`
	Provider enums.AuthProvider `json:"provider"`
}

func (UserLoggedIn) Topic() string { return "auth.UserLoggedIn" }

// TelegramChatLinked публикуется auth-сервисом когда пользователь успешно
// прошёл deep-link flow (`/start <code>` в боте → POST /auth/telegram/poll
// резолвит user). В payload'е есть ChatID, что позволяет notify-сервису
// атомарно записать telegram_chat_id в notification_preferences без
// cross-domain import'а.
//
// Это ЕДИНСТВЕННЫЙ легитимный путь привязки chat_id к user_id — он
// криптографически безопасен, потому что code однократный, expire'ится
// через 5 минут, создаётся на сайте в авторизованной сессии.
type TelegramChatLinked struct {
	base
	UserID uuid.UUID `json:"user_id"`
	ChatID int64     `json:"chat_id"`
}

func (TelegramChatLinked) Topic() string { return "auth.TelegramChatLinked" }

// ─────────────────────────────────────────────────────────────────────────
// Arena
// ─────────────────────────────────────────────────────────────────────────

type MatchStarted struct {
	base
	MatchID uuid.UUID     `json:"match_id"`
	Section enums.Section `json:"section"`
	Players []uuid.UUID   `json:"players"`
	TaskID  uuid.UUID     `json:"task_id"`
	TaskVer int           `json:"task_version"`
}

func (MatchStarted) Topic() string { return "arena.MatchStarted" }

type MatchCompleted struct {
	base
	MatchID    uuid.UUID         `json:"match_id"`
	Section    enums.Section     `json:"section"`
	WinnerID   uuid.UUID         `json:"winner_id"`
	LoserIDs   []uuid.UUID       `json:"loser_ids"`
	EloDeltas  map[uuid.UUID]int `json:"elo_deltas"`
	DurationMs int64             `json:"duration_ms"`
}

func (MatchCompleted) Topic() string { return "arena.MatchCompleted" }

type MatchCancelled struct {
	base
	MatchID uuid.UUID `json:"match_id"`
	Reason  string    `json:"reason"`
}

func (MatchCancelled) Topic() string { return "arena.MatchCancelled" }

type AnticheatSignalRaised struct {
	base
	UserID   uuid.UUID                 `json:"user_id"`
	MatchID  *uuid.UUID                `json:"match_id,omitempty"`
	Type     enums.AnticheatSignalType `json:"type"`
	Severity enums.SeverityLevel       `json:"severity"`
	Metadata map[string]any            `json:"metadata,omitempty"`
}

func (AnticheatSignalRaised) Topic() string { return "arena.AnticheatSignalRaised" }

// ─────────────────────────────────────────────────────────────────────────
// AI Mock
// ─────────────────────────────────────────────────────────────────────────

type MockSessionCreated struct {
	base
	SessionID uuid.UUID     `json:"session_id"`
	UserID    uuid.UUID     `json:"user_id"`
	Section   enums.Section `json:"section"`
	CompanyID uuid.UUID     `json:"company_id"`
}

func (MockSessionCreated) Topic() string { return "mock.SessionCreated" }

type MockSessionFinished struct {
	base
	SessionID    uuid.UUID     `json:"session_id"`
	UserID       uuid.UUID     `json:"user_id"`
	Section      enums.Section `json:"section"`
	CompanyID    uuid.UUID     `json:"company_id"`
	OverallScore int           `json:"overall_score"`
	Abandoned    bool          `json:"abandoned"`
}

func (MockSessionFinished) Topic() string { return "mock.SessionFinished" }

// MockReportReady — emitted by ai_mock ReportWorker AFTER the LLM grading
// finishes and ai_report jsonb is persisted. Carries the parsed
// overall_score + weaknesses list, so subscribers can react to bad scores
// (AI-tutor: trigger proactive assignment when overall_score<70).
type MockReportReady struct {
	base
	SessionID    uuid.UUID     `json:"session_id"`
	UserID       uuid.UUID     `json:"user_id"`
	Section      enums.Section `json:"section"`
	OverallScore int           `json:"overall_score"`
	Weaknesses   []string      `json:"weaknesses"`
}

func (MockReportReady) Topic() string { return "mock.ReportReady" }

// ─────────────────────────────────────────────────────────────────────────
// AI Native Round
// ─────────────────────────────────────────────────────────────────────────

type NativeRoundFinished struct {
	base
	SessionID uuid.UUID     `json:"session_id"`
	UserID    uuid.UUID     `json:"user_id"`
	Section   enums.Section `json:"section"`
	Scores    struct {
		Context      int `json:"context"`
		Verification int `json:"verification"`
		Judgment     int `json:"judgment"`
		Delivery     int `json:"delivery"`
	} `json:"scores"`
}

func (NativeRoundFinished) Topic() string { return "native.RoundFinished" }

// ─────────────────────────────────────────────────────────────────────────
// Daily
// ─────────────────────────────────────────────────────────────────────────

type DailyKataCompleted struct {
	base
	UserID    uuid.UUID `json:"user_id"`
	TaskID    uuid.UUID `json:"task_id"`
	StreakNew int       `json:"streak_new"`
	XPEarned  int       `json:"xp_earned"`
	IsCursed  bool      `json:"is_cursed"`
}

func (DailyKataCompleted) Topic() string { return "daily.KataCompleted" }

type DailyKataMissed struct {
	base
	UserID     uuid.UUID `json:"user_id"`
	StreakLost int       `json:"streak_lost"`
	FreezeUsed bool      `json:"freeze_used"`
}

func (DailyKataMissed) Topic() string { return "daily.KataMissed" }

// ─────────────────────────────────────────────────────────────────────────
// Rating / Progression
// ─────────────────────────────────────────────────────────────────────────

type RatingChanged struct {
	base
	UserID  uuid.UUID     `json:"user_id"`
	Section enums.Section `json:"section"`
	EloOld  int           `json:"elo_old"`
	EloNew  int           `json:"elo_new"`
	Source  string        `json:"source"` // "arena" | "mock" | "kata"
	MatchID *uuid.UUID    `json:"match_id,omitempty"`
}

func (RatingChanged) Topic() string { return "rating.Changed" }

type XPGained struct {
	base
	UserID uuid.UUID `json:"user_id"`
	Amount int       `json:"amount"`
	// Reason — свободный label публишера (e.g. "podcast_completed",
	// "hone_task_done:algo"). Используется в логах + xp_events.source
	// маппинге через FirstReasonToken.
	Reason string `json:"reason"`
	// SourceID — Phase H audit. UUID конкретного объекта (match_id /
	// task_id / kata_id / mock_session_id / etc.). nil если контекст
	// неприменим (например podcast progress — episode не uuid'нутый).
	SourceID *uuid.UUID `json:"source_id,omitempty"`
}

func (XPGained) Topic() string { return "progress.XPGained" }

type LevelUp struct {
	base
	UserID   uuid.UUID `json:"user_id"`
	LevelOld int       `json:"level_old"`
	LevelNew int       `json:"level_new"`
}

func (LevelUp) Topic() string { return "progress.LevelUp" }

type SkillNodeUnlocked struct {
	base
	UserID  uuid.UUID     `json:"user_id"`
	NodeKey string        `json:"node_key"`
	Section enums.Section `json:"section"`
}

func (SkillNodeUnlocked) Topic() string { return "progress.SkillNodeUnlocked" }

type SkillDecayed struct {
	base
	UserID       uuid.UUID `json:"user_id"`
	NodeKey      string    `json:"node_key"`
	DaysInactive int       `json:"days_inactive"`
}

func (SkillDecayed) Topic() string { return "progress.SkillDecayed" }

// ─────────────────────────────────────────────────────────────────────────
// Cohort — removed in Phase-4 ADR-001 Wave 2 (cohort feature merged into
// circles). CohortWarStarted/CohortWarFinished events deleted along with
// the cohort service.
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// Slot / Human Mock
// ─────────────────────────────────────────────────────────────────────────

type SlotBooked struct {
	base
	SlotID        uuid.UUID `json:"slot_id"`
	InterviewerID uuid.UUID `json:"interviewer_id"`
	CandidateID   uuid.UUID `json:"candidate_id"`
	StartsAt      time.Time `json:"starts_at"`
}

func (SlotBooked) Topic() string { return "slot.Booked" }

type SlotCancelled struct {
	base
	SlotID uuid.UUID `json:"slot_id"`
	ByUser uuid.UUID `json:"by_user"`
}

func (SlotCancelled) Topic() string { return "slot.Cancelled" }

// ─────────────────────────────────────────────────────────────────────────
// Subscription
// ─────────────────────────────────────────────────────────────────────────

type SubscriptionActivated struct {
	base
	UserID uuid.UUID              `json:"user_id"`
	Plan   enums.SubscriptionPlan `json:"plan"`
	Until  time.Time              `json:"until"`
}

func (SubscriptionActivated) Topic() string { return "billing.SubscriptionActivated" }

type SubscriptionExpired struct {
	base
	UserID uuid.UUID `json:"user_id"`
}

func (SubscriptionExpired) Topic() string { return "billing.SubscriptionExpired" }

// ─────────────────────────────────────────────────────────────────────────
// Season
// ─────────────────────────────────────────────────────────────────────────

type SeasonPointsEarned struct {
	base
	UserID   uuid.UUID `json:"user_id"`
	SeasonID uuid.UUID `json:"season_id"`
	Points   int       `json:"points"`
	Source   string    `json:"source"`
}

func (SeasonPointsEarned) Topic() string { return "season.PointsEarned" }

// ─────────────────────────────────────────────────────────────────────────
// Events (calendar)
// ─────────────────────────────────────────────────────────────────────────

// EventStartingSoon publishes when an event is about to start. Emitted by
// the events.StartingSoonNotifier scheduler and consumed by the notify
// service to fan out telegram / web-push notifications. Idempotency is
// owned by the publisher (event_notification_sent ledger), so subscribers
// can assume at-most-once delivery per (event_id, user_id).
type EventStartingSoon struct {
	base
	EventID  uuid.UUID `json:"event_id"`
	UserID   uuid.UUID `json:"user_id"`
	CircleID uuid.UUID `json:"circle_id"`
	Title    string    `json:"title"`
	StartsAt time.Time `json:"starts_at"`
}

func (EventStartingSoon) Topic() string { return "events.StartingSoon" }

// ─────────────────────────────────────────────────────────────────────────
// TaskBoard signals (v2)
// ─────────────────────────────────────────────────────────────────────────
//
// Hone TaskBoard listens to the bus to translate "user did a thing in the
// main project" into card movements. These four events are the new feeds
// (existing events.MatchCompleted / DailyKataCompleted / SkillDecayed
// already cover their cases — see hone/app/coach_listener.go).

// CodexArticleRead publishes when a user opens a codex article and reads
// it past the "fully scrolled / N seconds visible" threshold. Hone uses
// it to mark a `kind=reading` task done.
type CodexArticleRead struct {
	base
	UserID    uuid.UUID `json:"user_id"`
	ArticleID uuid.UUID `json:"article_id"`
	Slug      string    `json:"slug"`
	ReadMin   int       `json:"read_min"`
}

func (CodexArticleRead) Topic() string { return "codex.ArticleRead" }

// MockPipelineFinished publishes when a mock-interview pipeline (full
// session, not a single mock_session) finishes. Hone uses it to settle
// `kind=sysdesign` / `kind=reflection` tasks based on the outcome.
type MockPipelineFinished struct {
	base
	UserID     uuid.UUID `json:"user_id"`
	PipelineID uuid.UUID `json:"pipeline_id"`
	Section    string    `json:"section"`
	Score      int       `json:"score"` // 0..100
	Passed     bool      `json:"passed"`
}

func (MockPipelineFinished) Topic() string { return "mock.PipelineFinished" }

// QuizSessionCompleted publishes when /quiz finishes scoring a session.
// Drives `kind=quiz` task settlement.
type QuizSessionCompleted struct {
	base
	UserID    uuid.UUID `json:"user_id"`
	SessionID uuid.UUID `json:"session_id"`
	Source    string    `json:"source"` // 'codex' | 'mock_interview' | 'mixed'
	Total     int       `json:"total"`
	Correct   int       `json:"correct"`
}

func (QuizSessionCompleted) Topic() string { return "quiz.SessionCompleted" }

// CopilotAnalysisCompleted publishes when copilot finishes producing a
// session report. Hone uses it as a softer "user worked through their
// notes" signal (no specific task settle, but feeds coach memory).
type CopilotAnalysisCompleted struct {
	base
	UserID       uuid.UUID `json:"user_id"`
	SessionID    uuid.UUID `json:"session_id"`
	OverallScore int       `json:"overall_score"`
}

func (CopilotAnalysisCompleted) Topic() string { return "copilot.AnalysisCompleted" }

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// Now возвращает base с текущей меткой времени. Встраивается в конструктор каждого события.
func Now() base { return base{At: time.Now().UTC()} }
