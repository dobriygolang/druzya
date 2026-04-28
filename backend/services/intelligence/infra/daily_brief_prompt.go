package infra

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"druz9/intelligence/domain"
)

const briefSystemPrompt = `You are the AI-coach for druz9 — a unified product covering Hone (desktop focus cockpit), AI mock interviews, and competitive Arena (algorithms / SQL / system design / behavioral).

You see the FULL CROSS-PRODUCT picture of one user: focus sessions, daily kata streak, mock interview scores by section, arena win/loss/elo trends, today's task queue, free-form daily notes, recent file activity, weakest skills from the Skill Atlas. Your job: spot the actual bottleneck and tell the user what to do TODAY — concretely.

Output EXACTLY this JSON shape, nothing else:
{"headline":"...","narrative":"...","recommendations":[
  {"kind":"tiny_task|schedule|review_note|unblock","title":"...","rationale":"...","target_id":"..."},
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

3. SPECIFICITY HIERARCHY (use the most specific available, and use the SIGNAL DIGEST before raw sections):
   a) If user has an upcoming interview within 7 days → 2 recommendations must prepare that interview.
   b) If mock/arena/Cue evidence repeats the same topic → recommend one concrete drill for that topic.
   c) If skill_progress has a very low skill → name the skill_key in title/rationale, but kind remains "tiny_task".
   d) If skipped plan items repeat → break the most-skipped one into a 5-min first step (kind: "unblock").
   e) If fresh recent notes are relevant → "review_note" the exact note_id.
   Otherwise — if no specific signal → tiny task tied to today's queue.

4. RECOMMENDATION KINDS:
   - "tiny_task": 5-15 min concrete action. target_id empty. Used when chronic avoidance is detected.
   - "schedule": time-block in the day. target_id empty. Used when user has data but no plan structure today.
   - "review_note": open a specific note. target_id = note_id (must match one of provided notes).
   - "unblock": split a stuck task. target_id = item_id of the skipped plan item.
   Do NOT output unsupported kinds such as "practice_skill", "drill_mock", or "drill_kata". Express those as "tiny_task" or "schedule" with the concrete section/skill in title and rationale.

5. NARRATIVE: 2-3 sentences. ALWAYS reference real numbers from the data: "4 of 7 days >30 min focus", "lost 3 in a row in arena", "kata streak: 12 days", "2 mocks this week, both system_design, scores 6 and 7". No platitudes. No "great job".

6. HEADLINE: ONE short sentence (≤8 words). Capture the DOMINANT cross-product pattern. Examples: "System Design holding back; algorithms solid.", "12-day kata streak, but no deep focus.", "Three quiet days after Saturday burst.".

7. ANTI-FLUFF: forbidden words/phrases — "take a break", "drink water", "celebrate", "you can do it", "don't forget to rest", "stay consistent", "keep up the good work". The user pays you to be honest, not nice.

8. If signals are SPARSE (new user, < 3 days of data) — say so explicitly in narrative and recommend onboarding actions: schedule first mock, generate a daily plan, do today's daily kata. Don't fabricate insight from nothing.

9. UPCOMING INTERVIEWS overrides everything. If user has an interview scheduled in the next 7 days, AT LEAST 2 of 3 recommendations MUST address that interview's company role + sections. Use "schedule" for booking a mock block or "tiny_task" for a concrete drill; target_id stays empty unless kind is review_note/unblock.

10. INLINE LINKS — narrative, title, and rationale fields support markdown link form: [label](url). Use Codex links ONLY from the "Available Codex curated articles" section. Never invent article slugs, topic slugs, or raw external URLs. Keep label SHORT (1-3 words). If no Codex article is listed for a topic, do not link it.

11. NON-REPETITION: If Past coach interactions show the user dismissed a recommendation, do not repeat the same title or target. If the user followed a recommendation, continue the direction with a new next step. Never produce 3 recommendations about the same topic; diversify by bottleneck unless an interview within 7 days overrides.

──────────────────────────────────────────────────────────────────────────
FEW-SHOT EXAMPLES (good vs bad — match the good one's specificity):

❌ BAD output (generic, useless):
{"headline":"Keep up the good work!","narrative":"You've been making great progress. Stay consistent and continue practicing daily.","recommendations":[{"kind":"tiny_task","title":"Practice algorithms","rationale":"Algorithms are important.","target_id":""},{"kind":"schedule","title":"Block focus time","rationale":"Focus is key to growth.","target_id":""},{"kind":"tiny_task","title":"Review your notes","rationale":"Reviewing helps retention.","target_id":""}]}

✅ GOOD output (specific signals, concrete actions):
{"headline":"Google interview Friday — system_design gap.","narrative":"Last system_design mock 2 days ago scored 5/10, weak_topics=[capacity-estimation, sharding]. You have 3 days until Google L5 interview, readiness_pct=40. Today's queue is empty, you skipped 'review consistent-hashing' 4 times in 14 days.","recommendations":[{"kind":"schedule","title":"Run a system_design mock today, focus on capacity-estimation.","rationale":"Last mock scored 5/10 on this section, Google interview is in 3 days.","target_id":""},{"kind":"unblock","title":"Open consistent-hashing review and read just the first paragraph.","rationale":"Skipped 4 times in 14 days — chronic avoidance. Tiny first step breaks the wall.","target_id":"plan-item-abc-123"},{"kind":"tiny_task","title":"Solve one capacity-estimation back-of-envelope problem.","rationale":"Listed as weak_topic in last mock + relevant for sharding section of Google interview.","target_id":""}]}

✅ GOOD output (user has hot keywords from mock messages):
{"headline":"Three quiet days, prefix-sum still hot in mocks.","narrative":"0 focus minutes Mon-Wed despite 12-day kata streak. Your mock messages last 14 days mention prefix-sum 18 times and segment-tree 9 times. Last algorithms 1v1 in arena: lost in 12 minutes (elo -22).","recommendations":[{"kind":"tiny_task","title":"Do today's daily kata — protect the streak.","rationale":"12-day streak, last_kata yesterday. Skipping today drops you to 0.","target_id":""},{"kind":"tiny_task","title":"Solve one segment-tree problem from weak skills.","rationale":"Mentioned 9× in mocks, listed in skill_progress as 28/100.","target_id":""},{"kind":"schedule","title":"Block 90 min focus before lunch.","rationale":"3 days of zero focus — re-establish habit before deep loss.","target_id":""}]}

✅ GOOD output (codex links inline, advanced reader trick):
{"headline":"Redis blind spot — 4 mock retries in a row.","narrative":"Last 4 system_design mocks all stalled on caching. You have a Yandex interview in 6 days. Worth [caching patterns](/codex?topic=system_design&article=caching-strategies) tonight — your mock messages mention 'redis' 22× this week without resolving.","recommendations":[{"kind":"tiny_task","title":"Read [caching patterns](/codex?topic=system_design&article=caching-strategies) and write 3 takeaways.","rationale":"Skill_progress=12/100 on cache-design. 10-min curated Codex read, immediate retention.","target_id":""},{"kind":"schedule","title":"Run a system_design mock today, force a cache-heavy prompt.","rationale":"Last 4 mocks scored 4-5/10 on caching. Yandex interview Wed.","target_id":""},{"kind":"review_note","title":"Open redis-deep-dive and read the section header.","rationale":"Recent note is available and Redis appears 22× in mock messages this week.","target_id":"note-uuid-here"}]}

──────────────────────────────────────────────────────────────────────────

Return ONLY the JSON object. No prose, no code fences.`

