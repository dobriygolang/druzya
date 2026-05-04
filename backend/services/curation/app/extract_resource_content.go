// extract_resource_content.go — Phase 3.5 LLM extraction поверх fetcher'а.
//
// Pipeline: fetch URL → extract text → LLM (TaskExtractResourceContent) →
// curation.Resource shape с topics_covered/summary/depth/level/minutes.
//
// Каскад fail-modes:
//   - fetcher fail → возвращаем preview с {URL, эмпти fields, manual=true},
//     UI попросит юзера заполнить руками с autocomplete по atlas-nodes
//   - LLM fail → fetcher.Title + plain summary без topics, manual=true
//   - LLM ok → full Resource shape, manual=false
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
	"druz9/curation/domain"
	"druz9/shared/pkg/llmchain"
)

// ExtractResourceContent UC.
type ExtractResourceContent struct {
	Fetcher *curation.Fetcher
	Chain   llmchain.ChatClient
	Timeout time.Duration
}

// ExtractInput.
type ExtractInput struct {
	URL string
	// AtlasNodeIDs — допустимые id для topics_covered/prereqs (LLM может
	// упасть в hallucination). Caller передаёт из repo.
	AtlasNodeIDs []string
}

// ExtractOutput — preview для confirm-modal.
type ExtractOutput struct {
	Preview domain.Resource
	// Manual=true когда LLM не смог extract'нуть (fetcher fail или LLM
	// fail). UI показывает пустые поля + autocomplete.
	Manual    bool
	FetchInfo curation.FetchResult
}

// CacheKey deterministic — caller использует для Redis lookup.
func (in ExtractInput) CacheKey() string {
	h := sha256.Sum256([]byte(in.URL))
	return "extract_resource:" + hex.EncodeToString(h[:8])
}

func (uc *ExtractResourceContent) Do(ctx context.Context, in ExtractInput) (ExtractOutput, error) {
	if strings.TrimSpace(in.URL) == "" {
		return ExtractOutput{}, fmt.Errorf("curation.ExtractResourceContent: empty url")
	}
	out := ExtractOutput{Preview: domain.Resource{URL: in.URL}}

	fetched := uc.Fetcher.Fetch(ctx, in.URL)
	out.FetchInfo = fetched
	if fetched.Body == "" {
		out.Manual = true
		out.Preview.Title = fetched.Title
		return out, nil
	}

	if uc.Chain == nil {
		out.Manual = true
		out.Preview.Title = fetched.Title
		return out, nil
	}
	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	prompt := buildExtractPrompt(in, fetched)
	resp, err := uc.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskExtractResourceContent,
		JSONMode:    true,
		Temperature: 0.2,
		MaxTokens:   800,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: extractSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		out.Manual = true
		out.Preview.Title = fetched.Title
		return out, nil // fail-soft — возвращаем preview без error'а
	}
	parsed, perr := parseExtractedResource(resp.Content, in.URL, in.AtlasNodeIDs)
	if perr != nil {
		out.Manual = true
		out.Preview.Title = fetched.Title
		return out, nil
	}
	out.Preview = parsed
	out.Manual = false
	return out, nil
}

const extractSystemPrompt = `You extract structured metadata from a fetched web resource for druz9, a senior developer learning platform.

Output strict JSON ONLY (no markdown, no commentary):
{
  "title": "<short title>",
  "author": "<author or empty>",
  "kind": "course|video|book|paper|article|tool|kata|podcast",
  "minutes": <estimated read/watch minutes int>,
  "level": "A|B|C|D",
  "priority": "core|supplement|optional",
  "why": "<1 sentence — why this resource is useful here>",
  "topics_covered": ["<atlas_node_id>", ...],
  "prereqs": ["<atlas_node_id>", ...],
  "summary": "<2-3 sentences>",
  "depth": "intro|intuition|deep|reference",
  "format_notes": "<UI hint or empty>"
}

Rules:
- Use ONLY atlas_node_ids from the provided list. Empty arrays allowed.
- Level: A=entry, B=middle, C=senior/staff, D=research.
- Priority: core (must), supplement (deepens core), optional.
- Skip fields you cannot determine — use empty string / 0 / [].`

func buildExtractPrompt(in ExtractInput, fetched curation.FetchResult) string {
	var b strings.Builder
	fmt.Fprintf(&b, "URL: %s\n", in.URL)
	if fetched.Title != "" {
		fmt.Fprintf(&b, "Fetched title: %s\n", fetched.Title)
	}
	body := fetched.Body
	if len(body) > 6000 {
		body = body[:6000] + "…"
	}
	fmt.Fprintf(&b, "\nFETCHED CONTENT (truncated):\n%s\n", body)
	if len(in.AtlasNodeIDs) > 0 {
		fmt.Fprintf(&b, "\nALLOWED atlas_node_ids: %s\n", strings.Join(in.AtlasNodeIDs, ", "))
	}
	b.WriteString("\nReturn JSON only.")
	return b.String()
}

func parseExtractedResource(raw, url string, allowed []string) (domain.Resource, error) {
	cleaned := stripFences(raw)
	var r domain.Resource
	if err := json.Unmarshal([]byte(cleaned), &r); err != nil {
		return r, fmt.Errorf("unmarshal: %w", err)
	}
	r.URL = url
	// Filter topics/prereqs к allowed set.
	if len(allowed) > 0 {
		set := make(map[string]struct{}, len(allowed))
		for _, id := range allowed {
			set[id] = struct{}{}
		}
		r.TopicsCovered = filterAllowed(r.TopicsCovered, set)
		r.Prereqs = filterAllowed(r.Prereqs, set)
	}
	// Validate — если что-то критическое отсутствует, не бомбим caller'а
	// просто возвращаем resource с TODO-заполнением.
	if r.Why == "" {
		r.Why = "user-curated"
	}
	if !r.Kind.IsValid() {
		r.Kind = domain.KindArticle
	}
	if !r.Level.IsValid() {
		r.Level = domain.LevelB
	}
	if !r.Priority.IsValid() {
		r.Priority = domain.PrioritySupplement
	}
	return r, nil
}

func filterAllowed(in []string, allowed map[string]struct{}) []string {
	out := make([]string, 0, len(in))
	for _, x := range in {
		if _, ok := allowed[x]; ok {
			out = append(out, x)
		}
	}
	return out
}

func stripFences(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "```") {
		nl := strings.Index(s, "\n")
		if nl > 0 {
			s = s[nl+1:]
		}
		if i := strings.LastIndex(s, "```"); i > 0 {
			s = s[:i]
		}
	}
	return strings.TrimSpace(s)
}
