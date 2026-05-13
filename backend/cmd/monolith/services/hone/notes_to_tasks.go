// notes_to_tasks.go — wiring adapters для Phase K Wave 15 «suggest-tasks-
// from-notes» фичи. Два shim'а:
//
//  1. notesSuggestionRedisCache — per-user TTL cache над rediscache.
//     Сериализуется payload (suggestions + storedAt) в JSON, TTL = 1h
//     (см. honeApp.NotesSuggestionCacheTTL).
//  2. naiveNoteActionExtractor — fallback NoteActionExtractor для случая
//     когда LLM-chain не wired (dev / tests). Возвращает по одной
//     suggestion на excerpt с title=первая строка матча; в проде
//     заменяется LLM-backed реализацией из intelligence-агента (TBD —
//     отдельной волной, чтобы не блокировать UI shipping).
package hone

import (
	"context"
	"strings"
	"time"

	honeApp "druz9/hone/app"
	honeDomain "druz9/hone/domain"
	monolithServices "druz9/cmd/monolith/services"
	"druz9/shared/pkg/rediscache"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// notesSuggestionPayload — cached object: список + момент сохранения.
// CachedAt сериализуется RFC3339, чтобы фронт мог рендерить
// «обновлено N минут назад». zero value → cache miss treated as fresh.
type notesSuggestionPayload struct {
	Suggestions []honeDomain.TaskSuggestion `json:"suggestions"`
	StoredAt    time.Time                   `json:"stored_at"`
}

type notesSuggestionRedisCache struct {
	c *rediscache.Cache[notesSuggestionPayload]
}

// newNotesSuggestionCache constructs the cache when Redis is configured;
// nil-safe in callers (honeApp.SuggestionCache всё-таки interface'ом
// проверяется на != nil).
func newNotesSuggestionCache(rdb *redis.Client) honeApp.SuggestionCache {
	if rdb == nil {
		return nil
	}
	return &notesSuggestionRedisCache{
		c: rediscache.New[notesSuggestionPayload](rdb, honeApp.NotesSuggestionCacheTTL, "hone_notes_suggest"),
	}
}

func (a *notesSuggestionRedisCache) keyFor(userID uuid.UUID) string {
	return "hone:notes_suggest:" + userID.String()
}

func (a *notesSuggestionRedisCache) Get(ctx context.Context, userID uuid.UUID) ([]honeDomain.TaskSuggestion, time.Time, bool) {
	if a == nil || a.c == nil {
		return nil, time.Time{}, false
	}
	p, ok := a.c.Get(ctx, a.keyFor(userID))
	if !ok {
		return nil, time.Time{}, false
	}
	return p.Suggestions, p.StoredAt, true
}

func (a *notesSuggestionRedisCache) Set(ctx context.Context, userID uuid.UUID, suggestions []honeDomain.TaskSuggestion) {
	if a == nil || a.c == nil {
		return
	}
	_ = a.c.Set(ctx, a.keyFor(userID), notesSuggestionPayload{
		Suggestions: suggestions,
		StoredAt:    time.Now().UTC(),
	})
}

func (a *notesSuggestionRedisCache) Delete(ctx context.Context, userID uuid.UUID) {
	if a == nil || a.c == nil {
		return
	}
	_ = a.c.Delete(ctx, a.keyFor(userID))
}

// buildNoteActionExtractor returns LLM-extractor for SuggestTasksFromNotes.
// Phase K Wave 15 ship — naive deterministic extractor пока LLM-port
// в intelligence не подключён. Контракт чистый, заменим без затрагивания
// hone-app.
//
// Naive: per excerpt → одна suggestion с title = first matched line,
// excerpt = matched block. На проде LLM сворачивает 5 строк в одну
// короткую actionable фразу.
func buildNoteActionExtractor(_ monolithServices.Deps) honeApp.NoteActionExtractor {
	return &naiveNoteActionExtractor{}
}

type naiveNoteActionExtractor struct{}

func (e *naiveNoteActionExtractor) Extract(_ context.Context, batch honeApp.ExtractActionBatch) ([]honeApp.ExtractedAction, error) {
	out := make([]honeApp.ExtractedAction, 0, len(batch.Items))
	for _, item := range batch.Items {
		title := firstNonEmptyLine(item.Excerpt)
		if title == "" {
			continue
		}
		// Trim leading list markers / checkbox для чистого title.
		title = strings.TrimPrefix(title, "- [ ] ")
		title = strings.TrimPrefix(title, "- ")
		title = strings.TrimPrefix(title, "* ")
		title = strings.TrimSpace(title)
		if title == "" {
			continue
		}
		// Cap title length — таски лучше короткие.
		if len([]rune(title)) > 120 {
			runes := []rune(title)
			title = string(runes[:120]) + "…"
		}
		out = append(out, honeApp.ExtractedAction{
			Title:         title,
			SourceNoteID:  item.NoteID,
			SourceExcerpt: item.Excerpt,
		})
	}
	return out, nil
}

func firstNonEmptyLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		t := strings.TrimSpace(line)
		if t != "" {
			return t
		}
	}
	return ""
}
