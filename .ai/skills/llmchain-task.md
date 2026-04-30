---
name: llmchain-task
description: Wire a new LLM task into the druz9 llmchain — define the task, choose model class, write the prompt template, integrate caching, and respect the free-tier-only rule. Use when adding any new AI feature that calls an LLM.
---

# Подключить LLM-задачу

`backend/shared/pkg/llmchain/` — единый маршрутизатор. Все LLM-вызовы идут через него и используют **только бесплатные tier'ы**: Groq → Cerebras → Mistral → OpenRouter `:free` → Ollama.

## Когда применять

- Новая фича требует LLM-инференс (генерация плана, критика whiteboard, чат-стрим, embedding).
- Нужно изменить prompt существующей задачи (создаётся новая ревизия).

## Не применять

- Если уже есть похожая задача и достаточно расширить её prompt — обнови существующую.
- Если нужно просто кэшировать LLM-вызов — это `llmcache`, не `llmchain`.

## Жёсткие правила

- ❌ **Никаких платных провайдеров.** Anthropic / OpenAI / Cloudflare / SambaNova / Gemini напрямую — запрещены. Reason: free-tier маржинальность + стабильность fallback chain. См [docs/tech/conventions.md#llm-провайдеры](../../docs/tech/conventions.md#llm-провайдеры).
- **Каждая задача знает свой fallback chain.** Не вызывай провайдера напрямую — всегда через `llmchain.Run(ctx, task, input)`.

## Шаги

### 1. Определить класс задачи

Какие требования:

| Класс | Когда | Типичный fallback |
|---|---|---|
| **Streaming chat** | Cue/copilot ответы пользователю | Groq llama-70b → Cerebras → Mistral |
| **JSON-strict** | План дня, скоринг, классификация | Groq llama-70b в JSON-mode + 2 retries |
| **Critique / long-form** | Whiteboard критика, code review | Cerebras llama-70b → Groq |
| **Embedding** | Notes auto-links, RAG | Только Ollama bge-small (self-host) |
| **STT** | Транскрипция Cue | Groq whisper-large-v3-turbo |
| **Vision** | Скриншот в Cue | Mistral pixtral-12b |

### 2. Зарегистрировать Task

`backend/shared/pkg/llmchain/tasks.go` (или соседний файл по convention):

```go
const TaskHoneFocusReflection Task = "hone_focus_reflection"

var taskFocusReflection = TaskSpec{
    Class: ClassChatJSON,
    Models: []ModelChoice{
        {Provider: ProviderGroq, Model: "llama-3.3-70b-versatile", JSONMode: true},
        {Provider: ProviderCerebras, Model: "llama-3.3-70b"},
        {Provider: ProviderMistral, Model: "mistral-large-latest"},
    },
    MaxTokens:   400,
    Temperature: 0.3,
    Retries:     2, // для JSON-strict
}
```

### 3. Написать prompt template

`backend/services/<name>/infra/llm.go`:

```go
const focusReflectionPrompt = `You are a focus coach. The user just finished a 25-minute pomodoro session.

Task they pinned: {{.TaskTitle}}
Their reflection: {{.Reflection}}

Output JSON: {"key_insight": "...", "next_action": "...", "needs_atlas_update": bool}
Keep insight under 12 words. Avoid platitudes.`

func (l *LLMChainReflector) AnalyzeReflection(
    ctx context.Context, in domain.ReflectionInput,
) (*domain.ReflectionResult, error) {
    var result domain.ReflectionResult
    err := l.chain.RunJSON(ctx, llmchain.TaskHoneFocusReflection, llmchain.JSONInput{
        Template: focusReflectionPrompt,
        Vars:     in,
        Out:      &result,
    })
    if err != nil {
        return nil, fmt.Errorf("hone.AnalyzeReflection: %w", err)
    }
    return &result, nil
}
```

Правила prompt'а:
- **Краткий и конкретный.** «Output JSON with field X». Не оставляй модели свободу формата.
- **На английском.** Free-tier модели лучше работают.
- **Без user input в system prompt.** Если что-то приходит от юзера — обертывай в `<<<USER_INPUT>>>...<<</USER_INPUT>>>` для prompt-injection защиты.
- **Пример output'а** в prompt помогает консистентности.

### 4. Семантический кэш (опционально)

Если задача deterministic (один input → один output) и дорогая — оборачивай в `llmcache`:

```go
cached, hit, err := l.cache.GetOrCompute(ctx, llmcache.Key{
    Task:    string(llmchain.TaskHoneFocusReflection),
    Input:   in.HashKey(),
}, func() (any, error) {
    return l.realRun(ctx, in)
})
```

Для streaming или user-specific задач — кэш обычно не нужен.

### 5. Floor-адаптер для graceful degradation

В `infra/llm.go` рядом с реальной имплементацией:

```go
type NoLLMReflector struct{}

func (NoLLMReflector) AnalyzeReflection(
    ctx context.Context, _ domain.ReflectionInput,
) (*domain.ReflectionResult, error) {
    return nil, domain.ErrLLMUnavailable
}
```

Это позволяет `domain.ErrLLMUnavailable` смаппиться в `httperr.Unavailable` (503), вместо падения всего сервиса при отсутствии конфига LLM.

### 6. Wiring

`cmd/monolith/services/<name>.go`:

```go
var reflector domain.Reflector
if d.LLMChain != nil {
    reflector = infra.NewLLMChainReflector(d.LLMChain)
} else {
    reflector = infra.NoLLMReflector{}
}
uc := app.NewUsecases(repo, reflector)
```

### 7. Защитные слои

Все LLM-endpoint'ы обязаны:

```go
// В ports/server.go или middleware:
if err := s.killSwitch.Check(ctx, "copilot_analyze"); err != nil {
    return nil, httperr.Unavailable(err) // 503
}

if err := s.quota.Check(ctx, userID, estimatedTokens); err != nil {
    return nil, httperr.ResourceExhausted(err) // 429
}

// После вызова:
s.quota.Consume(ctx, userID, actualTokens)
```

См `shared/pkg/{killswitch,quota,ratelimit}`.

### 8. Тест

```go
func TestAnalyzeReflection_invalidJSON_returnsError(t *testing.T) {
    fake := &fakeLLM{response: "not json"}
    r := infra.NewLLMChainReflector(fake)
    _, err := r.AnalyzeReflection(ctx, validInput)
    require.ErrorContains(t, err, "json")
}
```

Модели не вызываем в unit-тестах — только fakes. Реальные provider-тесты — через httptest, в `provider_test.go`.

## Anti-patterns

- ❌ **Звать платный провайдер.** Anthropic SDK, OpenAI SDK — не в этом репо.
- ❌ **Прямой `http.Post` к Groq.** Только через `llmchain.Run`.
- ❌ **Class-mismatch.** Streaming chat в JSON-mode → плохо работает; vision на text-only → fail.
- ❌ **Забывать sanitization.** User-controlled input в prompt без delimiters → injection.
- ❌ **Игнорировать quota.** LLM-burn на одном злом юзере положит весь сервис.
- ❌ **Не маппить `ErrLLMUnavailable`.** Должен превратиться в 503, а не в 500.

## Related

- [.ai/skills/add-rpc.md](./add-rpc.md) — endpoint, который использует LLM-задачу
- [docs/tech/architecture.md#llm-стек](../../docs/tech/architecture.md#llm-стек)
- [docs/tech/conventions.md#llm-провайдеры](../../docs/tech/conventions.md#llm-провайдеры)
