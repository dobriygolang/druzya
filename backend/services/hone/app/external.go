package app

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// AddExternalActivity — главный use case. Validate → INSERT → fire-and-forget
// в coach_episodes (для intelligence recall). Atlas-progress bump'а пока нет —
// у нас нет user_atlas_nodes таблицы; добавится отдельной волной.
type AddExternalActivity struct {
	Repo            domain.ExternalActivityRepo
	CoachAppender   domain.CoachEpisodeAppender // optional, nil-safe
	Now             func() time.Time
	Log             *slog.Logger
}

type AddExternalActivityInput struct {
	UserID           uuid.UUID
	Source           string
	TopicAtlasNodeID string
	TopicFreeText    string
	DurationMin      int
	Notes            string
	OccurredAt       time.Time // zero → uc.Now()
}

func (uc *AddExternalActivity) Do(ctx context.Context, in AddExternalActivityInput) (domain.ExternalActivity, error) {
	src := domain.ExternalActivitySource(strings.ToLower(strings.TrimSpace(in.Source)))
	if !src.IsValid() {
		return domain.ExternalActivity{}, fmt.Errorf("hone.AddExternalActivity: source: %w", domain.ErrInvalidInput)
	}
	if in.DurationMin <= 0 || in.DurationMin > 600 {
		return domain.ExternalActivity{}, fmt.Errorf("hone.AddExternalActivity: duration: %w", domain.ErrInvalidInput)
	}
	topicFree := strings.TrimSpace(in.TopicFreeText)
	topicAtlas := strings.TrimSpace(in.TopicAtlasNodeID)
	if topicAtlas == "" && topicFree == "" {
		return domain.ExternalActivity{}, fmt.Errorf("hone.AddExternalActivity: topic required: %w", domain.ErrInvalidInput)
	}
	occurred := in.OccurredAt
	if occurred.IsZero() {
		occurred = nowOr(uc.Now)
	}
	a, err := uc.Repo.Insert(ctx, domain.ExternalActivity{
		UserID:           in.UserID,
		Source:           src,
		TopicAtlasNodeID: topicAtlas,
		TopicFreeText:    topicFree,
		DurationMin:      in.DurationMin,
		Notes:            strings.TrimSpace(in.Notes),
		OccurredAt:       occurred,
	})
	if err != nil {
		return domain.ExternalActivity{}, fmt.Errorf("hone.AddExternalActivity: %w", err)
	}
	if uc.CoachAppender != nil {
		topic := topicFree
		if topic == "" {
			topic = topicAtlas
		}
		summary := fmt.Sprintf("Внешнее обучение: %s · %s · %d мин", string(src), topic, a.DurationMin)
		payload := map[string]any{
			"source":          string(src),
			"topic_atlas_id":  topicAtlas,
			"topic_free_text": topicFree,
			"duration_min":    a.DurationMin,
			"notes":           a.Notes,
		}
		if cerr := uc.CoachAppender.AppendExternalActivity(ctx, in.UserID, summary, payload, occurred); cerr != nil && uc.Log != nil {
			uc.Log.Warn("hone.AddExternalActivity: coach episode append failed",
				slog.String("err", cerr.Error()),
				slog.String("user_id", in.UserID.String()),
			)
		}
	}
	return a, nil
}

// ListExternalActivity — read-side для Stats страницы.
type ListExternalActivity struct {
	Repo domain.ExternalActivityRepo
}

type ListExternalActivityInput struct {
	UserID uuid.UUID
	Source string
	Limit  int
	Cursor string
}

// ListExternalActivityOutput — items + opaque next cursor (empty = end).
type ListExternalActivityOutput struct {
	Items      []domain.ExternalActivity
	NextCursor string
}

func (uc *ListExternalActivity) Do(ctx context.Context, in ListExternalActivityInput) (ListExternalActivityOutput, error) {
	items, next, err := uc.Repo.ListPaged(ctx, in.UserID, in.Source, in.Limit, in.Cursor)
	if err != nil {
		return ListExternalActivityOutput{}, fmt.Errorf("hone.ListExternalActivity: %w", err)
	}
	return ListExternalActivityOutput{Items: items, NextCursor: next}, nil
}

// DeleteExternalActivity — удаление одной записи (например, опечатка).
type DeleteExternalActivity struct {
	Repo domain.ExternalActivityRepo
}

func (uc *DeleteExternalActivity) Do(ctx context.Context, userID, id uuid.UUID) error {
	if err := uc.Repo.Delete(ctx, userID, id); err != nil {
		return fmt.Errorf("hone.DeleteExternalActivity: %w", err)
	}
	return nil
}

// SearchAtlasTopics — autocomplete для topic-поля в form'е.
type SearchAtlasTopics struct {
	Searcher domain.AtlasTopicSearcher
}

func (uc *SearchAtlasTopics) Do(ctx context.Context, prefix string, limit int) ([]domain.AtlasTopicSuggestion, error) {
	items, err := uc.Searcher.SearchByPrefix(ctx, prefix, limit)
	if err != nil {
		return nil, fmt.Errorf("hone.SearchAtlasTopics: %w", err)
	}
	return items, nil
}

// ListAtlasNodeTracks — bulk lookup для client-side filter'а Plan/Tasks/Queue.
type ListAtlasNodeTracks struct {
	Reader domain.AtlasNodeTracksReader
}

func (uc *ListAtlasNodeTracks) Do(ctx context.Context) ([]domain.AtlasNodeTrack, error) {
	items, err := uc.Reader.ListAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("hone.ListAtlasNodeTracks: %w", err)
	}
	return items, nil
}
