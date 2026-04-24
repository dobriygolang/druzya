// Package infra — LLM adapters for Hone.
//
// Three real adapters + three no-op floors. Caller (monolith wiring) decides
// which to hand to the app layer based on whether llmchain + Ollama are
// configured. Anti-fallback: every "not configured" path returns a typed
// error the transport maps to 503 — we NEVER fabricate AI output.
package infra

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/hone/domain"
	"druz9/shared/pkg/llmcache"
	"druz9/shared/pkg/llmchain"

	"github.com/google/uuid"
)

// ─── Floor adapters (no llmchain) ─────────────────────────────────────────

// NoLLMPlanSynthesiser returns ErrLLMUnavailable on every call. Used when
// llmchain is nil (no provider keys at boot).
type NoLLMPlanSynthesiser struct{}

// NewNoLLMPlanSynthesiser returns the floor adapter.
func NewNoLLMPlanSynthesiser() *NoLLMPlanSynthesiser { return &NoLLMPlanSynthesiser{} }

// Synthesise always returns ErrLLMUnavailable.
func (*NoLLMPlanSynthesiser) Synthesise(_ context.Context, _ uuid.UUID, _ []domain.WeakNode, _ time.Time) ([]domain.PlanItem, error) {
	return nil, fmt.Errorf("hone.NoLLMPlanSynthesiser.Synthesise: %w", domain.ErrLLMUnavailable)
}

// NoLLMCritiqueStreamer returns ErrLLMUnavailable on every call.
type NoLLMCritiqueStreamer struct{}

// NewNoLLMCritiqueStreamer returns the floor adapter.
func NewNoLLMCritiqueStreamer() *NoLLMCritiqueStreamer { return &NoLLMCritiqueStreamer{} }

// Critique always returns ErrLLMUnavailable.
func (*NoLLMCritiqueStreamer) Critique(_ context.Context, _ []byte, _ func(domain.CritiquePacket) error) error {
	return fmt.Errorf("hone.NoLLMCritiqueStreamer.Critique: %w", domain.ErrLLMUnavailable)
}

// NoEmbedder returns ErrEmbeddingUnavailable on every call.
type NoEmbedder struct{}

// NewNoEmbedder returns the floor adapter.
func NewNoEmbedder() *NoEmbedder { return &NoEmbedder{} }

// Embed always returns ErrEmbeddingUnavailable.
func (*NoEmbedder) Embed(_ context.Context, _ string) ([]float32, string, error) {
	return nil, "", fmt.Errorf("hone.NoEmbedder.Embed: %w", domain.ErrEmbeddingUnavailable)
}

// ─── LLMChainPlanSynthesiser ──────────────────────────────────────────────

// LLMChainPlanSynthesiser generates a daily plan via Task=DailyPlanSynthesis.
// Output is strict JSON parsed into []PlanItem. One retry on parse failure;
// second failure surfaces ErrLLMUnavailable so the 503 is honest.
type LLMChainPlanSynthesiser struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainPlanSynthesiser wires the adapter. chain MUST be non-nil — the
// wirer falls back to NoLLMPlanSynthesiser when the chain is nil, never
// constructs this type. Panics enforce that invariant.
func NewLLMChainPlanSynthesiser(chain llmchain.ChatClient, log *slog.Logger) *LLMChainPlanSynthesiser {
	if chain == nil {
		panic("hone.NewLLMChainPlanSynthesiser: chain is required (use NoLLMPlanSynthesiser when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainPlanSynthesiser: logger is required (anti-fallback policy)")
	}
	return &LLMChainPlanSynthesiser{chain: chain, log: log, timeout: 30 * time.Second}
}

