package infra

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"druz9/intelligence/domain"
	"druz9/shared/pkg/llmchain"
)

// ─── Floor adapters (no llmchain) ─────────────────────────────────────────

// NoLLMBriefSynthesiser returns ErrLLMUnavailable on every call.
type NoLLMBriefSynthesiser struct{}

// NewNoLLMBriefSynthesiser — floor constructor.
func NewNoLLMBriefSynthesiser() *NoLLMBriefSynthesiser { return &NoLLMBriefSynthesiser{} }

// Synthesise always returns ErrLLMUnavailable.
func (*NoLLMBriefSynthesiser) Synthesise(_ context.Context, _ domain.BriefPromptInput) (domain.DailyBrief, error) {
	return domain.DailyBrief{}, fmt.Errorf("intelligence.NoLLMBriefSynthesiser.Synthesise: %w", domain.ErrLLMUnavailable)
}

// NoLLMNoteAnswerer returns ErrLLMUnavailable on every call.
type NoLLMNoteAnswerer struct{}

// NewNoLLMNoteAnswerer — floor constructor.
func NewNoLLMNoteAnswerer() *NoLLMNoteAnswerer { return &NoLLMNoteAnswerer{} }

// Answer always returns ErrLLMUnavailable.
func (*NoLLMNoteAnswerer) Answer(_ context.Context, _ domain.AskNotesPromptInput) (string, error) {
	return "", fmt.Errorf("intelligence.NoLLMNoteAnswerer.Answer: %w", domain.ErrLLMUnavailable)
}

// ─── BriefSynthesiser (TaskDailyBrief) ────────────────────────────────────

// LLMChainBriefSynthesiser runs TaskDailyBrief in JSON-mode and parses
// the strict envelope into a DailyBrief.
type LLMChainBriefSynthesiser struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainBriefSynthesiser wires the adapter. chain MUST be non-nil.
func NewLLMChainBriefSynthesiser(chain llmchain.ChatClient, log *slog.Logger) *LLMChainBriefSynthesiser {
	if chain == nil {
		panic("intelligence.NewLLMChainBriefSynthesiser: chain is required")
	}
	if log == nil {
		panic("intelligence.NewLLMChainBriefSynthesiser: logger is required")
	}
	return &LLMChainBriefSynthesiser{chain: chain, log: log, timeout: 30 * time.Second}
}

const briefSystemPrompt = `You are the morning AI-coach for Hone, a desktop focus cockpit for programmers.

Given the user's recent activity (focus stats last 7 days, plan items they skipped or completed, EndFocusSession reflections, top recently-touched notes), produce a personal morning brief.

Output EXACTLY this JSON shape, nothing else:
{"headline":"...","narrative":"...","recommendations":[
  {"kind":"tiny_task|schedule|review_note|unblock","title":"...","rationale":"...","target_id":"..."},
  {"kind":"...","title":"...","rationale":"...","target_id":"..."},
  {"kind":"...","title":"...","rationale":"...","target_id":"..."}
]}

Rules:
- "headline": ONE short sentence (≤8 words). Capture the dominant pattern of the last 7 days. Examples: "Strong morning, then quiet.", "Three days of solid System Design work.", "You're avoiding databases again.".
- "narrative": 2-3 sentences. Describe the pattern. Reference SPECIFIC numbers ("4 of 7 days >30 min focus") or SPECIFIC skipped/completed item titles. No platitudes, no encouragement, no "great job!". Be a coach, not a cheerleader.
- "recommendations": EXACTLY 3 items. Each has:
    - "kind": one of "tiny_task" | "schedule" | "review_note" | "unblock".
    - "title": ONE short imperative sentence (≤10 words). What the user should do.
    - "rationale": ONE sentence explaining why, citing the specific signal.
    - "target_id": optional. For "review_note", this MUST be the note_id of one of the provided recent notes. For "unblock", this MUST be the item_id of one of the skipped plan items. Empty for "tiny_task" and "schedule".
- Diversity: don't return three of the same kind. Aim for at least 2 distinct kinds across the 3 recommendations.
- Anti-fluff: NEVER recommend "take a break" / "drink water" / "celebrate progress". Always tie to a concrete user signal.
- "review_note" picks the note most relevant to the user's recent skips/reflections.
- "unblock" addresses the most-frequently-skipped plan item by breaking it into a smaller first step.

Return ONLY the JSON object. No prose, no code fences.`