func buildBriefUserPrompt(in domain.BriefPromptInput) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Today: %s\n\n", in.Today.Format("2006-01-02 (Monday)"))
	writeSignalDigest(&sb, in)
	writeCoachDiagnosis(&sb, in)
	writeActionCandidates(&sb, in)
	writeActionContract(&sb, in)

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
		sb.WriteString("\nLast finished AI mock-interview sessions (most recent first; cite specific weak_topics in rationale; use schedule/tiny_task for mock prep):\n")
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
		sb.WriteString("\nWeakest skills (top-5, cite skill_key in title/rationale for tiny_task recommendations):\n")
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
	if len(in.CueMemories) > 0 {
		sb.WriteString("\nCue interview-practice memory (weak signal only: use for recurring topics/outcomes, do not cite as authoritative facts, do not recommend raw transcript review):\n")
		for _, ep := range in.CueMemories {
			outcome, topics := cuePromptMeta(ep.Payload)
			meta := string(ep.Kind)
			if outcome != "" {
				meta += " outcome=" + outcome
			}
			if topics != "" {
				meta += " topics=" + topics
			}
			fmt.Fprintf(&sb, "  - [%s · %s] %q\n",
				ep.OccurredAt.Format("2006-01-02"),
				meta,
				firstN(ep.Summary, 220))
		}
	}
	if len(in.CodexArticles) > 0 {
		sb.WriteString("\nAvailable Codex curated articles (ONLY use these exact links; prefer one link when it directly matches the bottleneck):\n")
		for _, a := range in.CodexArticles {
			fmt.Fprintf(&sb, "  - category=%q slug=%q title=%q source=%q read_min=%d link=%s description=%q\n",
				a.Category, a.Slug, a.Title, a.Source, a.ReadMin, a.Link, firstN(a.Description, 180))
		}
	}
	return sb.String()
}
func writeSignalDigest(sb *strings.Builder, in domain.BriefPromptInput) {
	sb.WriteString("SIGNAL DIGEST (prioritise in this order; use raw sections only as evidence):\n")
	fmt.Fprintf(sb, "  data_coverage: focus_days=%d mocks=%d arena=%d queue_items=%d weak_skills=%d notes=%d cue_memories=%d codex_articles=%d past_coach=%d\n",
		len(in.FocusDays), len(in.Mocks), len(in.Arena), len(in.Queue.Items),
		len(in.WeakSkills), len(in.RecentNotes)+len(in.DailyNotes)+len(in.Reflections),
		len(in.CueMemories), len(in.CodexArticles), len(in.PastEpisodes))
	wrote := false
	for _, ui := range in.UpcomingInterviews {
		if ui.DaysFromNow >= 0 && ui.DaysFromNow <= 7 {
			fmt.Fprintf(sb, "  P0 upcoming_interview: %s %s in %d days, readiness=%d%%\n",
				ui.CompanyName, ui.Role, ui.DaysFromNow, ui.ReadinessPct)
			wrote = true
		}
	}
	if len(in.Mocks) > 0 {
		m := in.Mocks[0]
		weak := strings.Join(m.WeakTopics, ",")
		if weak == "" {
			weak = "no weak_topics"
		}
		fmt.Fprintf(sb, "  P1 latest_mock: section=%s score=%d/10 weak=[%s] finished=%s\n",
			m.Section, m.Score, weak, m.FinishedAt.Format("2006-01-02"))
		wrote = true
	}
	if len(in.WeakSkills) > 0 {
		w := in.WeakSkills[0]
		fmt.Fprintf(sb, "  P1 weakest_skill: %s (%s) progress=%d/100\n",
			w.SkillKey, w.Title, w.Progress)
		wrote = true
	}
	if len(in.CodexArticles) > 0 {
		a := in.CodexArticles[0]
		fmt.Fprintf(sb, "  P1 codex_match: %s · %s · %d min · %s\n",
			a.Category, a.Title, a.ReadMin, a.Link)
		wrote = true
	}
	if len(in.MockKeywords) > 0 {
		sb.WriteString("  P2 hot_topics: ")
		for i, kw := range in.MockKeywords {
			if i >= 5 {
				break
			}
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(sb, "%s(%d)", kw.Keyword, kw.Count)
		}
		sb.WriteString("\n")
		wrote = true
	}
	if topics := convergedTopics(in, 5); len(topics) > 0 {
		sb.WriteString("  P1 topic_convergence: ")
		for i, t := range topics {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString(t)
		}
		sb.WriteString("\n")
		wrote = true
	}
	if in.Queue.Total > 0 {
		fmt.Fprintf(sb, "  P2 today_queue: done=%d/%d in_progress=%d todo=%d\n",
			in.Queue.Done, in.Queue.Total, in.Queue.InProgress, in.Queue.Todo)
		wrote = true
	}
	if len(in.DailyNotes) > 0 {
		fmt.Fprintf(sb, "  P1 today_intent: %q\n", firstN(in.DailyNotes[0].Excerpt, 140))
		wrote = true
	}
	if len(in.SkippedRecent) > 0 {
		s := in.SkippedRecent[0]
		fmt.Fprintf(sb, "  P2 avoidance: skipped item=%q skill=%s date=%s\n",
			s.Title, s.SkillKey, s.PlanDate.Format("2006-01-02"))
		wrote = true
	}
	if len(in.CueMemories) > 0 {
		outcome, topics := cuePromptMeta(in.CueMemories[0].Payload)
		fmt.Fprintf(sb, "  P3 cue_memory: outcome=%s topics=%s summary=%q\n",
			outcome, topics, firstN(in.CueMemories[0].Summary, 140))
		wrote = true
	}
	if memory := coachMemoryPolicy(in.PastEpisodes); memory != "" {
		sb.WriteString(memory)
		wrote = true
	}
	if !wrote {
		sb.WriteString("  sparse_data: no strong cross-product signal yet; recommend onboarding actions without pretending certainty.\n")
	}
	sb.WriteString("ANTI-REPEAT: do not output two recommendations with the same topic/action; do not repeat dismissed Past coach interactions.\n\n")
}

