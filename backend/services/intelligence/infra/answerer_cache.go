// Package infra — 5-минутный Redis cache декоратор для AskNotes
// LLM-ответа поверх domain.NoteAnswerer.
//
// Зачем: на free-tier юзеры часто спамят одним и тем же вопросом подряд
// (особенно когда ответ медленно стримится и они переключают вкладки).
// Каждый такой запрос — full LLM call (~600 tokens output × $0.15/M на
// gpt-4o-mini ~ копеечно, но при 100k DAU суммарно $30/день только на
// дубликаты). 5min TTL ловит human-scale repetition без риска отдать
// stale ответ если user обновил notes (на 5min разрыв допустим — в
// худшем случае user ещё раз через 5min спросит и получит свежее).
//
// Cache miss / Redis down = transparent fallthrough к делегату,
// ошибки кеша логируются warn'ом без падения юзер-запроса.
package infra

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/intelligence/domain"
)

// askNotesCacheKeyVersion — bump'аем при изменении формата сериализации
// или семантики prompt'а (новый системный промпт → старые ответы устарели).
const askNotesCacheKeyVersion = "v1"

// DefaultAskNotesCacheTTL — 5 минут. Достаточно чтобы поймать human-scale
// repetition (юзер задал тот же вопрос ещё раз после рефреша вкладки),
// но не настолько долго, чтобы stale-ответ стал проблемой при обновлении
// notes.
const DefaultAskNotesCacheTTL = 5 * time.Minute

// CachedNoteAnswerer wraps a domain.NoteAnswerer with a Redis cache keyed
// on the assembled prompt input. Returns the same answer for identical
// inputs within TTL.
type CachedNoteAnswerer struct {
	delegate domain.NoteAnswerer
	kv       BriefKV
	ttl      time.Duration
	log      *slog.Logger
}

// NewCachedNoteAnswerer wraps delegate. delegate / kv / log MUST be non-nil.
// ttl == 0 → DefaultAskNotesCacheTTL.
func NewCachedNoteAnswerer(delegate domain.NoteAnswerer, kv BriefKV, ttl time.Duration, log *slog.Logger) *CachedNoteAnswerer {
	if delegate == nil {
		panic("intelligence.NewCachedNoteAnswerer: delegate is required")
	}
	if kv == nil {
		panic("intelligence.NewCachedNoteAnswerer: kv is required")
	}
	if log == nil {
		panic("intelligence.NewCachedNoteAnswerer: logger is required")
	}
	if ttl <= 0 {
		ttl = DefaultAskNotesCacheTTL
	}
	return &CachedNoteAnswerer{delegate: delegate, kv: kv, ttl: ttl, log: log}
}

// Answer — cache-aware. Хэш включает question + fingerprint всех нот в
// контексте + past episodes timestamps. Это даёт корректный invalidation:
// если user обновил какую-то ноту → её embedding изменился → её ID мог
// выпасть из top-K → fingerprint меняется → cache miss.
func (c *CachedNoteAnswerer) Answer(ctx context.Context, in domain.AskNotesPromptInput) (string, error) {
	key := c.buildKey(in)

	if cached, err := c.kv.Get(ctx, key); err == nil {
		return cached, nil
	} else if !errors.Is(err, ErrBriefCacheMiss) {
		c.log.Warn("intelligence.CachedNoteAnswerer: cache get error",
			slog.Any("err", err), slog.String("key", key))
	}

	ans, err := c.delegate.Answer(ctx, in)
	if err != nil {
		return "", fmt.Errorf("intelligence.CachedNoteAnswerer.Answer: %w", err)
	}
	if ans == "" {
		return ans, nil
	}
	if setErr := c.kv.Set(ctx, key, []byte(ans), c.ttl); setErr != nil {
		c.log.Warn("intelligence.CachedNoteAnswerer: cache set error",
			slog.Any("err", setErr), slog.String("key", key))
	}
	return ans, nil
}

func (c *CachedNoteAnswerer) buildKey(in domain.AskNotesPromptInput) string {
	var b strings.Builder
	b.WriteString(strings.ToLower(strings.TrimSpace(in.Question)))
	b.WriteByte('|')
	for _, n := range in.ContextNotes {
		b.WriteString(n.NoteID.String())
		b.WriteByte(':')
	}
	b.WriteByte('|')
	for _, e := range in.PastEpisodes {
		b.WriteString(e.ID.String())
		b.WriteByte(':')
		b.WriteString(e.OccurredAt.Format(time.RFC3339Nano))
		b.WriteByte(';')
	}
	sum := sha256.Sum256([]byte(b.String()))
	return fmt.Sprintf("intel:asknotes:%s:%s", askNotesCacheKeyVersion, hex.EncodeToString(sum[:]))
}

var _ domain.NoteAnswerer = (*CachedNoteAnswerer)(nil)