// Synthesise builds the prompt, calls the chain, parses JSON envelope.
// One retry on parse failure; second failure surfaces ErrLLMUnavailable.
func (s *LLMChainBriefSynthesiser) Synthesise(ctx context.Context, in domain.BriefPromptInput) (domain.DailyBrief, error) {
	userMsg := buildBriefUserPrompt(in)

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := s.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskDailyBrief,
			JSONMode:    true,
			Temperature: 0.4,
			MaxTokens:   700,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: briefSystemPrompt},
				{Role: llmchain.RoleUser, Content: userMsg},
			},
		})
		if err != nil {
			lastErr = err
			s.log.Warn("intelligence.LLMChainBriefSynthesiser: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt),
				slog.String("user_id", in.UserID.String()))
			continue
		}
		brief, parseErr := parseBriefJSON(resp.Content, in)
		if parseErr != nil {
			lastErr = parseErr
			s.log.Warn("intelligence.LLMChainBriefSynthesiser: parse error",
				slog.Any("err", parseErr), slog.Int("attempt", attempt),
				slog.String("preview", firstN(resp.Content, 200)))
			continue
		}
		return brief, nil
	}
	return domain.DailyBrief{}, fmt.Errorf("intelligence.LLMChainBriefSynthesiser.Synthesise: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

func buildBriefUserPrompt(in domain.BriefPromptInput) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Today: %s\n\n", in.Today.Format("2006-01-02 (Monday)"))

	sb.WriteString("Focus last 7 days (date / seconds_focused / pomodoros):\n")
	if len(in.FocusDays) == 0 {
		sb.WriteString("  (no focus sessions on record)\n")
	} else {
		for _, d := range in.FocusDays {
			fmt.Fprintf(&sb, "  %s  %d sec  %d pomodoros\n",
				d.Day.Format("2006-01-02"), d.Seconds, d.Pomodoros)
		}
	}

	if len(in.SkippedRecent) > 0 {
		sb.WriteString("\nSkipped plan items (last 14 days, item_id may be quoted as target_id for an \"unblock\" recommendation):\n")
		for _, s := range in.SkippedRecent {
			fmt.Fprintf(&sb, "  - id=%q skill=%q title=%q on %s\n",
				s.ItemID, s.SkillKey, s.Title, s.PlanDate.Format("2006-01-02"))
		}
	}
	if len(in.CompletedRecent) > 0 {
		sb.WriteString("\nCompleted plan items (last 7 days):\n")
		for _, c := range in.CompletedRecent {
			fmt.Fprintf(&sb, "  - skill=%q title=%q on %s\n",
				c.SkillKey, c.Title, c.PlanDate.Format("2006-01-02"))
		}
	}
	if len(in.Reflections) > 0 {
		sb.WriteString("\nRecent reflection lines (from EndFocusSession):\n")
		for _, r := range in.Reflections {
			fmt.Fprintf(&sb, "  - [%s] %q\n",
				r.CreatedAt.Format("2006-01-02"), firstN(r.BodyHead, 160))
		}
	}
	if len(in.RecentNotes) > 0 {
		sb.WriteString("\nTop recent notes (note_id may be quoted as target_id for a \"review_note\" recommendation):\n")
		for _, n := range in.RecentNotes {
			fmt.Fprintf(&sb, "  - id=%q title=%q excerpt=%q\n",
				n.NoteID.String(), n.Title, firstN(n.Excerpt, 200))
		}
	}
	if len(in.PastEpisodes) > 0 {
		sb.WriteString("\nPast coach interactions (most relevant — DO NOT repeat verbatim. If user dismissed, avoid same kind. If followed, continue direction):\n")
		for _, ep := range in.PastEpisodes {
			fmt.Fprintf(&sb, "  - [%s · %s] %q\n",
				ep.OccurredAt.Format("2006-01-02"),
				string(ep.Kind),
				firstN(ep.Summary, 160))
		}
	}
	return sb.String()
}

