// Package llmcache — semantic-cache слой поверх llmchain.
//
// Motivation (зачем пакет существует):
//
// Free-tier cloud провайдеры (Groq/Cerebras/Mistral/OpenRouter :free)
// имеют жёсткие суточные квоты; один активный пользователь на типичной
// сессии mock-интервью выжигает ~200 LLM-вызовов. При этом значительная
// доля запросов — повторы того же (или почти того же) промпта: одна и
// та же вакансия парсится сотнями юзеров, одна и та же kata требует
// одинаковых подсказок, типовые архитектуры system-design повторяются.
//
// Решение: semantic-cache поверх llmchain.Chain. Embeddings считаем на
// нашем VPS через Ollama sidecar (bge-small-en-v1.5, 384-dim). Хранение —
// Redis Hash + Sorted Set + String. Lookup = brute-force cosine similarity
// по ≤2000 векторам на task (~1-2ms Go + 5-10ms MGET = ~10ms worst-case,
// против 500-2000ms реального LLM вызова). Цель — 30-50% снижение cloud-
// квоты на детерминированных тасках (VacanciesJSON / CodingHint /
// SysDesignCritique / Summarize).
//
// Design rationale:
//
//   - Graceful degradation — наивысший приоритет. Если Ollama лёг или
//     Redis недоступен, Lookup просто возвращает miss/err, и CachingChain
//     вызывает underlying Chain как будто кеша не было. НИ ОДИН промах
//     кеша не приводит к падению LLM-пути.
//
//   - Bounded memory. На VPS 12GB RAM Redis — чувствительный ресурс.
//     MaxEntriesPerTask × CacheableTasks = 2000 × 4 ≈ 8000 entries.
//     Entry ≈ 5KB (1.5KB embedding + ~3KB JSON response) ⇒ ~40MB Redis.
//     LRU eviction через Sorted Set score=last_access_unix, batch-evict
//     сразу 100 entries когда перевалили MaxEntriesPerTask — чтобы не
//     делать 2000 round-trip'ов при первом переполнении.
//
//   - Bounded goroutines. Async Store не запускает unbounded go f() —
//     запускает N worker'ов (default 2), буферизированный канал 128.
//     При переполнении дропаем job с метрикой, а не плодим горутины.
//
//   - NoopCache fallback. Если OLLAMA_HOST пуст или Redis nil — wirer
//     отдаёт NoopCache, и CachingChain работает как прямой проксик к
//     Chain. Никаких "кеш частично работает" состояний.
//
//   - Streaming НЕ кешируется. Кеш возвращает snapshot Response;
//     стримовые кадры собирать в snapshot — значит потерять первый-байт
//     UX. CachingChain.ChatStream всегда делегирует underlying Chain.
//
//   - Cosine над brute-force. Не тянем faiss / HNSW / milvus — на 2000
//     векторах × 384 dim линейный перебор отдаёт ответ за ~1ms в Go
//     без reflect'а и без аллокаций на hot-path (pre-allocated buffer).
//     HNSW имеет смысл от ~100k entries; мы сильно ниже.
//
// Threshold выбор:
//
//   - SimilarityThreshold=0.92 default. bge-small-en на "одинаковых по
//     смыслу, но переформулированных" запросах стабильно даёт ≥0.93;
//     на случайных парах ≤0.5. 0.92 — консервативный выбор: ложных
//     cache hit быть НЕ должно (выдать чужой ответ хуже, чем сходить
//     в LLM лишний раз). Tunable через Options для per-task калибровки.
//
// Вне scope пакета:
//
//   - Не кешируем streaming (TaskCopilotStream, TaskInsightProse).
//   - Не кешируем персональные таски (TaskReasoning, TaskCodeReview) —
//     там контекст пользователя делает ответ по определению уникальным.
//   - Не делаем write-through на cloud-провайдеров — кешируем только
//     успешные llmchain.Response на нашей стороне.
package llmcache
