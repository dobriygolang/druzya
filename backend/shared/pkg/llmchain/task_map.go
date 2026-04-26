package llmchain

// TaskModelMap is the per-task → per-provider model catalogue. The chain
// reads it to pick the right model on whichever provider is healthy at
// call time. Keeping this in code (not the DB) because:
//
//   - It changes with model availability on each provider, not with
//     operator choice. A deploy is the right cadence.
//   - The chain needs it synchronously; a DB lookup per call would add
//     latency to the hot path.
//   - Admins still edit llm_models (user-facing list + per-model flags);
//     this map is the chain's opinion of "best technical pick per task".
//
// Criteria for picks (as of 2026-Q2):
//
//	VacanciesJSON    — 8B-class, JSON mode reliable. Latency blocks the UI.
//	InsightProse     — 70B-class, Russian prose quality matters.
//	CopilotStream    — 70B-class, reasoning + streaming. Same as insight
//	                   but accessed via ChatStream.
//	Reasoning        — 70B-class, analyzer / structured output tasks.
//	CodingHint       — small + low latency. Для on-demand подсказок юзеру.
//	CodeReview       — reasoning-heavy. Анализ submit'а.
//	SysDesignCritique — long-context, quality > speed.
//	Summarize        — самая дешёвая модель, фон для bg-summarizer.
//
// Default-карта включает ТОЛЬКО free-tier провайдеров (Groq, Cerebras,
// Mistral La Plateforme, OpenRouter :free-lane) + Ollama как self-host
// floor-fallback. Paid-провайдеры (DeepSeek) включаются только для
// virtual-моделей druz9/pro и druz9/reasoning (см. tier.go).
//
// When a provider doesn't have a model for a task (e.g. Mistral-free
// lacks an 8B instant option), the chain skips that provider for the
// task. An empty string in this map means "not available here".
type TaskModelMap map[Task]map[Provider]string

// DefaultTaskModelMap is the baked-in catalogue. The chain copies from
// it at construction; overriding individual slots is an explicit
// operator action through the chain's options.
var DefaultTaskModelMap = TaskModelMap{
	TaskVacanciesJSON: {
		ProviderGroq: "llama-3.1-8b-instant",
		// Cerebras seeds 8b as "llama3.1-8b" (no dot); they maintain
		// their own model ids parallel to the Groq ones.
		ProviderCerebras: "llama3.1-8b",
		// Mistral Small is closest to 8B-class on La Plateforme free tier.
		ProviderMistral: "mistral-small-latest",
		// OpenRouter :free lane — qwen3-coder is the most reliable strict-JSON
		// model in our tests; gpt-oss-120b:free breaks JSON ~15% of the time.
		ProviderOpenRouter: "qwen/qwen3-coder:free",
		// Ollama floor-fallback: Qwen 2.5 3B с JSON-mode. Структура хуже
		// чем у cloud 8B-70B, но для "крайнего случая" (все провайдеры
		// исчерпаны) лучше чем error.
		ProviderOllama: "qwen2.5:7b-instruct-q4_K_M",
	},
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
		//   Claude Sonnet 4.5 — best-in-class на UI/диаграммах, tier=ascendant.
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
}

// Clone returns a deep copy so callers can mutate without affecting
// other chain instances / tests.
func (m TaskModelMap) Clone() TaskModelMap {
	out := make(TaskModelMap, len(m))
	for t, inner := range m {
		dup := make(map[Provider]string, len(inner))
		for p, mid := range inner {
			dup[p] = mid
		}
		out[t] = dup
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
