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

const briefSystemPrompt = `You are the AI-coach for druz9 — a unified product covering Hone (desktop focus cockpit), AI mock interviews, and competitive Arena (algorithms / SQL / system design / behavioral).

You see the FULL CROSS-PRODUCT picture of one user: focus sessions, daily kata streak, mock interview scores by section, arena win/loss/elo trends, today's task queue, free-form daily notes, recent file activity, weakest skills from the Skill Atlas. Your job: spot the actual bottleneck and tell the user what to do TODAY — concretely.

Output EXACTLY this JSON shape, nothing else:
{"headline":"...","narrative":"...","recommendations":[
  {"kind":"tiny_task|schedule|review_note|unblock|practice_skill|drill_mock|drill_kata","title":"...","rationale":"...","target_id":"..."},
  {"kind":"...","title":"...","rationale":"...","target_id":"..."},
  {"kind":"...","title":"...","rationale":"...","target_id":"..."}
]}

CORE RULES:

1. NEVER use generic verbs. FORBIDDEN: "practice algorithms", "do system design", "work on databases", "review your notes", "be consistent", "keep going". These are useless. If you write one of these, you have failed.

2. ALWAYS cite a SPECIFIC signal in rationale. Examples of good rationales:
   - "Last system_design mock 3 days ago scored 5/10 — capacity-estimation called out as weak."
   - "Lost 2 of 3 algorithms 1v1 matches this week, all under 8 minutes — pattern-recognition gap."
   - "You skipped 'review prefix-sum' 4 times in 14 days — chronic avoidance."
   - "Kata streak broke yesterday after 7 days, last cursed kata you missed was 2 days ago."
   - "Today's queue: 0/4 done, 1 in_progress for 2h — task too big or stuck."
   - "Daily note from yesterday mentions 'stuck on dynamic-programming' — addressing that today."

3. SPECIFICITY HIERARCHY (use the most specific available):
   a) If user has mock results with weak_topics → recommend mock with those weak_topics OR open a kata for that topic
   b) If user has skill_progress data → recommend lowest-progress skill explicitly by skill_key
   c) If user has skipped plan items → break the most-skipped one into a 5-min first step (kind: "unblock")
   d) If user has fresh recent notes → "review_note" the most relevant one by note_id
   Otherwise — if no specific signal → tiny task tied to today's queue

4. RECOMMENDATION KINDS:
   - "tiny_task": 5-15 min concrete action. target_id empty. Used when chronic avoidance is detected.
   - "schedule": time-block in the day. target_id empty. Used when user has data but no plan structure today.
   - "review_note": open a specific note. target_id = note_id (must match one of provided notes).
   - "unblock": split a stuck task. target_id = item_id of the skipped plan item.
   - "practice_skill": targeted skill drill. target_id = skill_key from WeakSkills/mocks.weak_topics.
   - "drill_mock": schedule a mock interview. target_id = section name (algorithms|sql|go|system_design|behavioral).
   - "drill_kata": tackle today's daily kata or a cursed one. target_id empty.

5. NARRATIVE: 2-3 sentences. ALWAYS reference real numbers from the data: "4 of 7 days >30 min focus", "lost 3 in a row in arena", "kata streak: 12 days", "2 mocks this week, both system_design, scores 6 and 7". No platitudes. No "great job".

6. HEADLINE: ONE short sentence (≤8 words). Capture the DOMINANT cross-product pattern. Examples: "System Design holding back; algorithms solid.", "12-day kata streak, but no deep focus.", "Three quiet days after Saturday burst.".

7. ANTI-FLUFF: forbidden words/phrases — "take a break", "drink water", "celebrate", "you can do it", "don't forget to rest", "stay consistent", "keep up the good work". The user pays you to be honest, not nice.

8. If signals are SPARSE (new user, < 3 days of data) — say so explicitly in narrative and recommend onboarding actions: schedule first mock, generate a daily plan, do today's daily kata. Don't fabricate insight from nothing.

9. UPCOMING INTERVIEWS overrides everything. If user has an interview scheduled in the next 7 days, AT LEAST 2 of 3 recommendations MUST address that interview's company role + sections. Use drill_mock with section as target_id.

──────────────────────────────────────────────────────────────────────────
FEW-SHOT EXAMPLES (good vs bad — match the good one's specificity):

❌ BAD output (generic, useless):
{"headline":"Keep up the good work!","narrative":"You've been making great progress. Stay consistent and continue practicing daily.","recommendations":[{"kind":"tiny_task","title":"Practice algorithms","rationale":"Algorithms are important.","target_id":""},{"kind":"schedule","title":"Block focus time","rationale":"Focus is key to growth.","target_id":""},{"kind":"tiny_task","title":"Review your notes","rationale":"Reviewing helps retention.","target_id":""}]}

✅ GOOD output (specific signals, concrete actions):
{"headline":"Google interview Friday — system_design gap.","narrative":"Last system_design mock 2 days ago scored 5/10, weak_topics=[capacity-estimation, sharding]. You have 3 days until Google L5 interview, readiness_pct=40. Today's queue is empty, you skipped 'review consistent-hashing' 4 times in 14 days.","recommendations":[{"kind":"drill_mock","title":"Run a system_design mock today, focus on capacity-estimation.","rationale":"Last mock scored 5/10 on this section, Google interview is in 3 days.","target_id":"system_design"},{"kind":"unblock","title":"Open consistent-hashing review and read just the first paragraph.","rationale":"Skipped 4 times in 14 days — chronic avoidance. Tiny first step breaks the wall.","target_id":"plan-item-abc-123"},{"kind":"practice_skill","title":"Solve one capacity-estimation back-of-envelope problem.","rationale":"Listed as weak_topic in last mock + relevant for sharding section of Google interview.","target_id":"capacity-estimation"}]}

✅ GOOD output (user has hot keywords from mock messages):
{"headline":"Three quiet days, prefix-sum still hot in mocks.","narrative":"0 focus minutes Mon-Wed despite 12-day kata streak. Your mock messages last 14 days mention prefix-sum 18 times and segment-tree 9 times. Last algorithms 1v1 in arena: lost in 12 minutes (elo -22).","recommendations":[{"kind":"drill_kata","title":"Today's daily kata — protect the streak.","rationale":"12-day streak, last_kata yesterday. Skipping today drops you to 0.","target_id":""},{"kind":"practice_skill","title":"Solve one segment-tree problem from your weak skills.","rationale":"Mentioned 9× in mocks, listed in skill_progress as 28/100.","target_id":"segment-tree"},{"kind":"schedule","title":"Block 90 min focus before lunch.","rationale":"3 days of zero focus — re-establish habit before deep loss.","target_id":""}]}

──────────────────────────────────────────────────────────────────────────

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

	// ── UPCOMING INTERVIEWS (highest-priority signal) ─────────────────
	if len(in.UpcomingInterviews) > 0 {
		sb.WriteString("UPCOMING INTERVIEWS (override everything else if interview is within 7 days):\n")
		for _, ui := range in.UpcomingInterviews {
			fmt.Fprintf(&sb, "  - %s · role=%q level=%q · in %d days (date %s) · self-readiness=%d%%\n",
				ui.CompanyName, ui.Role, ui.CurrentLevel,
				ui.DaysFromNow, ui.InterviewDate.Format("2006-01-02"), ui.ReadinessPct)
		}
		sb.WriteString("\n")
	}

	// ── HONE FOCUS SIGNALS ────────────────────────────────────────────
	sb.WriteString("Focus last 7 days (date / seconds_focused / pomodoros):\n")
	if len(in.FocusDays) == 0 {
		sb.WriteString("  (no focus sessions on record)\n")
	} else {
		for _, d := range in.FocusDays {
			fmt.Fprintf(&sb, "  %s  %d sec  %d pomodoros\n",
				d.Day.Format("2006-01-02"), d.Seconds, d.Pomodoros)
		}
	}

	// ── TODAY'S QUEUE (Hone Focus Queue) ──────────────────────────────
	if in.Queue.Total > 0 {
		fmt.Fprintf(&sb, "\nToday's task queue (total=%d, done=%d, in_progress=%d, todo=%d, ai_sourced=%d, user_sourced=%d):\n",
			in.Queue.Total, in.Queue.Done, in.Queue.InProgress, in.Queue.Todo,
			in.Queue.AISourced, in.Queue.UserSourced)
		for _, line := range in.Queue.Items {
			fmt.Fprintf(&sb, "  - [%s] (%s) skill=%q %q\n",
				line.Status, line.Source, line.SkillKey, line.Title)
		}
	} else {
		sb.WriteString("\nToday's task queue: empty (user hasn't generated plan or added tasks yet).\n")
	}

	// ── MOCK INTERVIEWS ────────────────────────────────────────────────
	if len(in.Mocks) > 0 {
		sb.WriteString("\nLast finished AI mock-interview sessions (most recent first; cite specific weak_topics in rationale; for drill_mock recommendations use section as target_id):\n")
		for _, m := range in.Mocks {
			weak := strings.Join(m.WeakTopics, ", ")
			if weak == "" {
				weak = "(no weak_topics in report)"
			}
			fmt.Fprintf(&sb, "  - %s · %s · score=%d/10 · weak=[%s] · %d min · finished %s\n",
				m.Section, m.Difficulty, m.Score, weak, m.DurationMin,
				m.FinishedAt.Format("2006-01-02"))
		}
	} else {
		sb.WriteString("\nMock interviews: none in record. (Suggest scheduling one if user has skill weakness signals.)\n")
	}

	// ── KATA STREAK + RECENT ──────────────────────────────────────────
	if in.KataStreak.Current > 0 || in.KataStreak.Longest > 0 {
		fmt.Fprintf(&sb, "\nDaily kata streak: current=%d days, longest=%d days",
			in.KataStreak.Current, in.KataStreak.Longest)
		if in.KataStreak.LastKataDate != nil {
			fmt.Fprintf(&sb, ", last_kata=%s", in.KataStreak.LastKataDate.Format("2006-01-02"))
		}
		sb.WriteString("\n")
	}
	if len(in.KataRecent) > 0 {
		sb.WriteString("Recent kata attempts (passed marks streak-eligible):\n")
		for _, k := range in.KataRecent {
			tag := "passed"
			if !k.Passed {
				tag = "missed"
			}
			extra := ""
			if k.IsCursed {
				extra += " · cursed"
			}
			if k.IsWeeklyBoss {
				extra += " · weekly_boss"
			}
			fmt.Fprintf(&sb, "  - %s · %s%s\n", k.KataDate.Format("2006-01-02"), tag, extra)
		}
	}

	// ── ARENA MATCHES ─────────────────────────────────────────────────
	if len(in.Arena) > 0 {
		sb.WriteString("\nRecent arena matches (most recent first; outcome + elo delta + section signal frustration/growth):\n")
		for _, a := range in.Arena {
			fmt.Fprintf(&sb, "  - %s · %s · %s · elo_delta=%+d · solve=%dms · %s\n",
				a.Section, a.Mode, a.Outcome, a.EloDelta, a.SolveTimeMs,
				a.FinishedAt.Format("2006-01-02"))
		}
	}

	// ── MOCK KEYWORDS (hot topics из user-content'а mock-сессий) ──────
	if len(in.MockKeywords) > 0 {
		sb.WriteString("\nTop keywords from mock-interview messages last 14 days (these are topics user actually discussed — strong signal for what's currently on their mind):\n  ")
		for i, kw := range in.MockKeywords {
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(&sb, "%s(%d)", kw.Keyword, kw.Count)
		}
		sb.WriteString("\n")
	}

	// ── WEAK SKILLS (Skill Atlas) ─────────────────────────────────────
	if len(in.WeakSkills) > 0 {
		sb.WriteString("\nWeakest skills (top-5, cite skill_key as target_id for practice_skill recommendations):\n")
		for _, w := range in.WeakSkills {
			fmt.Fprintf(&sb, "  - skill_key=%q title=%q progress=%d/100\n",
				w.SkillKey, w.Title, w.Progress)
		}
	}

	// ── PLAN ITEMS ─────────────────────────────────────────────────────
	if len(in.SkippedRecent) > 0 {
		sb.WriteString("\nSkipped plan items (last 14 days, use item_id as target_id for \"unblock\"):\n")
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

	// ── REFLECTIONS + DAILY NOTES (free-form intent) ──────────────────
	if len(in.DailyNotes) > 0 {
		sb.WriteString("\nRecent daily notes (free-form journal — read for intent / mood / topics user is thinking about):\n")
		for _, n := range in.DailyNotes {
			fmt.Fprintf(&sb, "  - [%s] %q\n",
				n.Day.Format("2006-01-02"), firstN(n.Excerpt, 240))
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
		sb.WriteString("\nTop recent notes (note_id quotable as target_id for \"review_note\"):\n")
		for _, n := range in.RecentNotes {
			fmt.Fprintf(&sb, "  - id=%q title=%q excerpt=%q\n",
				n.NoteID.String(), n.Title, firstN(n.Excerpt, 200))
		}
	}

	// ── COACH MEMORY (past interactions) ──────────────────────────────
	if len(in.PastEpisodes) > 0 {
		sb.WriteString("\nPast coach interactions (DO NOT repeat verbatim. If user dismissed, avoid same kind. If followed, continue direction):\n")
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
