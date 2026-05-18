package infra

// OpenRouterURL — OpenAI-compatible chat-completions endpoint. Используется
// прямым analyzer'ом (report generation), который пока не переведён на
// llmchain. Streaming клиент сам ходит через llmchain.Chain.
const OpenRouterURL = "https://openrouter.ai/api/v1/chat/completions"

// truncate подрезает строку до n рун и добавляет "…", если обрезание
// случилось. Используется в analyzer'е для compact-логов ошибок и
// prompt-input'а (UI юзеру не показывается).
func truncate(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
