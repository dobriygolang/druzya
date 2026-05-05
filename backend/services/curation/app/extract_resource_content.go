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
//
// Phase R6 — process-local dedup cache (sha256(URL) → Resource, TTL 7d).
// Cache hit returns Manual=false preview without touching the network or
// LLM. Successful LLM-parsed extractions populate the cache; failures
// skip caching so retries can recover. See extract_cache.go for details.
//
// Phase D3 — true multi-doc batched LLM extraction. ExtractMany now
// (a) consults the dedup cache up-front, (b) parallel-fetches surviving
// URLs (max 3 concurrent goroutines), (c) chunks them into groups of
// extractBatchChunkSize and (d) sends one LLM prompt per chunk that
// returns a JSON array of resources. Per-URL fallback to single-shot
// Do() on parse failure or chunked partial result. Net effect: 12-URL
// seed batches drop from 12 LLM calls to ~3 (4× cost reduction).
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
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
	// Log — optional. When set, cache hits/misses are logged at Debug for
	// admin visibility. Nil-safe (we use a no-op logger when unset).
	Log *slog.Logger
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

// extractBatchItem — internal carrier for one URL through the
// ExtractMany batch pipeline. `idx` keeps the original input position so
// per-URL outputs land in the right slot of the result slice; `fetched`
// holds the fetcher result (so we can pack body excerpts into the LLM
// prompt and surface FetchInfo back to the caller).
type extractBatchItem struct {
	idx     int
	url     string
	fetched curation.FetchResult
}

// extractBatchChunkSize — number of URLs packed into a single LLM prompt.
// Five fits comfortably under the 800-token MaxTokens budget per element
// (5 × ~150 tokens of structured JSON + the source excerpts trimmed to
// 500 chars each = ~6KB request, ~4KB response). Larger chunks risk
// truncation; smaller chunks waste the per-call overhead.
const extractBatchChunkSize = 5

// extractBatchFetchConcurrency — upper bound on goroutines making
// outbound HTTP at once. Three is conservative — the fetcher already
// has a 5s per-request timeout and we don't want to slam any single
// host or starve the rest of the process.
const extractBatchFetchConcurrency = 3

// extractBatchExcerptChars — body excerpt length per URL packed into
// the batch prompt. 500 chars × 5 URLs = 2500 chars of source content
// per call, well under any provider's context window even after the
// system prompt and structured shape.
const extractBatchExcerptChars = 500

// extractBatchBodyTokensPerURL — MaxTokens budget allocated per URL in
// a batch call. Each Resource JSON shape is ~150 tokens; we buffer to
// 250 to absorb verbose summaries and field padding.
const extractBatchBodyTokensPerURL = 250

