// log_resource.go — Phase 2 user_resource_log writes.
//
// Источник events для ResourceEngagementReader (Phase 1.7c). Coach UI
// шлёт события на каждый click / finish / skip / unhelpful / reflection.
//
// Reflection-flow:
//   - kind=reflection_submitted с reflection_text → UC опционально
//     создаёт hone_notes row через NoteCreator hook (caller-injected).
//     UC пишет attempt в user_resource_log с reflection_note_id если
//     создание Note прошло. Если упало — пишет без note_id; retry-job
//     закроет позже (TODO: вынести в отдельный UC).
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// ResourceLogRepo — write-side для user_resource_log (миграция 00055).
// Read-side — domain.ResourceEngagementReader (Phase 1.7c).
type ResourceLogRepo interface {
	Insert(ctx context.Context, in ResourceLogEntry) (ResourceLogEntry, error)
}

// ResourceLogEntry зеркалит row в user_resource_log.
type ResourceLogEntry struct {
	ID                uuid.UUID
	UserID            uuid.UUID
	ResourceURL       string
	AtlasNodeID       string // optional ("")
	Kind              string // clicked|finished|skipped|unhelpful|reflection_submitted
	ReflectionText    string
	ReflectionNoteID  *uuid.UUID
	OccurredAt        time.Time
}

// NoteCreator — optional hook для reflection-flow. Caller передаёт
// функцию которая создаёт hone_notes row из reflection-event и возвращает
// note_id. UC её не обязан звать (на client-side тоже может быть auto-
// create), но если задана — UC использует.
type NoteCreator func(ctx context.Context, userID uuid.UUID, atlasNodeID, reflection string) (uuid.UUID, error)

// LogResource — UC для записи user_resource_log event.
type LogResource struct {
	Repo        ResourceLogRepo
	NoteCreator NoteCreator
	Now         func() time.Time
}

// LogResourceInput.
type LogResourceInput struct {
	UserID         uuid.UUID
	ResourceURL    string
	AtlasNodeID    string // optional
	Kind           string
	ReflectionText string // ignored unless kind=="reflection_submitted"
}

// LogResourceResult.
type LogResourceResult struct {
	Entry             ResourceLogEntry
	ReflectionNoteID  *uuid.UUID
	NoteCreateFailed  bool
}

func (uc *LogResource) Do(ctx context.Context, in LogResourceInput) (LogResourceResult, error) {
	if !validResourceLogKind(in.Kind) {
		return LogResourceResult{}, fmt.Errorf("intelligence.LogResource: invalid kind %q", in.Kind)
	}
	if strings.TrimSpace(in.ResourceURL) == "" {
		return LogResourceResult{}, fmt.Errorf("intelligence.LogResource: empty resource_url")
	}
	if in.Kind == "reflection_submitted" && strings.TrimSpace(in.ReflectionText) == "" {
		return LogResourceResult{}, fmt.Errorf("intelligence.LogResource: reflection_submitted requires non-empty reflection_text")
	}

	entry := ResourceLogEntry{
		UserID:         in.UserID,
		ResourceURL:    in.ResourceURL,
		AtlasNodeID:    in.AtlasNodeID,
		Kind:           in.Kind,
		ReflectionText: in.ReflectionText,
		OccurredAt:     uc.now(),
	}

	res := LogResourceResult{}

	// Reflection-only: попытка создать Note. Если упало — entry всё
	// равно пишется; retry-job связывает позже.
	if in.Kind == "reflection_submitted" && uc.NoteCreator != nil {
		noteID, err := uc.NoteCreator(ctx, in.UserID, in.AtlasNodeID, in.ReflectionText)
		if err == nil {
			entry.ReflectionNoteID = &noteID
			res.ReflectionNoteID = &noteID
		} else {
			res.NoteCreateFailed = true
		}
	}

	saved, err := uc.Repo.Insert(ctx, entry)
	if err != nil {
		return LogResourceResult{}, fmt.Errorf("intelligence.LogResource insert: %w", err)
	}
	res.Entry = saved
	return res, nil
}

func (uc *LogResource) now() time.Time {
	if uc.Now != nil {
		return uc.Now()
	}
	return time.Now()
}

func validResourceLogKind(k string) bool {
	switch k {
	case "clicked", "finished", "skipped", "unhelpful", "reflection_submitted":
		return true
	}
	return false
}
