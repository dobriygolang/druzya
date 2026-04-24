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
// Criteria for picks (as of 2026-04):
//
//	VacanciesJSON    — 8B-class, JSON mode reliable. Latency blocks the UI.
//	InsightProse     — 70B-class, Russian prose quality matters.
//	CopilotStream    — 70B-class, reasoning + streaming. Same as insight
//	                   but accessed via ChatStream.
//	Reasoning        — 70B-class, analyzer / structured output tasks.
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
		// SambaNova Llama-3.3-70B is overkill for strict-JSON but they
		// don't expose an 8B model on the free tier — using 70B here is
		// fine because SambaNova's throughput makes it still faster than
		// Mistral-Small on shorter payloads.
		ProviderSambaNova: "Meta-Llama-3.3-70B-Instruct",
		// Cloudflare 70B-fp8-fast for strict-JSON: emits reliable JSON and
		// fits the neuron budget since vacancy extraction responses stay short.
		ProviderCloudflareAI: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	},
	TaskInsightProse: {
		ProviderGroq:         "llama-3.3-70b-versatile",
		ProviderCerebras:     "llama3.3-70b",
		ProviderMistral:      "mistral-large-latest",
		ProviderOpenRouter:   "openai/gpt-oss-120b:free",
		ProviderSambaNova:    "Meta-Llama-3.3-70B-Instruct",
		ProviderCloudflareAI: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	},
	TaskCopilotStream: {
		ProviderGroq:         "llama-3.3-70b-versatile",
		ProviderCerebras:     "llama3.3-70b",
		ProviderMistral:      "mistral-large-latest",
		ProviderOpenRouter:   "qwen/qwen3-coder:free",
		ProviderSambaNova:    "Meta-Llama-3.3-70B-Instruct",
		ProviderCloudflareAI: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
	},
	TaskReasoning: {
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderCerebras:   "llama3.3-70b",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "qwen/qwen3-coder:free",
		// DeepSeek-R1 is the reasoning champ on SambaNova's free tier —
		// preferred here when a proper "think step-by-step" model beats a
		// general Llama-70B.
		ProviderSambaNova:    "DeepSeek-R1",
		ProviderCloudflareAI: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
	},
	// ────────────────────────────────────────────────────────────────
	// New (2026-Q2) tasks.
	// ────────────────────────────────────────────────────────────────
	TaskCodingHint: {
		// Small model, low latency is the whole point of the task —
		// the hint is obsolete the moment it's late. Groq 8B is fastest
		// first-byte, Cerebras second.
		ProviderGroq:         "llama-3.1-8b-instant",
		ProviderCerebras:     "llama3.1-8b",
		ProviderMistral:      "mistral-small-latest",
		ProviderSambaNova:    "Qwen2.5-Coder-32B-Instruct",
		ProviderCloudflareAI: "@cf/qwen/qwen2.5-coder-32b-instruct",
		// OpenRouter deliberately omitted: qwen3-coder:free has higher
		// p95 first-byte latency in our tests and this task is the one
		// where that matters most.
	},
	TaskCodeReview: {
		// Reasoning-heavy submit review — the user just finished a
		// mock, they can wait a few seconds for a thorough analysis.
		// DeepSeek-R1 (SambaNova) beats Llama-70B on structured
		// critique; CF's distilled-R1 is a reasonable fallback.
		ProviderSambaNova:    "DeepSeek-R1",
		ProviderCerebras:     "llama3.3-70b",
		ProviderGroq:         "llama-3.3-70b-versatile",
		ProviderCloudflareAI: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
	},
	TaskSysDesignCritique: {
		// Long-context architectural diagrams + spec → Qwen2.5-72B's
		// 128k window fits the whole problem. Llama-70B is the backup
		// everywhere; Mistral-Large holds up on system-design prose.
		ProviderSambaNova:  "Qwen2.5-72B-Instruct",
		ProviderCerebras:   "llama3.3-70b",
		ProviderGroq:       "llama-3.3-70b-versatile",
		ProviderMistral:    "mistral-large-latest",
		ProviderOpenRouter: "openai/gpt-oss-120b:free",
	},
	TaskSummarize: {
		// Cheapest-available on each provider — summarize runs in the
		// background for Phase 4, token cost trumps quality and the
		// summary may be re-read by a stronger model downstream.
		ProviderGroq:     "llama-3.1-8b-instant",
		ProviderCerebras: "llama3.1-8b",
		ProviderMistral:  "mistral-small-latest",
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
