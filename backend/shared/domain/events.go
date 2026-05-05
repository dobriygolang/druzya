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
// Progression
// ─────────────────────────────────────────────────────────────────────────

type XPGained struct {
	base
	UserID uuid.UUID `json:"user_id"`
	Amount int       `json:"amount"`
	// Reason — свободный label публишера (e.g. "podcast_completed",
	// "hone_task_done:algo"). Используется в логах + telemetry tags.
	Reason string `json:"reason"`
	// SourceID — UUID конкретного объекта-источника XP (task_id /
	// mock_session_id / etc.). nil если контекст неприменим. Сейчас
	// переживает только в логах OnXPGained — audit-log таблица xp_events
	// удалена в migration 00081 (Phase E2 RPG/arena cleanup).
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

// ─────────────────────────────────────────────────────────────────────────
// TaskBoard signals (v2)
// ─────────────────────────────────────────────────────────────────────────
//
// Hone TaskBoard listens to the bus to translate "user did a thing in the
// main project" into card movements.

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