func convergedTopics(in domain.BriefPromptInput, limit int) []string {
	if limit <= 0 {
		return nil
	}
	type hit struct {
		topic   string
		sources map[string]struct{}
		count   int
	}
	hits := map[string]*hit{}
	add := func(raw, source string, weight int) {
		topic := normalizeTopic(raw)
		if topic == "" {
			return
		}
		h, ok := hits[topic]
		if !ok {
			h = &hit{topic: topic, sources: map[string]struct{}{}}
			hits[topic] = h
		}
		h.sources[source] = struct{}{}
		h.count += weight
	}
	for _, m := range in.Mocks {
		add(m.Section, "mock_section", 2)
		for _, w := range m.WeakTopics {
			add(w, "mock_weak", 3)
		}
	}
	for _, w := range in.WeakSkills {
		add(w.SkillKey, "skill_atlas", 3)
		add(w.Title, "skill_atlas", 1)
	}
	for _, kw := range in.MockKeywords {
		add(kw.Keyword, "mock_keywords", maxInt(1, kw.Count))
	}
	for _, a := range in.Arena {
		add(a.Section, "arena", 2)
	}
	for _, ep := range in.CueMemories {
		_, topics := cuePromptMeta(ep.Payload)
		for _, topic := range strings.Split(topics, ",") {
			add(topic, "cue", 1)
		}
	}
	out := make([]hit, 0, len(hits))
	for _, h := range hits {
		if len(h.sources) < 2 {
			continue
		}
		out = append(out, *h)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].count == out[j].count {
			return out[i].topic < out[j].topic
		}
		return out[i].count > out[j].count
	})
	if len(out) > limit {
		out = out[:limit]
	}
	res := make([]string, 0, len(out))
	for _, h := range out {
		res = append(res, fmt.Sprintf("%s(%d sources)", h.topic, len(h.sources)))
	}
	return res
}

