package enums

type LLMModel string

const (
	LLMModelGPT4oMini     LLMModel = "openai/gpt-4o-mini"
	LLMModelGPT4o         LLMModel = "openai/gpt-4o"
	LLMModelClaudeSonnet4 LLMModel = "anthropic/claude-sonnet-4"
	LLMModelGeminiPro     LLMModel = "google/gemini-pro"
	LLMModelMistral7B     LLMModel = "mistralai/mistral-7b"
)

func (m LLMModel) IsValid() bool {
	switch m {
	case LLMModelGPT4oMini, LLMModelGPT4o, LLMModelClaudeSonnet4, LLMModelGeminiPro, LLMModelMistral7B:
		return true
	}
	return false
}

func (m LLMModel) String() string { return string(m) }

func (m LLMModel) IsPremium() bool {
	switch m {
	case LLMModelGPT4o, LLMModelClaudeSonnet4, LLMModelGeminiPro:
		return true
	case LLMModelGPT4oMini, LLMModelMistral7B:
		return false
	}
	return false
}
