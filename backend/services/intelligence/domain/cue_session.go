//go:generate mockgen -package mocks -destination mocks/cue_session_mock.go -source cue_session.go
// cue_session.go — F10 Cue session ingestion domain types.
//
// Coarse-grained sibling EpisodeCueConversationMemory: одна запись на
// whole Cue interview session (company, persona, per-stage ratings,
// ai_summary, optional raw_transcript). Read-side: paginated list для
// web /coach surface. Write-side: IngestSessionTranscript UC also writes
// a coach_episodes row (kind=cue_session) для DailyBrief/Recall.
package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// InterviewStage — one entry в session stages JSONB array.
type InterviewStage struct {
	Stage      string `json:"stage"`       // 'hr'|'algo'|'sysdesign'|'coding'|'behavioral'|'other'
	SelfRating int    `json:"self_rating"` // 1..5, 0 = unrated
	Notes      string `json:"notes"`
}

// InterviewSession mirrors cue_sessions row.
type InterviewSession struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	Company       string
	Persona       string
	Stages        []InterviewStage
	AISummary     string
	RawTranscript string
	CompletedAt   time.Time
}

// InterviewSessionRepo — read + write для cue_sessions.
//
// Insert ставит ID/CompletedAt если zero. ListByUser paginated с total для
// «Page X of Y» rendering. Default limit = 20, hard cap = 100.
type InterviewSessionRepo interface {
	Insert(ctx context.Context, in InterviewSession) (InterviewSession, error)
	ListByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]InterviewSession, int, error)
}
