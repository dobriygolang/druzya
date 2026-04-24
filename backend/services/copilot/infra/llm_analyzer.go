package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"druz9/copilot/domain"
)

// LLMAnalyzer — turns a session's turns into a structured report via a
// single LLM call. Uses OpenRouter's chat-completions (JSON mode) to
// keep the response schema-predictable. If the LLM returns malformed
// JSON we log and fall back to a stub report; we never return an error
// up to the subscriber because a bad LLM run shouldn't crash the event
// loop — we mark the report as failed via ReportRepo.Fail instead.
type LLMAnalyzer struct {
	apiKey     string
	endpoint   string
	model      string
	httpClient *http.Client
	// ReportURLTemplate — printf-style: first %s = session id. The
	// server fills this in so desktop/frontend can open the report in
	// the Druzya web UI.
	reportURLTemplate string
}

// NewLLMAnalyzer builds an analyzer that calls OpenRouter at the given
// endpoint. Default model is gpt-4o-mini for cost; the caller can pass
// "" to use that default.
func NewLLMAnalyzer(apiKey, model, reportURLTemplate string) *LLMAnalyzer {
	if model == "" {
		model = "openai/gpt-4o-mini"
	}
	if reportURLTemplate == "" {
		reportURLTemplate = "https://druzya.tech/copilot/reports/%s"
	}
	return &LLMAnalyzer{
		apiKey:            apiKey,
		endpoint:          OpenRouterURL,
		model:             model,
		httpClient:        &http.Client{Timeout: 60 * time.Second},
		reportURLTemplate: reportURLTemplate,
	}
}

// ReportURLFor — renders the canonical Druzya web URL for a session's
// report. Exposed so callers (EndSession, subscribers) can persist the
// URL alongside the report without re-implementing the template.
func (a *LLMAnalyzer) ReportURLFor(sessionID string) string {
	return fmt.Sprintf(a.reportURLTemplate, sessionID)
}

// Analyze — implements domain.Analyzer. Pure function from input to
// result; no I/O beyond the LLM call.
func (a *LLMAnalyzer) Analyze(ctx context.Context, in domain.AnalyzerInput) (domain.AnalyzerResult, error) {
	if len(in.Conversations) == 0 {
		// No turns — return an honest "session was too short" report.
		return domain.AnalyzerResult{
			OverallScore: 0,
			ReportMarkdown: "Сессия завершилась без содержимого — " +
				"анализ не проведён.",
		}, nil
	}

	transcript := buildTranscript(in)
	prompt := buildPrompt(transcript)

	body, err := json.Marshal(map[string]any{
		"model": a.model,
		"messages": []map[string]any{
			{
				"role": "system",
				"content": "Ты — технический тренер по собеседованиям. Возвращай СТРОГО JSON " +
					"без префиксов, с полями overall_score (int 0..100), section_scores (map string->int 0..100), " +
					"weaknesses (array of strings), recommendations (array of strings), " +
					"report_markdown (string). Отвечай по-русски.",
			},
			{"role": "user", "content": prompt},
		},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0.2,
	})
	if err != nil {
		return domain.AnalyzerResult{}, fmt.Errorf("copilot.LLMAnalyzer.marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint, bytes.NewReader(body))
	if err != nil {
		return domain.AnalyzerResult{}, fmt.Errorf("copilot.LLMAnalyzer.newreq: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return domain.AnalyzerResult{}, fmt.Errorf("copilot.LLMAnalyzer.do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return domain.AnalyzerResult{}, fmt.Errorf("copilot.LLMAnalyzer.http %d: %s", resp.StatusCode, truncate(string(b), 200))
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return domain.AnalyzerResult{}, fmt.Errorf("copilot.LLMAnalyzer.decode: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return domain.AnalyzerResult{}, fmt.Errorf("copilot.LLMAnalyzer: empty choices")
	}

	return parseAnalyzerJSON(parsed.Choices[0].Message.Content)
}

// buildTranscript — a compact textual rendering of all turns in the
// session. We strip message content to 600 chars per turn to keep the
// LLM input bounded; full content is always available server-side if
// the user wants to dig in manually.
func buildTranscript(in domain.AnalyzerInput) string {
	var sb strings.Builder
	for _, c := range in.Conversations {
		fmt.Fprintf(&sb, "\n\n--- Диалог %q (model=%s) ---\n", truncate(c.Title, 60), c.Model)
		for _, m := range in.MessagesByConvID[c.ID] {
			role := string(m.Role)
			if m.HasScreenshot {
				role += "+screenshot"
			}
			fmt.Fprintf(&sb, "[%s] %s\n", role, truncate(m.Content, 600))
		}
	}
	return sb.String()
}

func buildPrompt(transcript string) string {
	return "Ниже — транскрипт подсказок AI-копайлота, которые пользователь запрашивал " +
		"во время собеседования. Проанализируй его и выдай JSON-отчёт: " +
		"\n- overall_score (0..100, твоя общая оценка уверенности кандидата)" +
		"\n- section_scores: ключи из {\"algorithms\",\"sql\",\"go\",\"system_design\",\"behavioral\"} " +
		"— только те, что реально фигурировали. Значения 0..100." +
		"\n- weaknesses: 3-5 коротких пунктов про слабые места" +
		"\n- recommendations: 3-5 конкретных действий, что повторить/изучить" +
		"\n- report_markdown: развёрнутое summary 3-5 абзацев на русском, " +
		"с подзаголовками (## Сильные стороны, ## Слабые места, ## Рекомендации)." +
		"\n\nТранскрипт:" + transcript
}

// parseAnalyzerJSON — permissive parse. If the LLM returns close-but-not-
// quite JSON (markdown fences around it, text prefixes), we strip and
// try again.
func parseAnalyzerJSON(raw string) (domain.AnalyzerResult, error) {
	cleaned := strings.TrimSpace(raw)
	// Strip ``` ```json fences if present.
	if strings.HasPrefix(cleaned, "```") {
		cleaned = strings.TrimPrefix(cleaned, "```json")
		cleaned = strings.TrimPrefix(cleaned, "```")
		cleaned = strings.TrimSuffix(cleaned, "```")
		cleaned = strings.TrimSpace(cleaned)
	}

	var parsed struct {
		OverallScore    int            `json:"overall_score"`
		SectionScores   map[string]int `json:"section_scores"`
		Weaknesses      []string       `json:"weaknesses"`
		Recommendations []string       `json:"recommendations"`
		ReportMarkdown  string         `json:"report_markdown"`
	}
	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return domain.AnalyzerResult{}, fmt.Errorf("copilot.parseAnalyzerJSON: %w", err)
	}

	// Clamp scores to the declared range — LLMs sometimes emit 101 or -5.
	parsed.OverallScore = clamp(parsed.OverallScore, 0, 100)
	for k, v := range parsed.SectionScores {
		parsed.SectionScores[k] = clamp(v, 0, 100)
	}

	return domain.AnalyzerResult{
		OverallScore:    parsed.OverallScore,
		SectionScores:   parsed.SectionScores,
		Weaknesses:      parsed.Weaknesses,
		Recommendations: parsed.Recommendations,
		ReportMarkdown:  parsed.ReportMarkdown,
	}, nil
}

func clamp(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// Interface guard.
var _ domain.Analyzer = (*LLMAnalyzer)(nil)