func normalizeTopic(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.NewReplacer("_", "-", " ", "-", "/", "-", "ё", "е").Replace(s)
	s = strings.Trim(s, "-.,:;")
	switch s {
	case "", "general", "backend", "frontend":
		return ""
	case "system-design", "systemdesign":
		return "system-design"
	case "cache", "caching", "cache-design", "redis":
		return "cache-design"
	case "dp", "dynamic-programming":
		return "dynamic-programming"
	}
	return s
}

func coachMemoryPolicy(past []domain.Episode) string {
	var emitted, dismissed, followed []string
	for _, ep := range past {
		// All enum values handled explicitly via the multi-case branch
		// below — exhaustive linter is satisfied without a directive.
		switch ep.Kind {
		case domain.EpisodeBriefEmitted:
			emitted = append(emitted, extractEmittedRecommendationTitles(ep.Payload)...)
		case domain.EpisodeBriefDismissed:
			dismissed = append(dismissed, firstN(ep.Summary, 90))
		case domain.EpisodeBriefFollowed:
			followed = append(followed, firstN(ep.Summary, 90))
		case domain.EpisodeQAQuery,
			domain.EpisodeQAAnswered,
			domain.EpisodeReflectionAdded,
			domain.EpisodeStandupRecorded,
			domain.EpisodePlanSkipped,
			domain.EpisodePlanCompleted,
			domain.EpisodeNoteCreated,
			domain.EpisodeFocusSessionDone,
			domain.EpisodeMockPipelineFinished,
			domain.EpisodeCodexArticleOpened,
			domain.EpisodeCueConversationMemory:
			// not used for coach memory policy
		}
	}
	var sb strings.Builder
	if len(emitted) > 0 {
		sb.WriteString("  memory_recently_suggested_do_not_repeat: ")
		writeQuotedList(&sb, emitted, 5)
		sb.WriteString("\n")
	}
	if len(dismissed) > 0 {
		sb.WriteString("  memory_avoid_repeating_dismissed: ")
		writeQuotedList(&sb, dismissed, 3)
		sb.WriteString("\n")
	}
	if len(followed) > 0 {
		sb.WriteString("  memory_continue_if_relevant: ")
		writeQuotedList(&sb, followed, 3)
		sb.WriteString("\n")
	}
	return sb.String()
}

func writeQuotedList(sb *strings.Builder, items []string, limit int) {
	for i, item := range items {
		if i >= limit {
			return
		}
		if i > 0 {
			sb.WriteString(", ")
		}
		fmt.Fprintf(sb, "%q", item)
	}
}

func cuePromptMeta(raw []byte) (outcome, topics string) {
	if len(raw) == 0 {
		return "", ""
	}
	var p struct {
		Outcome string   `json:"outcome"`
		Topics  []string `json:"topics"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", ""
	}
	return strings.TrimSpace(p.Outcome), strings.Join(p.Topics, ",")
}
