// notes_to_tasks.go — wiring adapters для Phase K Wave 15/16 «suggest-tasks-
// from-notes» фичи. Два shim'а:
//
//  1. notesSuggestionRedisCache — per-user TTL cache над rediscache.
//     Сериализуется payload (suggestions + storedAt) в JSON, TTL = 1h
//     (см. honeApp.NotesSuggestionCacheTTL).
//  2. buildNoteActionExtractor — выбирает между LLM-backed реализацией
//     (Phase K Wave 16) и floor NoNoteActionExtractor когда llmchain
//     не сконфигурён. Naive deterministic shim (per-excerpt → одна
//     suggestion с title = first matched line) удалён вместе с Wave 15
//     shipping — в проде LLM либо есть, либо panel тихо пуст.
package hone

import (
	"context"
	"time"

	honeApp "druz9/hone/app"
	honeDomain "druz9/hone/domain"
	monolithServices "druz9/cmd/monolith/services"
	honeInfra "druz9/hone/infra"
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
// Phase K Wave 16: LLM-backed реализация (TaskHoneNoteActionExtract, 8B-class).
// Floor — NoNoteActionExtractor: panel рендерит пустой list, БЕЗ 503
// (soft feature: лучше тихо скрыть suggestions чем показать ошибку).
func buildNoteActionExtractor(d monolithServices.Deps) honeApp.NoteActionExtractor {
	if d.LLMChain == nil {
		return honeInfra.NewNoNoteActionExtractor()
	}
	return honeInfra.NewLLMChainNoteActionExtractor(d.LLMChain, d.Log)
}