// planSynthPrompt is the system prompt. Kept compact — the model just
// needs to know the schema and the "why" axis. Per ChatGPT best practice
// we never say "pretty please" — just the constraint set.
const planSynthPrompt = `You are the daily-plan synthesiser for Hone, a focus cockpit for programmers.

Given a list of the user's weakest skill nodes (by atlas progress), produce 3-5 plan items for today.

Each item MUST be one of these kinds:
  - "solve"  : an algorithmic / design task to work on (target_ref = a task slug like "dsa/bfs-tree")
  - "mock"   : a mock interview (target_ref = a section like "system-design")
  - "review" : a code / PR review to do (target_ref = a PR URL or empty)
  - "read"   : a book / article segment (target_ref = optional URL)
  - "custom" : free-form

Constraints:
  - Prefer "solve" items targeting the weakest node; one per item.
  - Inject a "mock" item only when a weak node's progress is below 40 AND the section suggests a mock would help (system-design, behavioral).
  - subtitle MUST explain the "why" in one short sentence, referencing the weakness.
  - deep_link: for "solve" use "druz9://task/<target_ref>"; for "mock" use "druz9://mock/start?section=<target_ref>"; empty for others.
  - estimated_min: realistic, 15-60 range.

Output EXACTLY this JSON shape, nothing else:
{"items":[{"id":"<short-id>","kind":"solve|mock|review|read|custom","title":"...","subtitle":"...","target_ref":"...","deep_link":"...","estimated_min":25}]}

Return ONLY the JSON object. No prose, no code fences.`

// Synthesise builds the prompt, calls the chain, parses the response.
func (s *LLMChainPlanSynthesiser) Synthesise(ctx context.Context, userID uuid.UUID, weak []domain.WeakNode, date time.Time) ([]domain.PlanItem, error) {
	userMsg := buildPlanUserPrompt(weak, date)

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := s.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskDailyPlanSynthesis,
			JSONMode:    true,
			Temperature: 0.3, // some diversity but reproducible-ish across retries
			MaxTokens:   900,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: planSynthPrompt},
				{Role: llmchain.RoleUser, Content: userMsg},
			},
		})
		if err != nil {
			lastErr = err
			s.log.Warn("hone.LLMChainPlanSynthesiser: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("user_id", userID.String()))
			continue
		}
		items, parseErr := parsePlanJSON(resp.Content)
		if parseErr != nil {
			lastErr = parseErr
			s.log.Warn("hone.LLMChainPlanSynthesiser: parse error",
				slog.Any("err", parseErr), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 200)))
			continue
		}
		// Stamp stable ids — LLM-produced ids collide across regenerations.
		for i := range items {
			if items[i].ID == "" {
				items[i].ID = newPlanItemID()
			}
			items[i].Dismissed = false
			items[i].Completed = false
		}
		return items, nil
	}
	return nil, fmt.Errorf("hone.LLMChainPlanSynthesiser.Synthesise: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

func buildPlanUserPrompt(weak []domain.WeakNode, date time.Time) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Date: %s\n\n", date.Format("2006-01-02"))
	if len(weak) == 0 {
		sb.WriteString("Weakest nodes: none known yet — produce a generic balanced plan (one algo, one system-design read, one review).\n")
		return sb.String()
	}
	sb.WriteString("Weakest skill nodes (progress 0..100, lower = weaker):\n")
	for _, n := range weak {
		fmt.Fprintf(&sb, "  - %s (%s) progress=%d priority=%s\n", n.NodeKey, n.DisplayName, n.Progress, n.Priority)
	}
	return sb.String()
}

// planJSONEnvelope matches the JSON shape the system prompt locks in.
type planJSONEnvelope struct {
	Items []planJSONItem `json:"items"`
}

type planJSONItem struct {
	ID           string `json:"id"`
	Kind         string `json:"kind"`
	Title        string `json:"title"`
	Subtitle     string `json:"subtitle"`
	TargetRef    string `json:"target_ref"`
	DeepLink     string `json:"deep_link"`
	EstimatedMin int    `json:"estimated_min"`
}

func parsePlanJSON(raw string) ([]domain.PlanItem, error) {
	// Some models emit code fences despite instruction; strip defensively.
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)

	var env planJSONEnvelope
	if err := json.Unmarshal([]byte(s), &env); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}
	if len(env.Items) == 0 {
		return nil, errors.New("empty items array")
	}
	out := make([]domain.PlanItem, 0, len(env.Items))
	for _, it := range env.Items {
		kind := domain.PlanItemKind(strings.ToLower(strings.TrimSpace(it.Kind)))
		if !kind.IsValid() {
			// Unknown kind from the model — default to custom rather than
			// dropping the row. The plan remains usable.
			kind = domain.PlanItemCustom
		}
		if it.Title == "" {
			continue // skip degenerate rows
		}
		est := it.EstimatedMin
		if est <= 0 || est > 240 {
			est = 25
		}
		out = append(out, domain.PlanItem{
			ID:           it.ID,
			Kind:         kind,
			Title:        it.Title,
			Subtitle:     it.Subtitle,
			TargetRef:    it.TargetRef,
			DeepLink:     it.DeepLink,
			EstimatedMin: est,
		})
	}
	if len(out) == 0 {
		return nil, errors.New("all items dropped as degenerate")
	}
	return out, nil
}

