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
	"slices"
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
func (*NoLLMPlanSynthesiser) Synthesise(_ context.Context, _ uuid.UUID, _ []domain.WeakNode, _ []domain.ChronicSkill, _ domain.TodayContext, _ time.Time) ([]domain.PlanItem, error) {
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
  - Do NOT invent a generic balanced plan. Every item must be grounded in an input weak node or chronic skip.
  - NEVER write generic titles such as "Solve a basic algorithmic problem", "Practice algorithms", "Do system design", "Review your notes", or "Start with the first item".
  - Do not repeat the same action/topic with minor wording changes.
  - If the user prompt includes "Today's note context", prioritize it over generic skill coverage: use the user's intent, blockers, and action hints as today's plan anchor.
  - If Today's blockers are present, include one tiny unblock item that attacks the blocker directly.
  - Prefer "solve" items targeting the weakest node; one per item.
  - Inject a "mock" item only when a weak node's progress is below 40 AND the section suggests a mock would help (system-design, behavioral).
  - subtitle MUST explain the "why" in one short sentence, referencing the weakness.
  - rationale: SECOND explanatory line aimed at motivation — reference the specific skill gap and the current progress number. 6-12 words. Example: "Closes your System Design gap (progress=28 — lowest in atlas)." Leave empty for "review" / "custom" items not tied to a skill node.
  - skill_key: MUST match the input node_key when the item targets a weak node (e.g. "algo.bfs"). Empty for "review" / "custom" items.
  - deep_link: for "solve" use "druz9://task/<target_ref>"; for "mock" use "druz9://mock/start?section=<target_ref>"; empty for others.
  - estimated_min: realistic, 15-60 range.

Resistance handling (CRITICAL):
  - The user prompt MAY include a "Chronic skips" section listing skills that have been dismissed multiple times recently.
  - For EACH chronic skill, you MUST produce ONE item that either:
      (a) breaks the topic into the smallest possible concrete sub-task (prefix title with "tiny: "; estimated_min=15), OR
      (b) replaces it with a reflection prompt — kind="custom", title="Why are you avoiding <skill>?", subtitle="Notice the resistance, name it. 2-minute write-up.", estimated_min=10, target_ref="", deep_link="".
  - Pick (a) when the skill has a clear atomic sub-task; (b) when the user has skipped it 3+ times and small tasks haven't worked.
  - Set skill_key to the chronic skill's key for both (a) and (b).

Output EXACTLY this JSON shape, nothing else:
{"items":[{"id":"<short-id>","kind":"solve|mock|review|read|custom","title":"...","subtitle":"...","rationale":"...","skill_key":"...","target_ref":"...","deep_link":"...","estimated_min":25}]}

Return ONLY the JSON object. No prose, no code fences.`

// Synthesise builds the prompt, calls the chain, parses the response.
func (s *LLMChainPlanSynthesiser) Synthesise(ctx context.Context, userID uuid.UUID, weak []domain.WeakNode, chronic []domain.ChronicSkill, today domain.TodayContext, date time.Time) ([]domain.PlanItem, error) {
	userMsg := buildPlanUserPrompt(weak, chronic, today, date)

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

func buildPlanUserPrompt(weak []domain.WeakNode, chronic []domain.ChronicSkill, today domain.TodayContext, date time.Time) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Date: %s\n\n", date.Format("2006-01-02"))
	if len(weak) == 0 {
		sb.WriteString("Weakest nodes: none known. Do not invent generic work; return {\"items\":[]} unless Chronic skips or Today's note context below provide concrete signals.\n")
	} else {
		sb.WriteString("Weakest skill nodes (progress 0..100, lower = weaker):\n")
		for _, n := range weak {
			fmt.Fprintf(&sb, "  - %s (%s) progress=%d priority=%s\n", n.NodeKey, n.DisplayName, n.Progress, n.Priority)
		}
	}
	if len(chronic) > 0 {
		sb.WriteString("\nChronic skips — skills dismissed repeatedly. For EACH of these you MUST include a tiny-task OR reflection-prompt item (see system prompt Resistance handling):\n")
		for _, c := range chronic {
			fmt.Fprintf(&sb, "  - %s skipped %d times (last: %s)\n", c.SkillKey, c.SkipCount, c.LastSkip.Format("2006-01-02"))
		}
	}
	if hasPlanTodayContextSignal(today) {
		sb.WriteString("\nToday's note context — user-authored, highest priority for today's plan:\n")
		if today.Intent != "" {
			fmt.Fprintf(&sb, "  intent: %q\n", today.Intent)
		}
		if len(today.Blockers) > 0 {
			sb.WriteString("  blockers:\n")
			for _, blocker := range today.Blockers {
				fmt.Fprintf(&sb, "    - %q\n", blocker)
			}
		}
		if len(today.ActionHints) > 0 {
			sb.WriteString("  action_hints:\n")
			for _, hint := range today.ActionHints {
				fmt.Fprintf(&sb, "    - %q\n", hint)
			}
		}
		if len(today.Topics) > 0 {
			fmt.Fprintf(&sb, "  topics: %s\n", strings.Join(today.Topics, ", "))
		}
		if today.Excerpt != "" {
			fmt.Fprintf(&sb, "  excerpt: %q\n", firstN(today.Excerpt, 300))
		}
	}
	return sb.String()
}

func hasPlanTodayContextSignal(today domain.TodayContext) bool {
	return today.Intent != "" || len(today.Blockers) > 0 || len(today.Topics) > 0 || len(today.ActionHints) > 0
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
	Rationale    string `json:"rationale"`
	SkillKey     string `json:"skill_key"`
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
	seen := make(map[string]struct{}, len(env.Items))
	for _, it := range env.Items {
		kind := domain.PlanItemKind(strings.ToLower(strings.TrimSpace(it.Kind)))
		if !kind.IsValid() {
			// Unknown kind from the model — default to custom rather than
			// dropping the row. The plan remains usable.
			kind = domain.PlanItemCustom
		}
		title := strings.TrimSpace(it.Title)
		if title == "" {
			continue // skip degenerate rows
		}
		if isGenericPlanTitle(title) {
			continue
		}
		key := planTitleKey(title)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		est := it.EstimatedMin
		if est <= 0 || est > 240 {
			est = 25
		}
		out = append(out, domain.PlanItem{
			ID:           it.ID,
			Kind:         kind,
			Title:        title,
			Subtitle:     it.Subtitle,
			Rationale:    strings.TrimSpace(it.Rationale),
			SkillKey:     strings.TrimSpace(it.SkillKey),
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

func isGenericPlanTitle(title string) bool {
	s := strings.ToLower(strings.TrimSpace(title))
	generic := []string{
		"solve a basic algorithmic problem",
		"solve an algorithmic problem",
		"basic algorithmic problem",
		"practice algorithms",
		"work on algorithms",
		"do system design",
		"review your notes",
		"start with the first item",
		"first item in the queue",
	}
	return slices.ContainsFunc(generic, func(phrase string) bool { return strings.Contains(s, phrase) })
}

func planTitleKey(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	s = strings.NewReplacer(
		"ё", "е",
		".", " ",
		",", " ",
		":", " ",
		";", " ",
		"!", " ",
		"?", " ",
		"—", " ",
		"-", " ",
		"\"", " ",
		"'", " ",
	).Replace(s)
	return strings.Join(strings.Fields(s), " ")
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

// ─── Reading summary grader (Wave 4.3) ────────────────────────────────────

// NoLLMSummaryGrader is the floor adapter. EndReadingSession treats its
// error as best-effort, so this just punts the work — the session is
// still saved with summary_md, ai_summary_score stays NULL.
type NoLLMSummaryGrader struct{}

// NewNoLLMSummaryGrader returns the floor adapter.
func NewNoLLMSummaryGrader() *NoLLMSummaryGrader { return &NoLLMSummaryGrader{} }

// GradeSummary always returns ErrLLMUnavailable.
func (*NoLLMSummaryGrader) GradeSummary(_ context.Context, _ domain.GradeSummaryInput) (int, error) {
	return 0, fmt.Errorf("hone.NoLLMSummaryGrader.GradeSummary: %w", domain.ErrLLMUnavailable)
}

// LLMChainSummaryGrader uses llmchain Task=HoneSummaryGrade. Single
// JSON-mode call; we read out the score, ignore the feedback (UI shows
// just the number for MVP, feedback can be surfaced later).
type LLMChainSummaryGrader struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainSummaryGrader wires the adapter. Same nil-policy as the
// other LLM adapters: chain MUST be non-nil; the wirer falls back to
// NoLLMSummaryGrader at boot when no providers are configured.
func NewLLMChainSummaryGrader(chain llmchain.ChatClient, log *slog.Logger) *LLMChainSummaryGrader {
	if chain == nil {
		panic("hone.NewLLMChainSummaryGrader: chain is required (use NoLLMSummaryGrader when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainSummaryGrader: logger is required (anti-fallback policy)")
	}
	return &LLMChainSummaryGrader{chain: chain, log: log, timeout: 12 * time.Second}
}

// summaryGradePrompt — ground rules for the model. Compact: tell it
// what we're scoring on, lock the JSON shape, refuse fabrication.
const summaryGradePrompt = `You are a strict but fair reading-comprehension grader.

Inputs:
- TITLE: chapter / article title.
- BODY: the full chapter / article text the user just read.
- SUMMARY: what the user wrote about it.

Score the summary 0..100 on three axes (weight equally):
  1. Coverage — does it mention the key claims, characters, or arguments of BODY?
  2. Accuracy — does every statement actually hold up against BODY?
  3. Non-fabrication — penalize hard for content the user invented (-30+ if egregious).

A vague but accurate summary scores ~50–60.
A detailed and accurate summary scores 80–95.
An empty or off-topic summary scores 0–20.
A summary that contains fabrications loses points proportional to severity.

Return ONLY this JSON (no prose around it):
{"score": <integer 0..100>, "feedback": "<one short sentence>"}`

// gradeJSONEnvelope — wire shape returned by the model.
type gradeJSONEnvelope struct {
	Score    int    `json:"score"`
	Feedback string `json:"feedback"`
}

// GradeSummary calls the chain. Truncates BODY to ~16 KB so a giant
// chapter doesn't blow the model's context window — the first chunk is
// usually enough for grading the user's high-level summary; if a future
// version wants per-section grading we'll chunk + map-reduce.
func (g *LLMChainSummaryGrader) GradeSummary(ctx context.Context, in domain.GradeSummaryInput) (int, error) {
	body := strings.TrimSpace(in.BodyMD)
	if len(body) > 16_000 {
		body = body[:16_000] + "\n…[truncated]"
	}
	summary := strings.TrimSpace(in.Summary)
	if summary == "" {
		return 0, fmt.Errorf("hone.LLMChainSummaryGrader.GradeSummary: empty summary")
	}
	user := fmt.Sprintf("TITLE: %s\n\nBODY:\n%s\n\nSUMMARY:\n%s", in.Title, body, summary)

	ctx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := g.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskHoneSummaryGrade,
			JSONMode:    true,
			Temperature: 0.2,
			MaxTokens:   180,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: summaryGradePrompt},
				{Role: llmchain.RoleUser, Content: user},
			},
		})
		if err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainSummaryGrader: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		var env gradeJSONEnvelope
		if err := json.Unmarshal([]byte(strings.TrimSpace(resp.Content)), &env); err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainSummaryGrader: parse error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 200)))
			continue
		}
		if env.Score < 0 {
			env.Score = 0
		}
		if env.Score > 100 {
			env.Score = 100
		}
		return env.Score, nil
	}
	return 0, fmt.Errorf("hone.LLMChainSummaryGrader.GradeSummary: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// ─── Writing feedback grader (Wave 4.4) ───────────────────────────────────

// NoLLMWritingGrader is the floor adapter. Use case treats the error
// as user-facing 503; we don't fabricate writing feedback under any
// circumstance.
type NoLLMWritingGrader struct{}

// NewNoLLMWritingGrader returns the floor adapter.
func NewNoLLMWritingGrader() *NoLLMWritingGrader { return &NoLLMWritingGrader{} }

// GradeWriting always returns ErrLLMUnavailable.
func (*NoLLMWritingGrader) GradeWriting(_ context.Context, _ domain.GradeWritingInput) (domain.WritingFeedback, error) {
	return domain.WritingFeedback{}, fmt.Errorf("hone.NoLLMWritingGrader.GradeWriting: %w", domain.ErrLLMUnavailable)
}

// LLMChainWritingGrader uses llmchain Task=HoneWritingFeedback. Strict
// JSON envelope is enforced server-side; malformed responses retry once
// and then surface as a typed error.
type LLMChainWritingGrader struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainWritingGrader wires the adapter. Same nil-policy as the
// other LLM adapters.
func NewLLMChainWritingGrader(chain llmchain.ChatClient, log *slog.Logger) *LLMChainWritingGrader {
	if chain == nil {
		panic("hone.NewLLMChainWritingGrader: chain is required (use NoLLMWritingGrader when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainWritingGrader: logger is required (anti-fallback policy)")
	}
	return &LLMChainWritingGrader{chain: chain, log: log, timeout: 18 * time.Second}
}

// writingFeedbackPrompt — locks the JSON shape and the rubric.
const writingFeedbackPrompt = `You are an English writing tutor. The user is a non-native speaker working on their fluency.

You receive their TEXT (and optionally a TITLE describing what the piece is about).

Return a flat list of CONCRETE issues — every entry must:
  - excerpt:     verbatim slice of TEXT the issue applies to (max ~80 chars; keep it tight)
  - category:    one of "grammar", "vocab", "style", "clarity"
  - suggestion:  the proposed fix as a complete drop-in replacement
  - explanation: ONE short sentence explaining why (≤ 18 words)

Rules:
  - Skip subjective rewrites — only flag things that are wrong or notably off.
  - DO NOT invent or paraphrase the excerpt. Copy verbatim.
  - If a sentence has multiple unrelated issues, emit multiple entries.
  - Stop at ~10 issues even if more exist; pick the most impactful ones.
  - If the text is already strong, return an empty issues array.

Also produce overall_score (0..100): 80+ for strong, 50-79 for OK, <50 for needs work.

Output ONLY this JSON (no prose, no markdown fences):
{"overall_score": <int>, "issues": [{"excerpt":"...", "category":"...", "suggestion":"...", "explanation":"..."}, ...]}`

// writingFeedbackEnvelope — wire shape from the model.
type writingFeedbackEnvelope struct {
	OverallScore int                       `json:"overall_score"`
	Issues       []writingFeedbackIssueRaw `json:"issues"`
}

type writingFeedbackIssueRaw struct {
	Excerpt     string `json:"excerpt"`
	Category    string `json:"category"`
	Suggestion  string `json:"suggestion"`
	Explanation string `json:"explanation"`
}

// GradeWriting calls the chain, parses, sanitises. Caps text at 12 KB
// — that's ~2000 words, more than any reasonable «short essay» Hone
// targets. Past that the latency budget breaks anyway.
func (g *LLMChainWritingGrader) GradeWriting(ctx context.Context, in domain.GradeWritingInput) (domain.WritingFeedback, error) {
	text := strings.TrimSpace(in.Text)
	if text == "" {
		return domain.WritingFeedback{}, fmt.Errorf("hone.LLMChainWritingGrader.GradeWriting: empty text")
	}
	if len(text) > 12_000 {
		text = text[:12_000] + "\n…[truncated]"
	}
	var user string
	if title := strings.TrimSpace(in.Title); title != "" {
		user = "TITLE: " + title + "\n\nTEXT:\n" + text
	} else {
		user = "TEXT:\n" + text
	}

	ctx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := g.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskHoneWritingFeedback,
			JSONMode:    true,
			Temperature: 0.2,
			MaxTokens:   1100,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: writingFeedbackPrompt},
				{Role: llmchain.RoleUser, Content: user},
			},
		})
		if err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainWritingGrader: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		var env writingFeedbackEnvelope
		if err := json.Unmarshal([]byte(strings.TrimSpace(resp.Content)), &env); err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainWritingGrader: parse error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 240)))
			continue
		}
		return sanitiseWritingFeedback(env), nil
	}
	return domain.WritingFeedback{}, fmt.Errorf("hone.LLMChainWritingGrader.GradeWriting: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// sanitiseWritingFeedback clamps the score, drops obviously-broken
// entries (empty excerpt or empty suggestion), and coerces unknown
// categories to "style". Soft-fail philosophy — we'd rather show 7
// good issues than refuse the whole batch over one malformed entry.
func sanitiseWritingFeedback(env writingFeedbackEnvelope) domain.WritingFeedback {
	score := env.OverallScore
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	out := domain.WritingFeedback{OverallScore: score}
	for _, raw := range env.Issues {
		excerpt := strings.TrimSpace(raw.Excerpt)
		suggestion := strings.TrimSpace(raw.Suggestion)
		if excerpt == "" || suggestion == "" {
			continue
		}
		cat := domain.WritingIssueCategory(strings.ToLower(strings.TrimSpace(raw.Category)))
		if !cat.IsValid() {
			cat = domain.WritingIssueStyle
		}
		out.Issues = append(out.Issues, domain.WritingIssue{
			Excerpt:     excerpt,
			Category:    cat,
			Suggestion:  suggestion,
			Explanation: strings.TrimSpace(raw.Explanation),
		})
		// Defensive cap — even if the model ignored the prompt's «~10 max».
		if len(out.Issues) >= 20 {
			break
		}
	}
	return out
}

// ─── Code review grader (Wave 3.6) ────────────────────────────────────────

// NoLLMCodeReviewGrader returns ErrLLMUnavailable on every call. Use
// case treats the error as user-facing 503 (same convention as the
// writing grader); we never fabricate a review grade.
type NoLLMCodeReviewGrader struct{}

// NewNoLLMCodeReviewGrader returns the floor adapter.
func NewNoLLMCodeReviewGrader() *NoLLMCodeReviewGrader { return &NoLLMCodeReviewGrader{} }

// GradeReview always returns ErrLLMUnavailable.
func (*NoLLMCodeReviewGrader) GradeReview(_ context.Context, _ domain.GradeCodeReviewInput) (domain.CodeReviewFeedback, error) {
	return domain.CodeReviewFeedback{}, fmt.Errorf("hone.NoLLMCodeReviewGrader.GradeReview: %w", domain.ErrLLMUnavailable)
}

// LLMChainCodeReviewGrader uses llmchain Task=HoneCodeReviewGrade.
// 70B-class providers (see task_map.go) — comparing a review to a diff
// is a reasoning task, not pattern matching.
type LLMChainCodeReviewGrader struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainCodeReviewGrader wires the adapter. Same nil-policy as the
// other LLM adapters.
func NewLLMChainCodeReviewGrader(chain llmchain.ChatClient, log *slog.Logger) *LLMChainCodeReviewGrader {
	if chain == nil {
		panic("hone.NewLLMChainCodeReviewGrader: chain is required (use NoLLMCodeReviewGrader when nil)")
	}
	if log == nil {
		panic("hone.NewLLMChainCodeReviewGrader: logger is required (anti-fallback policy)")
	}
	// Larger time budget than writing feedback — reasoning over a diff
	// is slower than spotting grammar mistakes.
	return &LLMChainCodeReviewGrader{chain: chain, log: log, timeout: 28 * time.Second}
}

// codeReviewPrompt — locks the JSON shape and the rubric. Note the
// asymmetry vs writing-feedback: completeness issues won't have an
// excerpt (the reviewer didn't write anything for that gap).
const codeReviewPrompt = `You are a senior engineer mentoring a junior reviewer. They've written a code review for a diff; grade their review.

Inputs you receive:
  - PR_TITLE  (optional) — what the PR claims to do.
  - DIFF      — the unified diff being reviewed.
  - REVIEW    — the user's review write-up.

Score the REVIEW 0..100 across:
  1. Correctness — every technical claim must hold up against DIFF. Subtract heavily for confidently-wrong statements.
  2. Completeness — did they catch the obvious bugs / missing tests / unsafe ops in DIFF?
  3. Clarity — comments must be specific (line refs / function names) rather than hand-wavy.
  4. Tone — comments must be respectful and constructive. No patronising / blame language.

Then emit a flat list of issues — every entry MUST have:
  - excerpt:     verbatim slice of REVIEW the issue applies to (max ~120 chars). EMPTY string allowed only when category == "completeness" (the reviewer didn't write anything for that gap).
  - category:    one of "correctness", "completeness", "clarity", "tone".
  - suggestion:  the proposed fix as a complete drop-in replacement (or, for completeness, the comment they SHOULD have written).
  - explanation: ONE short sentence explaining why (≤ 22 words).

Rules:
  - DO NOT invent or paraphrase the excerpt. Copy verbatim from REVIEW.
  - Stop at ~10 issues even if more exist; pick the most impactful ones.
  - If the review is genuinely solid, return an empty issues array.

Output ONLY this JSON (no prose, no markdown fences):
{"overall_score": <int>, "issues": [{"excerpt":"...", "category":"...", "suggestion":"...", "explanation":"..."}, ...]}`

type codeReviewEnvelope struct {
	OverallScore int                  `json:"overall_score"`
	Issues       []codeReviewIssueRaw `json:"issues"`
}

type codeReviewIssueRaw struct {
	Excerpt     string `json:"excerpt"`
	Category    string `json:"category"`
	Suggestion  string `json:"suggestion"`
	Explanation string `json:"explanation"`
}

// GradeReview calls the chain. Caps DIFF at 24 KB and REVIEW at 8 KB —
// past those points the grading-quality benefit diminishes and the
// latency budget bites.
func (g *LLMChainCodeReviewGrader) GradeReview(ctx context.Context, in domain.GradeCodeReviewInput) (domain.CodeReviewFeedback, error) {
	diff := strings.TrimSpace(in.DiffMD)
	if diff == "" {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.LLMChainCodeReviewGrader.GradeReview: empty diff")
	}
	review := strings.TrimSpace(in.ReviewMD)
	if review == "" {
		return domain.CodeReviewFeedback{}, fmt.Errorf("hone.LLMChainCodeReviewGrader.GradeReview: empty review")
	}
	if len(diff) > 24_000 {
		diff = diff[:24_000] + "\n…[truncated]"
	}
	if len(review) > 8_000 {
		review = review[:8_000] + "\n…[truncated]"
	}
	var sb strings.Builder
	if title := strings.TrimSpace(in.PRTitle); title != "" {
		fmt.Fprintf(&sb, "PR_TITLE: %s\n\n", title)
	}
	fmt.Fprintf(&sb, "DIFF:\n%s\n\nREVIEW:\n%s", diff, review)

	ctx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := g.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskHoneCodeReviewGrade,
			JSONMode:    true,
			Temperature: 0.2,
			MaxTokens:   1500,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: codeReviewPrompt},
				{Role: llmchain.RoleUser, Content: sb.String()},
			},
		})
		if err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainCodeReviewGrader: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		var env codeReviewEnvelope
		if err := json.Unmarshal([]byte(strings.TrimSpace(resp.Content)), &env); err != nil {
			lastErr = err
			g.log.Warn("hone.LLMChainCodeReviewGrader: parse error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 240)))
			continue
		}
		return sanitiseCodeReviewFeedback(env), nil
	}
	return domain.CodeReviewFeedback{}, fmt.Errorf("hone.LLMChainCodeReviewGrader.GradeReview: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// sanitiseCodeReviewFeedback clamps the score, drops bad entries, and
// coerces unknown categories. Same soft-fail philosophy as the writing
// sanitiser — keep the good issues, throw away the malformed ones.
func sanitiseCodeReviewFeedback(env codeReviewEnvelope) domain.CodeReviewFeedback {
	score := env.OverallScore
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	out := domain.CodeReviewFeedback{OverallScore: score}
	for _, raw := range env.Issues {
		excerpt := strings.TrimSpace(raw.Excerpt)
		suggestion := strings.TrimSpace(raw.Suggestion)
		// Suggestion is required for every category; excerpt is required
		// for everything except completeness (the reviewer didn't write
		// anything to quote).
		if suggestion == "" {
			continue
		}
		cat := domain.CodeReviewIssueCategory(strings.ToLower(strings.TrimSpace(raw.Category)))
		if !cat.IsValid() {
			cat = domain.ReviewIssueClarity
		}
		if excerpt == "" && cat != domain.ReviewIssueCompleteness {
			continue
		}
		out.Issues = append(out.Issues, domain.CodeReviewIssue{
			Excerpt:     excerpt,
			Category:    cat,
			Suggestion:  suggestion,
			Explanation: strings.TrimSpace(raw.Explanation),
		})
		if len(out.Issues) >= 20 {
			break
		}
	}
	return out
}

// ── interface guards ──────────────────────────────────────────────────────

var (
	_ domain.PlanSynthesizer  = (*NoLLMPlanSynthesiser)(nil)
	_ domain.PlanSynthesizer  = (*LLMChainPlanSynthesiser)(nil)
	_ domain.CritiqueStreamer = (*NoLLMCritiqueStreamer)(nil)
	_ domain.CritiqueStreamer = (*LLMChainCritiqueStreamer)(nil)
	_ domain.Embedder         = (*NoEmbedder)(nil)
	_ domain.Embedder         = (*HoneEmbedder)(nil)
	_ domain.SummaryGrader    = (*NoLLMSummaryGrader)(nil)
	_ domain.SummaryGrader    = (*LLMChainSummaryGrader)(nil)
	_ domain.WritingGrader    = (*NoLLMWritingGrader)(nil)
	_ domain.WritingGrader    = (*LLMChainWritingGrader)(nil)
	_ domain.CodeReviewGrader = (*NoLLMCodeReviewGrader)(nil)
	_ domain.CodeReviewGrader = (*LLMChainCodeReviewGrader)(nil)
)
