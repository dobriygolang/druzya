package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// ExternalActivitySource — closed set, валидируется в use case.
// Wire-формат — string (см proto), но domain держит enum для безопасности.
type ExternalActivitySource string

const (
	SrcLeetCode   ExternalActivitySource = "leetcode"
	SrcCoursera   ExternalActivitySource = "coursera"
	SrcHackerRank ExternalActivitySource = "hackerrank"
	SrcYouTube    ExternalActivitySource = "youtube"
	SrcBook       ExternalActivitySource = "book"
	SrcArticle    ExternalActivitySource = "article"
	SrcCourse     ExternalActivitySource = "course"
	SrcOther      ExternalActivitySource = "other"
)

func (s ExternalActivitySource) IsValid() bool {
	switch s {
	case SrcLeetCode, SrcCoursera, SrcHackerRank, SrcYouTube,
		SrcBook, SrcArticle, SrcCourse, SrcOther:
		return true
	}
	return false
}

// ExternalActivity — одна запись внешнего обучения.
type ExternalActivity struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	Source            ExternalActivitySource
	TopicAtlasNodeID  string // empty when free-form
	TopicFreeText     string
	DurationMin       int
	Notes             string
	OccurredAt        time.Time
	CreatedAt         time.Time
}

type ExternalActivityRepo interface {
	Insert(ctx context.Context, a ExternalActivity) (ExternalActivity, error)
	List(ctx context.Context, userID uuid.UUID, source string, limit int) ([]ExternalActivity, error)
	// ListPaged — keyset cursor variant. Sort: occurred_at DESC, id DESC.
	ListPaged(ctx context.Context, userID uuid.UUID, source string, limit int, cursor string) ([]ExternalActivity, string, error)
	Delete(ctx context.Context, userID, id uuid.UUID) error
}

// AtlasTopicSuggestion — ответ autocomplete'а для topic-поля.
type AtlasTopicSuggestion struct {
	AtlasNodeID string
	Title       string
	Section     string
}

// AtlasTopicSearcher — для autocomplete topic'а в form'е external-activity.
type AtlasTopicSearcher interface {
	SearchByPrefix(ctx context.Context, prefix string, limit int) ([]AtlasTopicSuggestion, error)
}

// AtlasNodeTrack — strip-down строка для client-side filter'а Plan/Tasks
// по active_track (mode='dev'/'ml'/'english'/...). Только id + track_kind.
type AtlasNodeTrack struct {
	AtlasNodeID string
	TrackKind   string
}

// AtlasNodeTracksReader — bulk fetch таблицы (id, track_kind) atlas-узлов.
// Hone frontend использует эту map для filter'а Plan items / Queue / Tasks
// по skill_key.
type AtlasNodeTracksReader interface {
	ListAll(ctx context.Context) ([]AtlasNodeTrack, error)
}

// CoachEpisodeAppender — silent-side hook: каждая external_activity записана
// в coach_episodes (kind='external_activity') чтобы intelligence/AI-tutor
// recall видел эту активность как часть истории. Adapter живёт в monolith
// wiring (cross-domain, hone не импортирует intelligence).
type CoachEpisodeAppender interface {
	AppendExternalActivity(ctx context.Context, userID uuid.UUID, summary string, payload map[string]any, occurredAt time.Time) error
}