func newPlanItemID() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// ─── LLMChainCritiqueStreamer ─────────────────────────────────────────────

// LLMChainCritiqueStreamer produces sectioned architectural critique.
//
// MVP impl: non-streaming Chat call, then split response on section markers
// and emit packets sequentially. True token-level streaming per-section is a
// post-MVP nice-to-have — the UX cost of a 2-3s blocking call before the
// first fade-in is acceptable, and the robustness gain (no partial-marker
// mis-classification) is significant.
//
// Prompt forces a "## STRENGTHS / ## CONCERNS / ## MISSING / ## CLOSING"
// format. Parser walks the response line-by-line and attributes each to the
// currently-active section.
type LLMChainCritiqueStreamer struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainCritiqueStreamer wires the adapter.
func NewLLMChainCritiqueStreamer(chain llmchain.ChatClient, log *slog.Logger) *LLMChainCritiqueStreamer {
	if chain == nil {
		panic("hone.NewLLMChainCritiqueStreamer: chain is required")
	}
	if log == nil {
		panic("hone.NewLLMChainCritiqueStreamer: logger is required")
	}
	return &LLMChainCritiqueStreamer{chain: chain, log: log, timeout: 45 * time.Second}
}

const critiquePromptTemplate = `You are a senior system-design interviewer reviewing an architecture diagram.

The user's whiteboard is provided as a tldraw JSON blob below. Infer the architecture from the shapes (rectangles = services, circles = datastores, arrows = flows, text = labels / API paths / replica counts).

Produce a focused critique in EXACTLY four sections, using these headers verbatim:

## STRENGTHS
2-3 short bullet points on what is well-designed.

## CONCERNS
2-3 short bullet points on actual problems with the current design.

## MISSING
2-3 short bullet points on what the design omits (caching, retries, queues, monitoring, etc).

## CLOSING
One paragraph: the single most important thing to fix first, and why.

Be specific. Reference shapes by label ("the api → postgres edge…"). No hedging, no pleasantries. Start the first line with "## STRENGTHS".

Whiteboard JSON:
%s`

// Critique fetches the critique and streams it section-by-section.
func (s *LLMChainCritiqueStreamer) Critique(ctx context.Context, stateJSON []byte, yield func(domain.CritiquePacket) error) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	prompt := fmt.Sprintf(critiquePromptTemplate, string(stateJSON))

	resp, err := s.chain.Chat(ctx, llmchain.Request{
		Task:        llmchain.TaskSysDesignCritique,
		Temperature: 0.4,
		MaxTokens:   1200,
		Messages: []llmchain.Message{
			{Role: llmchain.RoleUser, Content: prompt},
		},
	})
	if err != nil {
		return fmt.Errorf("hone.LLMChainCritiqueStreamer.Critique: chain: %w (%w)", err, domain.ErrLLMUnavailable)
	}

	sections := splitCritiqueBySections(resp.Content)
	if len(sections) == 0 {
		// Model ignored the section format — emit everything under "closing"
		// so the UI still shows something useful. Better than a 503 when the
		// response is actually present, just non-conforming.
		s.log.Warn("hone.LLMChainCritiqueStreamer: no sections detected, falling back to closing-only",
			slog.String("preview", firstN(resp.Content, 200)))
		return emitSingleSection(yield, domain.CritiqueClosing, strings.TrimSpace(resp.Content))
	}
	return emitSections(yield, sections)
}

// sectionBlock is one parsed section.
type sectionBlock struct {
	Section domain.CritiqueSection
	Body    string
}

