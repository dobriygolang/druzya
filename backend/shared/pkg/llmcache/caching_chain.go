package llmcache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"

	"druz9/shared/pkg/llmchain"
)

// CachingChain — декоратор llmchain.ChatClient с semantic-cache поверху.
//
// Flow на Chat:
//  1. Построить cache-key text (= concat system+user, подробнее ниже).
//  2. Cache.Lookup(task, text) → HIT? Вернуть cached.
//     Lookup-ошибку ГЛОТАЕМ (логируем WARN) — не блокируем LLM-путь.
//  3. Chain.Chat(req) — реальный вызов.
//  4. При success: Cache.Store(task, text, resp) async. Store-ошибки
//     внутри пакета глотаются, метрика отражает.
//
// Flow на ChatStream: всегда прямой делегат. Streaming несовместим со
// snapshot-кешем (см. doc.go).
//
// Поля публичные намеренно — тесты подменяют Cache моком, а композиция
// во внешнем пакете (cmd/monolith/services) строится через плоский
// литерал без конструктора.
type CachingChain struct {
	Chain llmchain.ChatClient
	Cache Cache
	Log   *slog.Logger
}

// Chat — основной декорированный путь. См. file-level doc.
func (c *CachingChain) Chat(ctx context.Context, req llmchain.Request) (llmchain.Response, error) {
	// Cache работает только на Task-based dispatch. ModelOverride =
	// осознанный выбор юзера конкретной модели (часто paid-premium);
	// возвращать туда ответ от другой модели — нарушение контракта.
	if req.Task != "" && req.ModelOverride == "" {
		key := BuildCacheKey(req)
		if resp, hit, err := c.Cache.Lookup(ctx, req.Task, key); err != nil {
			c.logWarn("llmcache: lookup error, bypassing",
				slog.String("task", string(req.Task)),
				slog.Any("err", err))
		} else if hit {
			// Echo task в провайдере не потерян — в Response.Provider/Model
			// остаётся то значение, которое было при первичном ответе.
			return resp, nil
		}
	}

	resp, err := c.Chain.Chat(ctx, req)
	if err != nil {
		return resp, fmt.Errorf("llmcache.Chat: %w", err)
	}
	// Store только для кешируемых веток. Передаём в cache тот же key что
	// использовался для Lookup'а — иначе семантика "found by X, stored
	// as Y" становится ломанной при повторах.
	if req.Task != "" && req.ModelOverride == "" {
		key := BuildCacheKey(req)
		_ = c.Cache.Store(ctx, req.Task, key, resp)
	}
	return resp, nil
}

// ChatStream — всегда прямой проксик. См. doc.go про почему.
func (c *CachingChain) ChatStream(ctx context.Context, req llmchain.Request) (<-chan llmchain.StreamEvent, error) {
	ch, err := c.Chain.ChatStream(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("llmcache.ChatStream: %w", err)
	}
	return ch, nil
}

// BuildCacheKey формирует текст, по которому считается embedding.
//
// Идея: кешируем по содержанию запроса (system + user messages), а
// параметры температуры/max_tokens/JSONMode НЕ включаем. Почему:
//
//   - Temperature=0 и =0.7 для того же промпта дают разные-но-похожие
//     ответы. Семантически они взаимозаменяемы на наших кешируемых
//     тасках (VacanciesJSON — strict JSON, CodingHint — подсказка).
//   - MaxTokens влияет на длину выхода, но cache-hit с слегка другой
//     длиной — приемлемый trade-off; ложных HIT на совершенно разные
//     промпты threshold 0.92 и так не даёт.
//   - JSONMode тоже не включаем: юзеры всегда задают его одинаково
//     на один и тот же task.
//
// Images в контент не добавляем — кеширование vision-запросов не
// реализовано (они редки и нетипичны для кешируемых task'ов).
//
// Prefix sha256[:8] на каждую role — быстрая защита от случайного
// семантического совпадения system prompt'а двух разных тасок (хотя у
// нас каждый task имеет свой уникальный system prompt, формально
// коллизия возможна). Префикс делает embedding'и двух разных system
// prompt'ов гарантированно разными, даже если текст совпадает.
func BuildCacheKey(req llmchain.Request) string {
	var b strings.Builder
	for _, m := range req.Messages {
		if m.Content == "" {
			continue
		}
		sum := sha256.Sum256([]byte(m.Role))
		b.WriteString(hex.EncodeToString(sum[:4]))
		b.WriteString(":")
		b.WriteString(m.Content)
		b.WriteString("\n")
	}
	return b.String()
}

func (c *CachingChain) logWarn(msg string, args ...any) {
	if c.Log == nil {
		return
	}
	c.Log.Warn(msg, args...)
}

// Compile-time guard.
var _ llmchain.ChatClient = (*CachingChain)(nil)