func (uc *ExtractResourceContent) Do(ctx context.Context, in ExtractInput) (ExtractOutput, error) {
	if strings.TrimSpace(in.URL) == "" {
		return ExtractOutput{}, fmt.Errorf("curation.ExtractResourceContent: empty url")
	}

	// Phase R6 — dedup cache. Hot URLs (popular blog posts, course
	// landing pages, GH repos, batch retries) get served from memory
	// without any network or LLM cost.
	cacheKey := in.CacheKey()
	if cached, ok := globalExtractCache.get(cacheKey); ok {
		if log := uc.logger(); log != nil {
			log.Debug("curation.ExtractResourceContent: cache hit",
				slog.String("url", in.URL), slog.String("key", cacheKey))
		}
		return ExtractOutput{
			Preview:   cached,
			Manual:    false,
			FetchInfo: curation.FetchResult{URL: in.URL, Strategy: "cache", ExtractedAt: time.Now().UTC()},
		}, nil
	}
	if log := uc.logger(); log != nil {
		log.Debug("curation.ExtractResourceContent: cache miss",
			slog.String("url", in.URL), slog.String("key", cacheKey))
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
	// Cache the successful LLM extraction. Failures (manual=true) skip
	// caching so the next attempt can recover.
	globalExtractCache.set(cacheKey, parsed)
	return out, nil
}

// logger — nil-safe accessor for the optional UC logger.
func (uc *ExtractResourceContent) logger() *slog.Logger {
	if uc == nil || uc.Log == nil {
		return nil
	}
	return uc.Log
}

// ExtractMany — Phase D3 true multi-doc batched extraction. Returns one
// ExtractOutput per input URL, in input order. Pipeline:
//
//  1. Cache lookup — every URL already in the dedup cache shortcuts to
//     Manual=false output with FetchResult{Strategy:"cache"}. Surviving
//     URLs proceed to the network stage.
//  2. Parallel fetch — surviving URLs fetched concurrently with a hard
//     cap of extractBatchFetchConcurrency goroutines. Empty-body fetches
//     (404, timeout, etc.) collapse to Manual=true outputs and are
//     dropped from the LLM stage.
//  3. Chunked LLM — survivors with non-empty bodies are partitioned into
//     groups of extractBatchChunkSize and each group is one LLM call
//     returning a JSON array. Successful per-URL parses populate the
//     cache and the result slot. Any URL the batch failed to cover (LLM
//     error, parse failure, missing slot in the array) falls back to a
//     single-shot Do() call so the caller still gets a real preview.
//
// Per-URL fail-soft: empty input slots become zero-value Outputs, never
// errors. Caller-visible errors are reserved for hard programmer mistakes
// (currently none in this signature). Net cost: N URLs collapse to
// roughly ⌈N_uncached_with_body / extractBatchChunkSize⌉ LLM calls plus
// N parallel fetches.
func (uc *ExtractResourceContent) ExtractMany(ctx context.Context, urls []string, allowedAtlasNodeIDs []string) ([]ExtractOutput, error) {
	out := make([]ExtractOutput, len(urls))
	if len(urls) == 0 {
		return out, nil
	}

	// 1) Cache pass and pending-list build.
	type pending struct {
		idx int    // original position in urls
		url string // trimmed URL
	}
	pendings := make([]pending, 0, len(urls))
	for i, raw := range urls {
		url := strings.TrimSpace(raw)
		if url == "" {
			// Empty slot stays zero-value; preserves index alignment.
			continue
		}
		key := ExtractInput{URL: url}.CacheKey()
		if cached, ok := globalExtractCache.get(key); ok {
			if log := uc.logger(); log != nil {
				log.Debug("curation.ExtractMany: cache hit",
					slog.String("url", url), slog.String("key", key))
			}
			out[i] = ExtractOutput{
				Preview:   cached,
				Manual:    false,
				FetchInfo: curation.FetchResult{URL: url, Strategy: "cache", ExtractedAt: time.Now().UTC()},
			}
			continue
		}
		pendings = append(pendings, pending{idx: i, url: url})
	}

	if len(pendings) == 0 {
		return out, nil
	}

	// If we have no LLM, skip the batched path entirely — Do() will
	// fail-soft to Manual=true with the fetched title. Falling back per
	// URL keeps behaviour identical to the pre-D3 implementation when
	// chain is unwired.
	if uc.Chain == nil {
		for _, p := range pendings {
			o, _ := uc.Do(ctx, ExtractInput{URL: p.url, AtlasNodeIDs: allowedAtlasNodeIDs})
			out[p.idx] = o
		}
		return out, nil
	}

	// 2) Parallel fetch with bounded concurrency. We don't fan out past
	// extractBatchFetchConcurrency to avoid hammering the same host or
	// starving the rest of the process; the fetcher already enforces a
	// 5s per-request budget so the overall fetch stage is bounded.
	fetchOut := make([]extractBatchItem, len(pendings))
	sem := make(chan struct{}, extractBatchFetchConcurrency)
	var wg sync.WaitGroup
	for i, p := range pendings {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, p pending) {
			defer wg.Done()
			defer func() { <-sem }()
			res := uc.Fetcher.Fetch(ctx, p.url)
			fetchOut[i] = extractBatchItem{idx: p.idx, url: p.url, fetched: res}
		}(i, p)
	}
	wg.Wait()

	// 3) Partition fetched items into LLM-eligible (non-empty body) vs
	// fetcher-fail. Fetcher-fail items collapse to Manual=true outputs
	// directly and are NOT batched.
	llmEligible := make([]extractBatchItem, 0, len(fetchOut))
	for _, fi := range fetchOut {
		if fi.fetched.Body == "" {
			out[fi.idx] = ExtractOutput{
				Preview:   domain.Resource{URL: fi.url, Title: fi.fetched.Title},
				Manual:    true,
				FetchInfo: fi.fetched,
			}
			continue
		}
		llmEligible = append(llmEligible, fi)
	}

	if len(llmEligible) == 0 {
		return out, nil
	}

	// 4) Chunk and dispatch. We process chunks sequentially — the LLM
	// stage is already amortised across N URLs per call, and serialising
	// keeps free-tier provider rate-limits happy (groq 30 RPM ceiling).
	timeout := uc.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second // batch chunks need more headroom than single-shot
	}
	for start := 0; start < len(llmEligible); start += extractBatchChunkSize {
		end := start + extractBatchChunkSize
		if end > len(llmEligible) {
			end = len(llmEligible)
		}
		chunk := llmEligible[start:end]
		uc.runBatchChunk(ctx, chunk, allowedAtlasNodeIDs, timeout, out)
	}
	return out, nil
}

