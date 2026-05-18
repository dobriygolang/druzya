package llmchain

import "maps"

// TaskModelMap is the per-task → per-provider model catalogue. The chain
// reads it to pick the right model on whichever provider is healthy at
// call time. Default map covers free-tier providers + Ollama floor;
// paid providers ride only through tier.go virtual-model overrides.
// An empty string means "not available on this provider for this task".
type TaskModelMap map[Task]map[Provider]string

// DefaultTaskModelMap is the baked-in catalogue. The chain copies from
// it at construction; overriding individual slots is an explicit
// operator action through the chain's options.
var DefaultTaskModelMap = TaskModelMap{
	TaskInsightProse: {
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		// Качество 3B заметно хуже 70B для длинной русской прозы —
		// но в fallback это приемлемо (дегредированный UX > ошибка).
		ProviderOllama: "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskCopilotStream: {
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "qwen/qwen3-coder:free",
		ProviderOllama:     "qwen2.5:3b-instruct-q4_K_M",
	},
	TaskReasoning: {
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "qwen/qwen3-coder:free",
		ProviderOllama:     "qwen2.5:3b-instruct-q4_K_M",
	},
	// ────────────────────────────────────────────────────────────────
	// New (2026-Q2) tasks.
	// ────────────────────────────────────────────────────────────────
	TaskCodingHint: {
		// Small model, low latency is the whole point of the task —
		// the hint is obsolete the moment it's late. Groq 8B is fastest
		// first-byte, Cerebras second.
		ProviderGroq:     "llama-3.1-8b-instant",
		ProviderCerebras: "llama3.1-8b",
		ProviderMistral:  "mistral-small-latest",
		// OpenRouter deliberately omitted: qwen3-coder:free has higher
		// p95 first-byte latency in our tests and this task is the one
		// where that matters most.
		// Ollama: для hint'ов локалка может быть primary — мы не жжём cloud
		// квоту на фоновую подсказку. Но для этой task'и latency — весь
		// смысл (подсказка обсолетная если опоздала), поэтому держим 3B
		// а не 7B — 3B выдаёт 25-30 tok/s на 8 CPU, первый токен через 1-2s.
		ProviderOllama: "qwen2.5:3b-instruct-q4_K_M",
	},
	TaskCodeReview: {
		// Reasoning-heavy submit review — the user just finished a
		// mock, they can wait a few seconds for a thorough analysis.
		// Llama-70B на free-tier справляется; DeepSeek-R1 идёт в
		// druz9/reasoning virtual-chain для paid-юзеров.
		ProviderCerebras:   "llama3.3-70b",
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		// Code review на Qwen 3B — заметно хуже 70B по глубине анализа,
		// но рабочий floor. Fallback path.
		ProviderOllama: "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskSysDesignCritique: {
		// Long-context architectural diagrams + spec. Llama-70B с 128k
		// context у всех трёх провайдеров — достаточно для большинства
		// архитектурных диаграмм в free-tier. Paid-юзеры получают
		// длинный context через druz9/ultra (Claude Sonnet 4.5, 200k).
		ProviderCerebras:   "llama3.3-70b",
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		// Qwen 3B с 32k context — достаточно для большинства диаграмм,
		// но реальные архитектурные разборы лучше всё-таки cloud 70B.
		ProviderOllama: "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskSummarize: {
		// Cheapest-available on each provider — summarize runs in the
		// background for Phase 4, token cost trumps quality and the
		// summary may be re-read by a stronger model downstream.
		ProviderGroq:     "llama-3.1-8b-instant",
		ProviderCerebras: "llama3.1-8b",
		ProviderMistral:  "mistral-small-latest",
		// Для bg-summarize Ollama — отличная опция: работает без лимита,
		// качество "достаточное" (summary всё равно читается потом более
		// сильной моделью). 3B тут осознанно вместо 7B — скорость важнее
		// на фоновой задаче, и качество самари у 3B вполне адекватное.
		ProviderOllama: "qwen2.5:3b-instruct-q4_K_M",
	},
	TaskDailyPlanSynthesis: {
		// Hone Today-план: нужен reasoning + строгий JSON-выход (3-4
		// PlanItem'а). Качество приоритетно над latency — регенерация
		// случается раз в день, юзер готов подождать 2-3 сек.
		// 70B-класс на всех cloud-провайдерах; Ollama 3B — floor-fallback
		// (план получится но более общий).
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:3b-instruct-q4_K_M",
	},
	TaskDailyBrief: {
		// AI-coach утренний бриф: strict JSON + 1-3 sentences narrative
		// + 3 recommendation'а. Кеш 6h, регенерация редкая — quality-первая.
		// 70B на всех cloud-провайдерах; Ollama 3B — floor-fallback.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:3b-instruct-q4_K_M",
	},
	TaskVision: {
		// Vision task — multi-provider chain, как и все остальные task'и.
		// Раньше тут был ОДИН провайдер (OpenRouter), и при 429 на free-tier
		// весь vision-функционал лежал. Теперь добавили Groq (Llama 4 Scout
		// нативно multimodal с 2025) — у него отдельный rate-limit pool.
		//
		// Порядок (соответствует LLM_CHAIN_ORDER по умолчанию):
		//   1. Groq llama-4-scout — primary, paid tier $0.11/M в input.
		//      Vision-нативный, fast (Groq's hardware-accelerated inference).
		//   2. OpenRouter google/gemma-3-27b-it:free — fallback, бесплатно
		//      но 200 req/day per IP. Если Groq упал/down — отрабатывает.
		//
		// Hot-swap без redeploy: админ может поменять модели через
		// `/admin → LLM Chain → Task Map → vision`. Static-map — только
		// cold-start fallback.
		//
		// Free OpenRouter-альтернативы если Gemma 3 тоже выпилят:
		//   "google/gemma-3-12b-it:free"          — 12B, быстрее.
		//   "google/gemma-4-26b-a4b-it:free"      — 26B, 262K context.
		//   "nvidia/nemotron-nano-12b-v2-vl:free" — NVIDIA 12B vision.
		//
		// Premium через VirtualUltra ModelOverride:
		//   Claude Sonnet 4.5 — best-in-class на UI/диаграммах, tier=max.
		//   GPT-4o / GPT-4.1 — fallback в Ultra chain.
		//
		// Cerebras / Mistral / DeepSeek сюда не добавляем: первые два
		// text-only на 2026-04, DeepSeek вижн не релизил (V3/R1 text-only).
		// Ollama — теоретически self-hosted vision (llava / qwen2-vl /
		// gemma3:vision) подойдёт, но конкретный model-id зависит от того
		// что админ поднял у себя — пусть выставляет через UI.
		ProviderGroq:       "meta-llama/llama-4-scout-17b-16e-instruct",
		ProviderOpenRouter: "google/gemma-3-27b-it:free",
	},
	TaskNoteQA: {
		// RAG-ответ на вопрос по нотам: длинный context (title+body 8 нот)
		// + reasoning + markdown-вывод с [N]-цитациями. 70B-класс.
		// Latency не критична (юзер готов подождать 2-3s после Enter).
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskEnglishMockHR: {
		// English HR-mock — пользователь говорит / пишет на английском с
		// AI-собеседующим. Latency не критична (это диалог, не auto-suggest);
		// качество прозы и грамматического контроля — основной критерий.
		// 70B-class на всех cloud-провайдерах. Ollama 7B сохранён как
		// floor-fallback, но качество ESL-feedback'а на 7B заметно хуже
		// (модель плодит canned phrases вместо real HR pushback).
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskSystemDesignSeniorMock: {
		// Senior SD multi-turn dialogue — long context, deep reasoning.
		// Same model class as TaskSysDesignCritique (which grades a single
		// diagram), but distinct entry: critique is one-shot evaluation,
		// this is interactive multi-turn pushback. 70B на всех cloud
		// провайдерах. Ollama 7B floor — качество senior pushback'а на
		// 7B плохое (модель «соглашается» вместо «давит»), но 503-fail
		// хуже чем degraded UX.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskTechLeadMock: {
		// Tech Lead / EM behavioral STAR-mock. Same 70B-class story —
		// quality of probing (refuses generic answers, demands specific
		// numbers / outcomes / lessons) requires reasoning depth.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskSysanalystMock: {
		// Sysanalyst free-form mock. Reasoning over data design + API
		// contract critique + integration patterns — 70B-class.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskProductAnalystMock: {
		// Product analyst free-form mock. Stats reasoning (sample size,
		// CUPED, MDE) + SQL critique on the conversation — 70B-class.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskQAMock: {
		// QA free-form mock — edge-case reasoning + automation design.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskDevOpsMock: {
		// DevOps / SRE mock — infra tradeoffs + incident response.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskMLEngMock: {
		// ML engineering mock — math depth + ml-system-design.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskTutorPreSessionBrief: {
		// Tutor pre-session brief — narrative prose over aggregated
		// numbers, ~250 words, Russian. Quality > latency (tutor reads
		// it once before a 1:1). 70B-class on cloud; Ollama 7B floor
		// for offline / quota-exhausted fallback.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskHoneSummaryGrade: {
		// Reading summary grader — strict JSON, small surface, fast
		// turnaround (user-blocking). 8B-class is enough; the work is
		// "compare two short pieces of text, return a number". 70B
		// would be overkill and burn the latency budget. Mistral
		// remains a fallback for when groq/cerebras free tiers throttle.
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskHoneWritingFeedback: {
		// Writing-as-Focus inline feedback — user-blocking JSON list.
		// Same latency-vs-quality tradeoff as summary grading; the work
		// is "find the bad bits in this 200-word draft". 8B handles
		// surface grammar; the 120B free-tier OpenRouter route is the
		// quality fallback when the 8B misses subtler stylistic issues.
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskHoneCodeReviewGrade: {
		// Code-review grading — comparing a user review to a diff
		// requires reasoning about what the patch actually does, what
		// it misses, and whether the reviewer's comments are technically
		// sound. 70B-class on cloud; 7B Ollama floor for offline work.
		// Worth the extra latency vs the 8B used in writing feedback.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskHoneSpeakingGrade: {
		// Speaking-grade — word-level alignment between reference text and
		// Whisper transcript + 1-line coach feedback. Mostly classification,
		// no deep reasoning required. 8B is plenty + UI is latency-sensitive
		// (user stares at "Grading..." until response). Same model tier as
		// writing feedback.
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskHoneNoteActionExtract: {
		// Note action item extraction — short JSON output (<=10 items),
		// classification + 5-10-word title formulation per excerpt.
		// Не reasoning-heavy, нужна скорость (юзер ждёт panel render).
		// 8B-class. Russian-first контент (Sergey пишет заметки по-русски),
		// llama-3.1-8b-instant + mistral-small справляются нативно.
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAITutorChat: {
		// AI-tutor chat — open-ended dialogue с 4-layer memory injection.
		// Quality > latency (студент готов подождать 2-3s на coach reply).
		// Russian-first контент → Groq Llama 3 70B верхний приоритет.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAITutorCompact: {
		// Compaction — small structured task, 8B хватает. Latency не
		// важна (background trigger, не user-blocking).
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAITutorAssignment: {
		// Daily assignment generation — structured JSON output. 70B
		// чтобы качественно подобрать задачу под текущую слабость
		// студента из snapshot.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskCustomPathGenerate: {
		// Custom path generation — JSON list of 8-15 topics from
		// free-form goal. 70B для качественной categorization.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAtlasClassify: {
		// Atlas classification — single TODO → JSON {match | new node}.
		// Дешёвая classification, 8B хватит.
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskCurateResource: {
		// External resource curation — 3-5 best free links per atlas node
		// со shape {url, title, author, kind, minutes, level, priority,
		// why}. Background, не user-blocking, но quality > speed: плохой
		// `why` или мусорный URL = ручная правка Sergey'ем. 70B-class.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAssistantNextAction: {
		// Coach hero «one daily action» — structured JSON под user's
		// state. User-blocking но cached 1/day, quality > latency. 70B.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAssistantForkAnalysis: {
		// Weekly fork-analysis (MLE vs DE lean) — confidence-bearing JSON.
		// Background cron, 70B для качества reasoning под branch scores.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAssistantRereroll: {
		// Dismiss-flow alternative action — light JSON gen, latency-bound.
		// 8B хватает: тот же signals input, нужна только variation.
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskNotesLinkSuggest: {
		// Embed-based candidate retrieval + LLM rerank → JSON list. Quality
		// > latency (предложения накапливаются, не блокируют typing). 70B
		// для consistency rerank'а.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskTaskboardCategorise: {
		// New task → column + tag (today/week/backlog). Light classification,
		// latency-sensitive (drag-drop UI ждёт), 8B-class.
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAITutorML: {
		// ml-coach chat — 4-layer memory injection, ML reasoning depth.
		// 70B-class — те же модели что TaskAITutorChat.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskAITutorDE: {
		// de-mentor chat — DE reasoning (SQL plans / streaming /
		// distributed compute). 70B-class.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskCheckpointGrade: {
		// 5-question quiz grading с rubric — ≥70% unlock'ает следующий
		// step. Quality важно (false-pass = юзер идёт в гору без базы).
		// 70B-class.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskReflectionExtract: {
		// reflection_text + expected concepts → mentioned/missed atlas
		// node ids. Classification, 8B хватит. Cached per text-hash.
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderCerebras:   "llama3.1-8b",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskExtractResourceContent: {
		// URL+text → full Resource shape (topics, summary, depth, level).
		// Quality важно — извлечение topics_covered определяет совпадение
		// с atlas-узлами. 70B-class. Cached per URL hash 7d.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskReflectionGrade: {
		// takeaways[] + expected topics → quality_score + extracted_topics
		// + confusion_flag. Latency-sensitive (modal blocks user). Cerebras
		// 8B-fast preferred (~150 tok/s).
		ProviderCerebras:   "llama3.1-8b",
		ProviderGroq:       "llama-3.1-8b-instant",
		ProviderMistral:    "mistral-small-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
	TaskValidateResource: {
		// URL + atlas_node desc → alive/reputable/on_topic/score.
		// Cron-driven, не latency-sensitive. 70B качества для on_topic
		// judgement.
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
		ProviderOllama:     "qwen2.5:7b-instruct-q4_K_M",
	},
}

// Clone returns a deep copy so callers can mutate without affecting
// other chain instances / tests.
func (m TaskModelMap) Clone() TaskModelMap {
	out := make(TaskModelMap, len(m))
	for t, inner := range m {
		out[t] = maps.Clone(inner)
	}
	return out
}

// ModelFor returns the model id for (task, provider), or "" when no
// mapping exists. Callers treat "" as "skip this provider for this task".
func (m TaskModelMap) ModelFor(task Task, p Provider) string {
	inner, ok := m[task]
	if !ok {
		return ""
	}
	return inner[p]
}
