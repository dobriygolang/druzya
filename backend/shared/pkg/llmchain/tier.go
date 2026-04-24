package llmchain

import (
	"errors"
	"strings"

	"druz9/shared/enums"
)

// ErrTierRequired возвращается candidates() когда запрошенная модель
// (через ModelOverride) или virtual chain требует tier выше, чем у
// пользователя. Handler-слой мэппит в Connect CodeResourceExhausted →
// HTTP 402 с полем upgrade_url (или 403, если UX дикcrет иначе).
var ErrTierRequired = errors.New("llmchain: subscription tier required")

// ModelRequiredTier — per-модельный paywall. Любая модель НЕ в карте
// считается free-доступной. Добавление нового paid-tier'а = одна строка
// здесь.
var ModelRequiredTier = map[string]enums.SubscriptionPlan{
	// OpenRouter paid-lane (bypass :free suffix) — cheap, general purpose.
	"openai/gpt-4.1-mini":        enums.SubscriptionPlanSeeker,
	"openai/o3-mini":             enums.SubscriptionPlanSeeker,
	"anthropic/claude-haiku-4.5": enums.SubscriptionPlanSeeker,
	// OpenRouter premium.
	"openai/gpt-4.1":              enums.SubscriptionPlanAscendant,
	"openai/gpt-4o":               enums.SubscriptionPlanAscendant,
	"openai/o3":                   enums.SubscriptionPlanAscendant,
	"anthropic/claude-sonnet-4.5": enums.SubscriptionPlanAscendant,
	"anthropic/claude-opus-4":     enums.SubscriptionPlanAscendant,
	// DeepSeek direct (самые дёшево-интеллектуальные paid-модели).
	"deepseek-chat":     enums.SubscriptionPlanSeeker,
	"deepseek-reasoner": enums.SubscriptionPlanSeeker,
}

// ModelRequiresTier — lookup с default TierFree. Удобно для вызова в
// условиях без обработки !ok.
func ModelRequiresTier(modelID string) enums.SubscriptionPlan {
	if t, ok := ModelRequiredTier[modelID]; ok {
		return t
	}
	return enums.SubscriptionPlanFree
}

// tierRank для сравнения tier'ов. 0=free, 1=seeker, 2=ascendant. Синхронизирована
// с subscription/domain.TierRank (копия — кросс-доменный import был бы
// циклом через shared).
func tierRank(t enums.SubscriptionPlan) int {
	switch t {
	case enums.SubscriptionPlanFree:
		return 0
	case enums.SubscriptionPlanSeeker:
		return 1
	case enums.SubscriptionPlanAscendant:
		return 2
	}
	return 0
}

// TierCovers — true если userTier покрывает required. Пустой userTier
// трактуется как free (graceful default для legacy-caller'ов).
func TierCovers(userTier, required enums.SubscriptionPlan) bool {
	return tierRank(userTier) >= tierRank(required)
}

// ───────────────────────────────────────────────────────────────────────
// Virtual models — "druz9/pro" / "druz9/ultra" / "druz9/reasoning".
// Юзер в UI выбирает виртуальную модель; chain разворачивает её в
// fallback-chain реальных моделей и пробует последовательно.
// ───────────────────────────────────────────────────────────────────────

const (
	// VirtualTurbo — free-chain (уже реализован через Task-mapping, для
	// консистентности api также принимается как ModelOverride).
	VirtualTurbo = "druz9/turbo"
	// VirtualPro — для tier=seeker+. Cheap-paid модели: быстрые, качественные.
	VirtualPro = "druz9/pro"
	// VirtualUltra — для tier=ascendant. Top-tier модели.
	VirtualUltra = "druz9/ultra"
	// VirtualReasoning — для tier=seeker+. Reasoning-heavy (R1, o3).
	VirtualReasoning = "druz9/reasoning"
)

// virtualCandidate — одно звено фиктивного chain'а.
type virtualCandidate struct {
	Provider Provider
	Model    string
}

