// validate_resource.go — Phase 3.5 auto-promote validation.
//
// Используется auto_promote producer'ом перед записью URL в
// atlas_nodes.external_resources. Output: {alive, reputable, on_topic,
// score 0..1}. Score < 0.7 → skip promote.
//
// "alive" — fetcher returns non-empty body (мы переиспользуем fetcher
// для consistency: тот же контент LLM проверяет).
// "reputable" + "on_topic" — LLM judgment по {url, fetched_text,
// atlas_node.description}.
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"druz9/curation"
	"druz9/shared/pkg/llmchain"
)

type ValidateResource struct {
	Fetcher *curation.Fetcher
	Chain   llmchain.ChatClient
	Timeout time.Duration
}

type ValidateInput struct {
	URL             string
	AtlasNodeID     string
	NodeDescription string
}

type ValidateOutput struct {
	Alive     bool    `json:"alive"`
	Reputable bool    `json:"reputable"`
	OnTopic   bool    `json:"on_topic"`
	Score     float32 `json:"score"`
	Reason    string  `json:"reason"`
}

func (in ValidateInput) CacheKey() string {
	h := sha256.Sum256([]byte(in.URL + "|" + in.AtlasNodeID))
	return "validate_resource:" + hex.EncodeToString(h[:8])
}

func (uc *ValidateResource) Do(ctx context.Context, in ValidateInput) (ValidateOutput, error) {
	if strings.TrimSpace(in.URL) == "" {
		return ValidateOutput{}, fmt.Errorf("curation.ValidateResource: empty url")
	}
	fetched := uc.Fetcher.Fetch(ctx, in.URL)
	if fetched.Body == "" {
		return ValidateOutput{Alive: false, Reason: "fetch failed: " + safeErr(fetched.Error)}, nil
	}
	if uc.Chain == nil {
		// LLM not configured — pass-through alive=true, неopinionated.
		return ValidateOutput{Alive: true, Reputable: true, OnTopic: true, Score: 0.7, Reason: "llm-skip"}, nil
	}
	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 12 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	prompt := buildValidatePrompt(in, fetched)
	resp, err := uc.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskValidateResource,
		JSONMode:    true,
		Temperature: 0.0,
		MaxTokens:   300,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: validateSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		return ValidateOutput{Alive: true, Reason: "llm-fail: " + err.Error()}, nil
	}
	out, perr := parseValidate(resp.Content)
	if perr != nil {
		return ValidateOutput{Alive: true, Reason: "parse-fail"}, nil
	}
	out.Alive = true
	if out.Score < 0 {
		out.Score = 0
	}
	if out.Score > 1 {
		out.Score = 1
	}
	return out, nil
}

const validateSystemPrompt = `You validate a candidate learning resource against an atlas node for druz9.

Output strict JSON ONLY:
{
  "reputable": <bool>,
  "on_topic": <bool>,
  "score": <float 0..1>,
  "reason": "<one short sentence>"
}

Rules:
- reputable: not blogspam, not affiliate-heavy, has substance
- on_topic: actually covers the atlas node concept (semantic check)
- score = 0..1 confidence the resource deserves promotion to curated catalogue
- Be conservative — false-positive pollutes the catalogue`

func buildValidatePrompt(in ValidateInput, fetched curation.FetchResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "URL: %s\nAtlas node: %s\n", in.URL, in.AtlasNodeID)
	if in.NodeDescription != "" {
		fmt.Fprintf(&b, "Node description: %s\n", in.NodeDescription)
	}
	body := fetched.Body
	if len(body) > 4000 {
		body = body[:4000] + "…"
	}
	fmt.Fprintf(&b, "\nFetched title: %s\nFetched content (truncated):\n%s\n", fetched.Title, body)
	b.WriteString("\nReturn JSON only.")
	return b.String()
}

func parseValidate(raw string) (ValidateOutput, error) {
	cleaned := stripFences(raw)
	var out ValidateOutput
	if err := json.Unmarshal([]byte(cleaned), &out); err != nil {
		return out, fmt.Errorf("unmarshal: %w", err)
	}
	return out, nil
}

func safeErr(err error) string {
	if err == nil {
		return "unknown"
	}
	return err.Error()
}