// briefJSONEnvelope mirrors the JSON shape locked in by the system prompt.
type briefJSONEnvelope struct {
	Headline        string                    `json:"headline"`
	Narrative       string                    `json:"narrative"`
	Recommendations []briefJSONRecommendation `json:"recommendations"`
}

type briefJSONRecommendation struct {
	Kind      string `json:"kind"`
	Title     string `json:"title"`
	Rationale string `json:"rationale"`
	TargetID  string `json:"target_id"`
}

func parseBriefJSON(raw string, in domain.BriefPromptInput) (domain.DailyBrief, error) {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	s = strings.TrimSpace(s)

	var env briefJSONEnvelope
	if err := json.Unmarshal([]byte(s), &env); err != nil {
		return domain.DailyBrief{}, fmt.Errorf("unmarshal: %w", err)
	}
	if strings.TrimSpace(env.Headline) == "" {
		return domain.DailyBrief{}, errors.New("empty headline")
	}
	if strings.TrimSpace(env.Narrative) == "" {
		return domain.DailyBrief{}, errors.New("empty narrative")
	}
	if len(env.Recommendations) == 0 {
		return domain.DailyBrief{}, errors.New("empty recommendations")
	}

	// Build target_id allow-lists from prompt input — the LLM must reference
	// real IDs we sent it. Anything else gets blanked.
	noteIDs := make(map[string]struct{}, len(in.RecentNotes))
	for _, n := range in.RecentNotes {
		noteIDs[n.NoteID.String()] = struct{}{}
	}
	planItemIDs := make(map[string]struct{}, len(in.SkippedRecent))
	for _, s := range in.SkippedRecent {
		planItemIDs[s.ItemID] = struct{}{}
	}

	recs := make([]domain.Recommendation, 0, len(env.Recommendations))
	for _, r := range env.Recommendations {
		kind := domain.RecommendationKind(strings.ToLower(strings.TrimSpace(r.Kind)))
		if !kind.IsValid() {
			kind = domain.RecommendationTinyTask
		}
		title := strings.TrimSpace(r.Title)
		if title == "" {
			continue
		}
		target := strings.TrimSpace(r.TargetID)
		switch kind {
		case domain.RecommendationReviewNote:
			if _, ok := noteIDs[target]; !ok {
				target = ""
			}
		case domain.RecommendationUnblock:
			if _, ok := planItemIDs[target]; !ok {
				target = ""
			}
		case domain.RecommendationTinyTask, domain.RecommendationSchedule:
			target = ""
		default:
			target = ""
		}
		recs = append(recs, domain.Recommendation{
			Kind:      kind,
			Title:     title,
			Rationale: strings.TrimSpace(r.Rationale),
			TargetID:  target,
		})
	}
	if len(recs) == 0 {
		return domain.DailyBrief{}, errors.New("all recommendations dropped as degenerate")
	}
	// Cap to 3 — LLM occasionally over-produces.
	if len(recs) > 3 {
		recs = recs[:3]
	}
	return domain.DailyBrief{
		Headline:        strings.TrimSpace(env.Headline),
		Narrative:       strings.TrimSpace(env.Narrative),
		Recommendations: recs,
	}, nil
}

func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// ─── NoteAnswerer (TaskNoteQA) ────────────────────────────────────────────

// LLMChainNoteAnswerer runs TaskNoteQA in text mode against the assembled
// note context. One retry; second failure surfaces ErrLLMUnavailable.
type LLMChainNoteAnswerer struct {
	chain   llmchain.ChatClient
	log     *slog.Logger
	timeout time.Duration
}