// splitCritiqueBySections walks the response top-to-bottom, switching section
// on "## <KEYWORD>" lines. Unknown keywords are collapsed into the current
// section (conservative — we never drop content).
func splitCritiqueBySections(s string) []sectionBlock {
	lines := strings.Split(s, "\n")
	var out []sectionBlock
	var current domain.CritiqueSection
	var buf strings.Builder

	flush := func() {
		body := strings.TrimSpace(buf.String())
		if current == "" || body == "" {
			buf.Reset()
			return
		}
		out = append(out, sectionBlock{Section: current, Body: body})
		buf.Reset()
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## ") {
			keyword := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(trimmed, "## ")))
			var next domain.CritiqueSection
			switch {
			case strings.HasPrefix(keyword, "strength"):
				next = domain.CritiqueStrengths
			case strings.HasPrefix(keyword, "concern"):
				next = domain.CritiqueConcerns
			case strings.HasPrefix(keyword, "missing"):
				next = domain.CritiqueMissing
			case strings.HasPrefix(keyword, "closing"):
				next = domain.CritiqueClosing
			}
			if next != "" {
				flush()
				current = next
				continue
			}
		}
		buf.WriteString(line)
		buf.WriteString("\n")
	}
	flush()
	return out
}

// emitSections walks the parsed sections and yields one CritiquePacket per
// section, flagging Done=true on the final packet. Callers typically render
// each packet as a fade-in paragraph.
func emitSections(yield func(domain.CritiquePacket) error, blocks []sectionBlock) error {
	for i, b := range blocks {
		if err := yield(domain.CritiquePacket{
			Section: b.Section,
			Delta:   b.Body,
			Done:    i == len(blocks)-1,
		}); err != nil {
			return err
		}
	}
	return nil
}

func emitSingleSection(yield func(domain.CritiquePacket) error, section domain.CritiqueSection, body string) error {
	return yield(domain.CritiquePacket{
		Section: section,
		Delta:   body,
		Done:    true,
	})
}

// ─── HoneEmbedder (wraps llmcache.OllamaEmbedder) ─────────────────────────

// HoneEmbedder adapts llmcache.OllamaEmbedder to domain.Embedder. The
// underlying client already handles retries, timeouts, and L2 normalisation;
// we just tack on a (model, "") return and a typed ErrEmbeddingUnavailable
// for empty-host config.
type HoneEmbedder struct {
	under *llmcache.OllamaEmbedder
	model string
}

// NewHoneEmbedder constructs the embedder. `host` is the OLLAMA_HOST config
// value; empty host ⇒ nil embedder returned ⇒ caller must use NoEmbedder
// instead. `model` defaults to llmcache.DefaultOllamaEmbedModel when empty.
func NewHoneEmbedder(host, model string) *HoneEmbedder {
	if strings.TrimSpace(host) == "" {
		return nil
	}
	if model == "" {
		model = llmcache.DefaultOllamaEmbedModel
	}
	return &HoneEmbedder{
		under: llmcache.NewOllamaEmbedder(host, model, 0),
		model: model,
	}
}

// Embed delegates to the underlying Ollama client.
func (e *HoneEmbedder) Embed(ctx context.Context, text string) ([]float32, string, error) {
	if e == nil || e.under == nil {
		return nil, "", fmt.Errorf("hone.HoneEmbedder.Embed: %w", domain.ErrEmbeddingUnavailable)
	}
	vec, err := e.under.Embed(ctx, text)
	if err != nil {
		return nil, "", fmt.Errorf("hone.HoneEmbedder.Embed: %w", err)
	}
	return vec, e.model, nil
}

// ── interface guards ──────────────────────────────────────────────────────

var (
	_ domain.PlanSynthesizer  = (*NoLLMPlanSynthesiser)(nil)
	_ domain.PlanSynthesizer  = (*LLMChainPlanSynthesiser)(nil)
	_ domain.CritiqueStreamer = (*NoLLMCritiqueStreamer)(nil)
	_ domain.CritiqueStreamer = (*LLMChainCritiqueStreamer)(nil)
	_ domain.Embedder         = (*NoEmbedder)(nil)
	_ domain.Embedder         = (*HoneEmbedder)(nil)
)