// virtualChains — цепочки моделей per virtual id. Порядок = приоритет
// попыток (от быстрого/дешёвого к надёжному fallback'у).
//
// Актуальность моделей (2026-Q2) — меняй тут при обновлении pricing/lineup
// у OpenRouter/DeepSeek. Не забудь синхронно обновить ModelRequiredTier
// выше если модель переехала в другой tier.
var virtualChains = map[string][]virtualCandidate{
	VirtualTurbo: {
		// Дублирует логику task_map для TaskCopilotStream (free-chain),
		// на случай если caller прислал druz9/turbo через ModelOverride.
		{Provider: ProviderGroq, Model: "llama-3.3-70b-versatile"},
		{Provider: ProviderCerebras, Model: "llama3.3-70b"},
		{Provider: ProviderMistral, Model: "mistral-large-latest"},
		{Provider: ProviderOpenRouter, Model: "qwen/qwen3-coder:free"},
		{Provider: ProviderOllama, Model: "qwen2.5:7b-instruct-q4_K_M"},
	},
	VirtualPro: {
		// Быстрые+умные seeker-tier модели. gpt-4.1-mini — best-in-class
		// для своего прайса, Haiku 4.5 — baseline Anthropic. DeepSeek V3
		// дёшев но slightly slower на OpenRouter — ставим после.
		{Provider: ProviderOpenRouter, Model: "openai/gpt-4.1-mini"},
		{Provider: ProviderOpenRouter, Model: "anthropic/claude-haiku-4.5"},
		{Provider: ProviderDeepSeek, Model: "deepseek-chat"},
		// Fallback в free-chain если все paid провайдеры легли —
		// юзер не остаётся без ответа.
		{Provider: ProviderGroq, Model: "llama-3.3-70b-versatile"},
		{Provider: ProviderCerebras, Model: "llama3.3-70b"},
	},
	VirtualUltra: {
		// Top-tier. Claude Sonnet 4.5 — гибкий best-all-around; gpt-4.1
		// — конкурент. gpt-4o — backup если кто-то лёг.
		{Provider: ProviderOpenRouter, Model: "anthropic/claude-sonnet-4.5"},
		{Provider: ProviderOpenRouter, Model: "openai/gpt-4.1"},
		{Provider: ProviderOpenRouter, Model: "openai/gpt-4o"},
		// Fallback в pro-level если ultra-модели все задохнулись.
		{Provider: ProviderOpenRouter, Model: "openai/gpt-4.1-mini"},
		// И в free-chain на самый-самый крайний случай.
		{Provider: ProviderGroq, Model: "llama-3.3-70b-versatile"},
	},
	VirtualReasoning: {
		// DeepSeek R1 — лучший price/reasoning на рынке (API).
		// o3-mini — хорош, но Anthropic extended-thinking через sonnet
		// — даёт более связный output на код/архитектуру.
		{Provider: ProviderDeepSeek, Model: "deepseek-reasoner"},
		{Provider: ProviderOpenRouter, Model: "openai/o3-mini"},
		{Provider: ProviderOpenRouter, Model: "anthropic/claude-sonnet-4.5"},
		// Degraded fallback.
		{Provider: ProviderGroq, Model: "llama-3.3-70b-versatile"},
	},
}

// VirtualModelMinTier — минимальный tier для использования виртуалки.
// Проверяется ДО expand'а цепочки (чтобы free не увидел внутренние модели).
var VirtualModelMinTier = map[string]enums.SubscriptionPlan{
	VirtualTurbo:     enums.SubscriptionPlanFree,
	VirtualPro:       enums.SubscriptionPlanSeeker,
	VirtualUltra:     enums.SubscriptionPlanAscendant,
	VirtualReasoning: enums.SubscriptionPlanSeeker,
}

// IsVirtualModel — безопасная проверка что это наша виртуалка (а не
// условный "openai/gpt-4o"). Иначе providerFromModelID пошёл бы парсить.
func IsVirtualModel(modelID string) bool {
	return strings.HasPrefix(modelID, "druz9/")
}