// runBatchChunk sends one LLM call for the given chunk and writes
// per-URL outputs into `out` at the original input indices. Any URL the
// batch failed to cover (LLM error, JSON parse failure, missing slot)
// falls back to a single-shot Do() call so the caller still gets a real
// preview — at the cost of one extra LLM call per fallback URL.
func (uc *ExtractResourceContent) runBatchChunk(
	parentCtx context.Context,
	chunk []extractBatchItem,
	allowedAtlasNodeIDs []string,
	timeout time.Duration,
	out []ExtractOutput,
) {
	if len(chunk) == 0 {
		return
	}

	// Build batched prompt and call LLM with a generous MaxTokens scaled
	// to the chunk size. We never write a partial response on error —
	// instead each URL falls back to single-shot Do().
	prompt := buildExtractBatchPrompt(chunk, allowedAtlasNodeIDs)
	maxTokens := extractBatchBodyTokensPerURL * len(chunk)
	if maxTokens < 800 {
		maxTokens = 800
	}

	ctx, cancel := context.WithTimeout(parentCtx, timeout)
	resp, err := uc.Chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskExtractResourceContent,
		JSONMode:    true,
		Temperature: 0.2,
		MaxTokens:   maxTokens,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleSystem, Content: extractBatchSystemPrompt},
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	cancel()
	if err != nil {
		if log := uc.logger(); log != nil {
			log.Debug("curation.ExtractMany: batch LLM error, falling back per-URL",
				slog.Int("chunk_size", len(chunk)), slog.String("err", err.Error()))
		}
		uc.fallbackChunk(parentCtx, chunk, allowedAtlasNodeIDs, out)
		return
	}

	// Parse the array. Each element is matched back to its URL via the
	// "url" field; we DO NOT trust positional ordering since the LLM
	// occasionally drops or reshuffles items.
	parsedByURL, perr := parseExtractedBatch(resp.Content, allowedAtlasNodeIDs)
	if perr != nil {
		if log := uc.logger(); log != nil {
			log.Debug("curation.ExtractMany: batch parse error, falling back per-URL",
				slog.Int("chunk_size", len(chunk)), slog.String("err", perr.Error()))
		}
		uc.fallbackChunk(parentCtx, chunk, allowedAtlasNodeIDs, out)
		return
	}

	// Fan results back into the output slice. URLs missing from the
	// batch response fall back to single-shot Do() — this keeps the
	// "12 nodes → 3 calls" promise even when the LLM drops a row.
	missing := make([]extractBatchItem, 0)
	for _, item := range chunk {
		parsed, ok := parsedByURL[item.url]
		if !ok {
			missing = append(missing, item)
			continue
		}
		parsed.URL = item.url // defensive — LLM should echo, but force.
		out[item.idx] = ExtractOutput{
			Preview:   parsed,
			Manual:    false,
			FetchInfo: item.fetched,
		}
		// Cache the successful LLM extraction.
		globalExtractCache.set(ExtractInput{URL: item.url}.CacheKey(), parsed)
	}
	if len(missing) > 0 {
		if log := uc.logger(); log != nil {
			log.Debug("curation.ExtractMany: batch returned partial, fallback for missing",
				slog.Int("missing", len(missing)), slog.Int("chunk_size", len(chunk)))
		}
		uc.fallbackChunk(parentCtx, missing, allowedAtlasNodeIDs, out)
	}
}

