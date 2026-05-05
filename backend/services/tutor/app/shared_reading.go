package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// PushSharedReading — wraps BroadcastAssignment + persist history row в
// tutor_shared_materials. UI'у тутора нужен список прошлых recommendations
// (не per-student, а как один объект). После broadcast'а student_count
// = количество успешных push'ов.
type PushSharedReading struct {
	Materials domain.SharedMaterialRepo
	Broadcast *BroadcastAssignment
	Now       func() time.Time
}

type PushSharedReadingInput struct {
	TutorID   uuid.UUID
	Title     string
	SourceURL string
	Note      string // optional, попадает в body_md assignment'а
}

type PushSharedReadingResult struct {
	Material      domain.SharedMaterial
	PushedCount   int
	FailedCount   int
}

const sharedReadingTitlePrefix = "[Reading] "

func (uc *PushSharedReading) Do(ctx context.Context, in PushSharedReadingInput) (PushSharedReadingResult, error) {
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return PushSharedReadingResult{}, fmt.Errorf("tutor.PushSharedReading: title required: %w", domain.ErrInvalidInput)
	}
	if uc.Broadcast == nil {
		return PushSharedReadingResult{}, fmt.Errorf("tutor.PushSharedReading: broadcast not wired")
	}
	url := strings.TrimSpace(in.SourceURL)
	note := strings.TrimSpace(in.Note)

	body := buildReadingBody(url, note)
	br, err := uc.Broadcast.Do(ctx, BroadcastAssignmentInput{
		TutorID: in.TutorID,
		Title:   sharedReadingTitlePrefix + title,
		BodyMD:  body,
	})
	if err != nil {
		return PushSharedReadingResult{}, fmt.Errorf("tutor.PushSharedReading: broadcast: %w", err)
	}

	m := domain.SharedMaterial{
		TutorID:      in.TutorID,
		Title:        title,
		SourceURL:    url,
		BodyMD:       note,
		StudentCount: len(br.Pushed),
	}
	if uc.Materials != nil {
		saved, mErr := uc.Materials.CreateSharedMaterial(ctx, m)
		if mErr != nil {
			// История — secondary; broadcast уже успешен. Логируем
			// проблему наверх вызывающему, но не валим — student'ы получат
			// recommendations.
			return PushSharedReadingResult{
				Material:    m,
				PushedCount: len(br.Pushed),
				FailedCount: len(br.Failed),
			}, fmt.Errorf("tutor.PushSharedReading: persist history: %w", mErr)
		}
		m = saved
	}
	return PushSharedReadingResult{
		Material:    m,
		PushedCount: len(br.Pushed),
		FailedCount: len(br.Failed),
	}, nil
}

func buildReadingBody(url, note string) string {
	parts := make([]string, 0, 2)
	if url != "" {
		parts = append(parts, "["+url+"]("+url+")")
	}
	if note != "" {
		parts = append(parts, note)
	}
	if len(parts) == 0 {
		return "Recommended reading"
	}
	return strings.Join(parts, "\n\n")
}

// ListSharedReading — read-side для Reading library tab.
type ListSharedReading struct {
	Materials domain.SharedMaterialRepo
}

// ListSharedReadingOutput — items + opaque next cursor (empty = end).
type ListSharedReadingOutput struct {
	Items      []domain.SharedMaterial
	NextCursor string
}

func (uc *ListSharedReading) Do(ctx context.Context, tutorID uuid.UUID, limit int, cursor string) (ListSharedReadingOutput, error) {
	if uc.Materials == nil {
		return ListSharedReadingOutput{}, nil
	}
	out, next, err := uc.Materials.ListSharedMaterialsByTutorPaged(ctx, tutorID, limit, cursor)
	if err != nil {
		return ListSharedReadingOutput{}, fmt.Errorf("tutor.ListSharedReading: %w", err)
	}
	return ListSharedReadingOutput{Items: out, NextCursor: next}, nil
}
