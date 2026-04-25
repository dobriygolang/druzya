# intelligence

AI-coach bounded context для druz9. Два use case'а, оба user-facing
через Hone desktop-клиент:

- **GetDailyBrief** — синтезирует «утренний бриф» (headline + narrative +
  3 рекомендации) из focus-stats 7d, skipped/completed plan-item'ов,
  последних reflection-нот и 5 свежайших нот по recency. Кэшируется на
  6 часов в `hone_daily_briefs`. `force=true` — rate-limited 1/h.

- **AskNotes** — RAG над корпусом нот пользователя. Embedding вопроса
  через bge-small (Ollama) → cosine top-8 → LLM-ответ markdown'ом с
  цитациями `[N]`, парсится в structured `[]Citation`.

## Bounded context

Сервис **читает** из таблиц hone (`hone_focus_sessions`, `hone_daily_plans`,
`hone_notes`) через reader-адаптеры в `cmd/monolith/services/intelligence.go`.
**Пишет** только в свою таблицу `hone_daily_briefs`. Это сознательный
single-writer paradigm для hone-таблиц — мутации остаются за hone-сервисом.

## Wiring

См. `cmd/monolith/services/intelligence.go`. RequireConnectAuth=true.
LLM-tasks: `TaskDailyBrief` (JSON-mode), `TaskNoteQA` (text). Embedder —
тот же `HoneEmbedder` (bge-small Ollama).