// NewLLMChainNoteAnswerer wires the adapter. chain MUST be non-nil.
func NewLLMChainNoteAnswerer(chain llmchain.ChatClient, log *slog.Logger) *LLMChainNoteAnswerer {
	if chain == nil {
		panic("intelligence.NewLLMChainNoteAnswerer: chain is required")
	}
	if log == nil {
		panic("intelligence.NewLLMChainNoteAnswerer: logger is required")
	}
	return &LLMChainNoteAnswerer{chain: chain, log: log, timeout: 30 * time.Second}
}

const noteQASystemPrompt = `You are answering a user's question using ONLY the notes provided below. Each note is numbered [1], [2], ... — these are the citation tokens.

Rules:
- Answer in markdown. Be concise (3-6 sentences typical). No greeting, no "based on the notes" preamble.
- Cite EVERY substantive claim using [N] referring to the note number. Multiple notes for one claim: [1,3].
- If the notes don't contain enough information to answer, say so plainly. DO NOT speculate. DO NOT make up facts.
- Do not mention "the notes" or "the documents". Just answer + cite.

Question and notes follow.`

// Answer assembles the prompt + calls the chain. Returns the markdown
// answer; citations are parsed by the use case.
func (a *LLMChainNoteAnswerer) Answer(ctx context.Context, in domain.AskNotesPromptInput) (string, error) {
	prompt := buildQAUserPrompt(in.Question, in.ContextNotes, in.PastEpisodes)

	ctx, cancel := context.WithTimeout(ctx, a.timeout)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := a.chain.Chat(ctx, llmchain.Request{
			Task:        llmchain.TaskNoteQA,
			Temperature: 0.3,
			MaxTokens:   600,
			Messages: []llmchain.Message{
				{Role: llmchain.RoleSystem, Content: noteQASystemPrompt},
				{Role: llmchain.RoleUser, Content: prompt},
			},
		})
		if err != nil {
			lastErr = err
			a.log.Warn("intelligence.LLMChainNoteAnswerer: chain error",
				slog.Any("err", err), slog.Int("attempt", attempt))
			continue
		}
		out := strings.TrimSpace(resp.Content)
		if out == "" {
			lastErr = errors.New("empty response")
			continue
		}
		return out, nil
	}
	return "", fmt.Errorf("intelligence.LLMChainNoteAnswerer.Answer: both attempts failed: %w (%w)", lastErr, domain.ErrLLMUnavailable)
}

// MaxBodyChars caps each note's body in the prompt to keep total context
// well within 70B 32k limits even for a maxed-out 8-note top-K.
const MaxBodyChars = 1500

func buildQAUserPrompt(question string, ctxNotes []domain.NoteEmbedding, past []domain.Episode) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Question: %s\n\nNotes:\n", strings.TrimSpace(question))
	for i, n := range ctxNotes {
		body := n.Body
		if len(body) > MaxBodyChars {
			body = body[:MaxBodyChars] + "…"
		}
		fmt.Fprintf(&sb, "\n[%d] %s\n%s\n", i+1, n.Title, body)
	}
	if len(past) > 0 {
		sb.WriteString("\n\nPast questions/answers (for context — do not cite):\n")
		for _, e := range past {
			fmt.Fprintf(&sb, "- [%s] %s\n", e.OccurredAt.Format("2006-01-02"), e.Summary)
		}
	}
	return sb.String()
}

// ─── interface guards ─────────────────────────────────────────────────────

var (
	_ domain.BriefSynthesizer = (*NoLLMBriefSynthesiser)(nil)
	_ domain.BriefSynthesizer = (*LLMChainBriefSynthesiser)(nil)
	_ domain.NoteAnswerer     = (*NoLLMNoteAnswerer)(nil)
	_ domain.NoteAnswerer     = (*LLMChainNoteAnswerer)(nil)
)