// fallbackChunk runs Do() per URL for a chunk slice (LLM error or
// per-URL miss in the batch response). Each call pays the full single-
// shot cost (~1 LLM round-trip), bounded by len(chunk). Cache writes
// happen inside Do().
func (uc *ExtractResourceContent) fallbackChunk(
	ctx context.Context,
	chunk []extractBatchItem,
	allowedAtlasNodeIDs []string,
	out []ExtractOutput,
) {
	for _, item := range chunk {
		o, err := uc.Do(ctx, ExtractInput{URL: item.url, AtlasNodeIDs: allowedAtlasNodeIDs})
		if err != nil {
			out[item.idx] = ExtractOutput{
				Preview:   domain.Resource{URL: item.url, Title: item.fetched.Title},
				Manual:    true,
				FetchInfo: item.fetched,
			}
			continue
		}
		out[item.idx] = o
	}
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
- Priority: core (must), supplement (deepens), optional.
- Skip fields you cannot determine — use empty string / 0 / [].`

// extractBatchSystemPrompt — multi-doc variant. Identical schema per
// element but wrapped in a JSON array. The "url" field is mandatory per
// element so the parser can match results back to the input URLs even
// if the LLM drops or reshuffles rows.
const extractBatchSystemPrompt = `You extract structured metadata for MULTIPLE web resources at once for druz9, a senior developer learning platform.

Output strict JSON ARRAY ONLY (no markdown, no commentary). One element per input URL. Each element MUST include the original "url" field verbatim so the caller can match results back:
[
  {
    "url": "<original url, copied verbatim from the input list>",
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
  },
  ...
]

Rules:
- Return exactly ONE element per input URL, preserving the "url" field verbatim.
- Use ONLY atlas_node_ids from the provided list. Empty arrays allowed.
- Level: A=entry, B=middle, C=senior/staff, D=research.
- Priority: core (must), supplement (deepens), optional.
- Skip fields you cannot determine — use empty string / 0 / [].
- DO NOT merge or summarise across resources — each gets its own object.`

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

// buildExtractBatchPrompt assembles the multi-doc user prompt. Each URL
// gets a numbered header plus a body excerpt capped at
// extractBatchExcerptChars; this keeps the prompt under ~5KB total even
// for the maximum chunk size.
func buildExtractBatchPrompt(chunk []extractBatchItem, allowedAtlasNodeIDs []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Extract metadata for these %d URLs. Return ONE JSON array element per URL.\n\n", len(chunk))

	b.WriteString("URLs:\n")
	for i, item := range chunk {
		fmt.Fprintf(&b, "%d. %s\n", i+1, item.url)
	}
	b.WriteString("\nSource content (one block per URL):\n")
	for i, item := range chunk {
		body := item.fetched.Body
		if len(body) > extractBatchExcerptChars {
			body = body[:extractBatchExcerptChars] + "…"
		}
		title := item.fetched.Title
		if title == "" {
			title = "(no title)"
		}
		fmt.Fprintf(&b, "\n--- URL %d: %s ---\nTitle: %s\nBody: %s\n", i+1, item.url, title, body)
	}
	if len(allowedAtlasNodeIDs) > 0 {
		fmt.Fprintf(&b, "\nALLOWED atlas_node_ids: %s\n", strings.Join(allowedAtlasNodeIDs, ", "))
	}
	b.WriteString("\nReturn JSON array only — exactly one element per URL above, with the original \"url\" field copied verbatim.")
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

// parseExtractedBatch parses a JSON array of resources into a map keyed
// by URL (the "url" field carried verbatim from the prompt). Returns
// error only when the outer array fails to parse — partial results are
// fine; the caller will fall back per-URL for any missing entries.
func parseExtractedBatch(raw string, allowed []string) (map[string]domain.Resource, error) {
	cleaned := stripFences(raw)
	// Some providers wrap the array in {"items": [...]} despite the
	// instruction; try plain array first then a one-key object.
	var arr []domain.Resource
	if err := json.Unmarshal([]byte(cleaned), &arr); err != nil {
		var wrap map[string]json.RawMessage
		if werr := json.Unmarshal([]byte(cleaned), &wrap); werr == nil {
			for _, raw := range wrap {
				if uerr := json.Unmarshal(raw, &arr); uerr == nil && len(arr) > 0 {
					break
				}
			}
		}
		if len(arr) == 0 {
			return nil, fmt.Errorf("batch unmarshal: %w", err)
		}
	}

	allowedSet := make(map[string]struct{}, len(allowed))
	for _, id := range allowed {
		allowedSet[id] = struct{}{}
	}

	out := make(map[string]domain.Resource, len(arr))
	for _, r := range arr {
		url := strings.TrimSpace(r.URL)
		if url == "" {
			// Unmatchable — drop. Caller falls back for the missing slot.
			continue
		}
		if len(allowedSet) > 0 {
			r.TopicsCovered = filterAllowed(r.TopicsCovered, allowedSet)
			r.Prereqs = filterAllowed(r.Prereqs, allowedSet)
		}
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
		r.URL = url
		out[url] = r
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("batch parse: zero usable elements")
	}
	return out, nil
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
