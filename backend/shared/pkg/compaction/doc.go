// Package compaction — sliding window + background summarizer для LLM-сессий.
//
// Motivation:
//
// copilot/ai_mock ведут многоходовые диалоги (30-50+ turns на
// длинных сессиях). Классическая схема "шлём всю историю в LLM
// каждый turn" O(n) по токенам → стоимость и латентность растут
// квадратично, а free-tier провайдеры отказывают при > ~8k контекста.
//
// Решение — sliding window с running_summary:
//
//   - system_prompt + running_summary(если есть) + last_N_turns
//   - Когда turns > threshold, background-worker вызывает LLM
//     (TaskSummarize, самая дешёвая модель — Qwen 3B на Ollama
//     floor либо Groq 8B) и записывает новый running_summary.
//   - На hot-path никакого блокирования: если суммаризация не
//     успела — шлём full history (graceful degrade).
//
// Design principles:
//
//   - Pure sliding-window логика — BuildWindow чисто, без IO и
//     без goroutines. Легко покрывается table-driven тестами.
//
//   - Bounded worker pool. Буфер канала 64/128, overflow →
//     drop-oldest с метрикой (см. llmcache/caching_chain.go как
//     образец). Unbounded go f() — запрещено политикой.
//
//   - Graceful degrade. Ошибка LLM → лог + метрика, не шлём
//     ErrCompactionFailed наверх. На следующем turn попробуем
//     ещё раз.
//
//   - Чистый контракт через SummaryStore: пакет не знает о
//     конкретных таблицах (copilot_conversations / mock_sessions) —
//     каждый сервис реализует Store со своей типизацией ID.
package compaction
