package infra

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"druz9/intelligence/domain"
)

const briefSystemPrompt = `You are the AI-coach for druz9 (Hone focus cockpit + AI mock interviews + Arena). You see the user's full cross-product signals; spot the bottleneck and prescribe TODAY's concrete lever.

OUTPUT — strict JSON, nothing else:
{"headline":"...","narrative":"...","recommendations":[
  {"kind":"tiny_task|schedule|review_note|unblock","title":"...","rationale":"...","target_id":"..."},
  {"kind":"...","title":"...","rationale":"...","target_id":"..."},
  {"kind":"...","title":"...","rationale":"...","target_id":"..."}
]}

KIND CONTRACT (only these 4; no "practice_skill"/"drill_mock"/"drill_kata"):
  tiny_task   5-15 min concrete action.            target_id=""
  schedule    time-block today.                    target_id=""
  review_note open one provided note.              target_id=note_id (must match input)
  unblock     5-min first step on a stuck plan item. target_id=item_id (must match input)

PRIORITY ORDER (use SIGNAL DIGEST before raw sections; first matching wins):
  1. Interview ≤7d → ≥2 of 3 recs prep that role+sections; severity=critical=urgency in headline.
  2. Repeated topic (mock weak / arena loss / Cue) → one concrete drill on that topic.
  3. Repeated skipped plan item → "unblock" with item_id.
  4. Very weak skill (≤30/100) → name skill_key in title/rationale (kind=tiny_task).
  5. Fresh relevant note → review_note with exact note_id.
  6. Sparse signals (<3d data) → say so in narrative, recommend onboarding (first mock, generate plan, daily kata).
  7. Otherwise → tiny task tied to today's queue.

NARRATIVE — 2-3 sentences, causal chain: <observation+numbers> → <cause/interpretation> → <today's lever>. ALWAYS cite real numbers ("4 of 7 days >30 min focus", "kata streak: 12d", "2 mocks scored 6 and 7"). No disjoint facts; no platitudes.

HEADLINE — ≤8 words, matches severity in SIGNAL DIGEST:
  critical → urgency (interview/streak break/3+ losses)
  warn     → name the bottleneck
  nudge    → name the leverage point
  cruise   → acknowledge momentum (no flattery)

RATIONALE — every recommendation cites a specific signal. Good vs bad:
  GOOD: "Last system_design mock 3d ago scored 5/10 — capacity-estimation flagged weak."
  GOOD: "Skipped 'review prefix-sum' 4× in 14d — chronic avoidance."
  GOOD: "Kata streak broke yesterday after 7d."
  BAD : "Algorithms are important." / "Reviewing helps retention." / "Stay consistent."

FORBIDDEN VERBS/PHRASES (writing one = failure): "practice algorithms", "do system design", "work on databases", "review your notes", "be consistent", "keep going", "take a break", "drink water", "celebrate", "you can do it", "don't forget to rest", "stay consistent", "keep up the good work", "great job".

NON-REPETITION: dismissed Past coach interactions → don't repeat title/target. Followed → continue with a NEW next step. Never 3 recs on the same topic (interview ≤7d overrides).

INLINE LINKS — markdown [label](url) allowed in narrative/title/rationale. Codex links ONLY from the "Available Codex curated articles" list; never invent slugs/URLs. Label 1-3 words. No Codex match → no link.

──────────────────────────────────────────────────────────────────────────
FEW-SHOT (match the good one's specificity):

BAD:
{"headline":"Keep up the good work!","narrative":"You've been making great progress. Stay consistent.","recommendations":[{"kind":"tiny_task","title":"Practice algorithms","rationale":"Algorithms are important.","target_id":""},{"kind":"schedule","title":"Block focus time","rationale":"Focus is key.","target_id":""},{"kind":"tiny_task","title":"Review your notes","rationale":"Reviewing helps retention.","target_id":""}]}

GOOD (interview override):
{"headline":"Google interview Friday — system_design gap.","narrative":"Last system_design mock 2d ago scored 5/10, weak_topics=[capacity-estimation, sharding]. 3 days until Google L5, readiness=40%. Today's queue empty, skipped 'review consistent-hashing' 4× in 14d.","recommendations":[{"kind":"schedule","title":"Run a system_design mock today, focus on capacity-estimation.","rationale":"Last mock 5/10 on this section, Google in 3 days.","target_id":""},{"kind":"unblock","title":"Open consistent-hashing review, read just the first paragraph.","rationale":"Skipped 4× in 14d — chronic avoidance. Tiny step breaks the wall.","target_id":"plan-item-abc-123"},{"kind":"tiny_task","title":"Solve one capacity-estimation back-of-envelope problem.","rationale":"weak_topic in last mock + relevant for sharding at Google.","target_id":""}]}

GOOD (hot mock keywords):
{"headline":"Three quiet days, prefix-sum still hot.","narrative":"0 focus min Mon-Wed despite 12d kata streak. Mock messages mention prefix-sum 18× and segment-tree 9× last 14d. Last algorithms 1v1: lost in 12min (elo -22).","recommendations":[{"kind":"tiny_task","title":"Do today's daily kata — protect the streak.","rationale":"12d streak, last kata yesterday. Skip drops to 0.","target_id":""},{"kind":"tiny_task","title":"Solve one segment-tree problem from weak skills.","rationale":"9× in mocks, skill_progress=28/100.","target_id":""},{"kind":"schedule","title":"Block 90 min focus before lunch.","rationale":"3d zero focus — restore habit before deep loss.","target_id":""}]}

GOOD (codex link inline):
{"headline":"Redis blind spot — 4 mock retries.","narrative":"Last 4 system_design mocks stalled on caching. Yandex interview in 6d. Worth [caching patterns](/codex?topic=system_design&article=caching-strategies) — mock messages mention 'redis' 22× this week unresolved.","recommendations":[{"kind":"tiny_task","title":"Read [caching patterns](/codex?topic=system_design&article=caching-strategies), write 3 takeaways.","rationale":"skill_progress=12/100 on cache-design. 10-min curated read.","target_id":""},{"kind":"schedule","title":"Run a system_design mock today, force a cache-heavy prompt.","rationale":"Last 4 mocks 4-5/10 on caching. Yandex Wed.","target_id":""},{"kind":"review_note","title":"Open redis-deep-dive, read the section header.","rationale":"Recent note available; redis 22× in mock messages.","target_id":"note-uuid-here"}]}
──────────────────────────────────────────────────────────────────────────

Return ONLY the JSON object. No prose, no code fences.`

// variantPromptOverlay — A/B prompt-variant overlay. Возвращает 1-2
// строчки instruction tied к variant'у. Пустая строка = default
// (briefSystemPrompt без изменений).
//
// Variants:
//
//	terse  — сократи narrative до ≤2 коротких предложений; rationale
//	         ≤14 слов на recommendation. Headline остаётся ≤8 слов.
//	sharp  — headline должен называть конкретный signal+number в первой
//	         фразе ("Yandex Wed — 5/10 sysdesign"); narrative до 2 sent.
func variantPromptOverlay(v CoachPromptVariant) string {
	switch v {
	case CoachPromptVariantTerse:
		return "VARIANT: terse. Narrative ≤2 short sentences. Each recommendation rationale ≤14 words. Cut adjectives, keep numbers."
	case CoachPromptVariantSharp:
		return "VARIANT: sharp. Headline MUST lead with a concrete signal + number (e.g. \"Yandex Wed — 5/10 sysdesign\"). Narrative ≤2 sentences."
	case CoachPromptVariantDefault:
		return ""
	}
	return ""
}

// personaToneOverlay — system-prompt overlay returning 1-2 строчки с tone
// hint; caller добавляет отдельным system message после briefSystemPrompt.
// Пустая строка = no overlay (default tone briefSystemPrompt уже даёт
// «honest, not nice»).
//
// Обоснование одной-двух строк: длинные tone hint'ы перетягивают на себя
// внимание модели и приводят к prompt-leak («Hi! As a strict coach…»).
// Короткий direct hint меняет наклон без переписывания контракта output'а.
func personaToneOverlay(p CoachPersona) string {
	switch p {
	case CoachPersonaStrict:
		return "TONE OVERLAY: strict. Direct, no hedging. Hold high standards. The user wants to be pushed, не утешён."
	case CoachPersonaWarm:
		return "TONE OVERLAY: warm. Acknowledge effort visibly, frame growth as learning. Stay specific, but lead with what's working."
	case CoachPersonaSparring:
		return "TONE OVERLAY: sparring. Treat the user as a peer who can take pushback. Question stale assumptions implicitly."
	}
	return ""
}

// critiqueSystemPrompt — second-stage critique. Coach видит свой
// предыдущий sketch + те же signals и должен либо его подтвердить, либо
// вернуть улучшенную версию. Триггерится только для severity warn /
// critical: мы платим латентностью + LLM-токенами там, где stake'и
// оправдывают (interview через 3 дня, broken streak, chronic avoidance).
//
// Output контракт идентичен sketch'у — тот же JSON envelope. Это
// позволяет переиспользовать parseBriefJSON без бранчей. Если critique
// возвращает null/empty/malformed → caller использует исходный sketch.
const critiqueSystemPrompt = `You are a senior coach reviewing a draft brief that another LLM produced from the same signals.

Your job: critique the draft against these tests, then return an improved JSON brief OR confirm the draft is already optimal.

REVIEW CHECKLIST:
1. Specificity — does every recommendation cite a concrete number/topic from the signals? Generic verbs ("practice algorithms") = fail.
2. Severity match — for warn/critical headlines, does the lead sentence convey urgency / name the dominant signal?
3. Causal narrative — 2-3 sentences in <observation> → <interpretation> → <today's lever> form, with real numbers?
4. Recommendation diversity — three distinct levers, not three flavours of the same topic (unless interview within 7d overrides).
5. Anti-fluff — no "stay consistent", "great job", "keep going". Honest, not nice.
6. Action-readability — could the user follow each recommendation in <15 min today?
7. Codex links only from the "Available Codex curated articles" list, no invented URLs.

If the draft passes all 7 checks, RETURN IT VERBATIM (same JSON shape, same field values).
If 1+ checks fail, RETURN AN IMPROVED VERSION (same JSON envelope) that fixes them. Improvements MUST stay grounded in the same signals — do not invent facts the draft did not have access to.

Output EXACTLY the same JSON shape, nothing else:
{"headline":"...","narrative":"...","recommendations":[
  {"kind":"...","title":"...","rationale":"...","target_id":"..."},
  ... (exactly 3)
]}

Allowed kinds: tiny_task | schedule | review_note | unblock. target_id matches the sketch when carrying note_id / plan_item_id; empty otherwise.`

// buildBriefCritiqueUserPrompt assembles the second-stage user prompt.
//
// Delta-compress: instead of re-emitting the full sketch signal digest
// (~1000 tokens), critique sees only:
//   - DRAFT JSON (the sketch under review),
//   - SIGNAL HIGHLIGHTS (severity grade + top 3-5 facts: severity reason,
//     latest mock, weakest skill, repeated topic, interview pressure).
//
// The critique system prompt holds the 7-check rubric — it doesn't need
// the full data digest to apply it; it needs (a) the draft and (b) just
// enough evidence to verify the draft is grounded. Delta-compress saves
// ~400 tokens per critique call without losing critique signal.
func buildBriefCritiqueUserPrompt(in domain.BriefPromptInput, sketchJSON string) string {
	var sb strings.Builder
	sb.WriteString("──────────────────────────────────────────────────\n")
	sb.WriteString("DRAFT BRIEF (under review):\n")
	sb.WriteString(strings.TrimSpace(sketchJSON))
	sb.WriteString("\n──────────────────────────────────────────────────\n\n")
	writeBriefSignalHighlights(&sb, in)
	sb.WriteString("\nReturn ONLY the final JSON brief (verbatim if draft passes all 7 checks; improved otherwise). No prose, no fences.")
	return sb.String()
}

// writeBriefSignalHighlights — compact evidence digest used by critique
// stage. Lists only the most load-bearing facts; the critic uses these
// to verify the draft's claims are grounded without re-paying the cost
// of the full signal section.
func writeBriefSignalHighlights(sb *strings.Builder, in domain.BriefPromptInput) {
	sb.WriteString("SIGNAL HIGHLIGHTS (verify draft claims against these — full signal set is upstream):\n")
	severity, severityReason := deriveSeverity(in)
	fmt.Fprintf(sb, "  severity=%s · %s\n", severity, severityReason)

	// Latest mock (most recent finished — common citation target).
	if len(in.Mocks) > 0 {
		m := in.Mocks[0]
		weak := strings.Join(m.WeakTopics, ",")
		if weak == "" {
			weak = "no weak_topics"
		}
		fmt.Fprintf(sb, "  latest_mock: section=%s score=%d/10 weak=[%s] finished=%s\n",
			m.Section, m.Score, weak, m.FinishedAt.Format("2006-01-02"))
	}

	// Repeated weak topic (warn-grade pattern).
	if topic, n := repeatedMockWeakTopic(in.Mocks); n >= 3 {
		fmt.Fprintf(sb, "  repeated_mock_weakness: %s in %d mock weak-topic reports\n", topic, n)
	}

	// Weakest skill (often title/rationale citation).
	if len(in.WeakSkills) > 0 {
		w := in.WeakSkills[0]
		fmt.Fprintf(sb, "  weakest_skill: %s (%s) progress=%d/100\n", w.SkillKey, w.Title, w.Progress)
	}

	// Repeated skipped item (avoidance pattern).
	if _, title, n := repeatedSkippedItem(in.SkippedRecent); n >= 2 {
		fmt.Fprintf(sb, "  repeated_skipped: %q skipped %d times\n", title, n)
	}

	// Available codex articles — critic must verify links exist.
	if len(in.CodexArticles) > 0 {
		sb.WriteString("  available_codex_links: ")
		for i, a := range in.CodexArticles {
			if i >= 5 {
				break
			}
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(sb, "%s", a.Link)
		}
		sb.WriteString("\n")
	}

	// Available note IDs — critic must verify review_note targets exist.
	if len(in.RecentNotes) > 0 {
		sb.WriteString("  available_note_ids: ")
		for i, n := range in.RecentNotes {
			if i >= 5 {
				break
			}
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(sb, "%s", n.NoteID.String())
		}
		sb.WriteString("\n")
	}

	// Available skipped item IDs — critic must verify unblock targets exist.
	if len(in.SkippedRecent) > 0 {
		sb.WriteString("  available_unblock_item_ids: ")
		for i, s := range in.SkippedRecent {
			if i >= 5 {
				break
			}
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(sb, "%s", s.ItemID)
		}
		sb.WriteString("\n")
	}
}

func buildBriefUserPrompt(in domain.BriefPromptInput) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "Today: %s\n\n", in.Today.Format("2006-01-02 (Monday)"))
	writeSignalDigest(&sb, in)
	writeCoachDiagnosis(&sb, in)
	writeActionCandidates(&sb, in)
	writeActionContract(&sb, in)

	// ── USER GOALS ─────────────────────────────────────────
	// High-level goals shape narrative framing — coach should mention the
	// active job_target / skill_target / track_target by name, и привязать
	// today's lever к движению по нему. Deadline-aware severity already
	// fires в deriveSeverity для критических случаев.
	if len(in.ActiveGoals) > 0 {
		sb.WriteString("USER GOALS (active — anchor narrative + at least one recommendation to the most-pressing one; deadline goals override skill/track when sooner):\n")
		for _, g := range in.ActiveGoals {
			fmt.Fprintf(&sb, "  - kind=%s · %q", g.Kind, g.Title)
			if g.DaysToDeadline >= 0 {
				fmt.Fprintf(&sb, " · in %d day(s)", g.DaysToDeadline)
			} else if g.Deadline == nil {
				sb.WriteString(" · no deadline")
			} else {
				fmt.Fprintf(&sb, " · OVERDUE by %d day(s)", -g.DaysToDeadline)
			}
			if len(g.SkillKeys) > 0 {
				fmt.Fprintf(&sb, " · skills=[%s]", strings.Join(g.SkillKeys, ","))
			}
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	// ── PENDING FOLLOW-UPS ────────────────────────────────
	// Coach должен в narrative или одной recommendation спросить «landed
	// ли X?» — иначе те же review_note/tiny_task будут предлагаться из
	// дня в день без feedback loop.
	if len(in.PendingFollowups) > 0 {
		sb.WriteString("PENDING FOLLOW-UPS (you suggested these recently — ASK whether they landed in the narrative or one recommendation, do NOT re-suggest verbatim):\n")
		for _, f := range in.PendingFollowups {
			fmt.Fprintf(&sb, "  - %s — kind=%s · %dh ago", f.Title, f.Kind, f.HoursAgo)
			if f.TargetID != "" {
				fmt.Fprintf(&sb, " · target=%s", f.TargetID)
			}
			sb.WriteString("\n")
		}
		sb.WriteString("\n")
	}

	// ── EXTERNAL ACTIVITY (LeetCode / Coursera / books / YouTube) ─────
	if in.External.MinutesWindow > 0 {
		fmt.Fprintf(&sb, "External learning last 7 days: %d min total via [%s]",
			in.External.MinutesWindow, strings.Join(in.External.Sources, ", "))
		if len(in.External.TopTopics) > 0 {
			fmt.Fprintf(&sb, "; top topics: %s", strings.Join(in.External.TopTopics, ", "))
		}
		sb.WriteString(". (Don't re-suggest these topics in today's plan; coach should mention progress on them.)\n\n")
	}

	// ── FORK STATUS ──────────────────
	// Активен только при mode='explore'. Coach использует чтобы:
	// (a) frame'ить «week N of 6 explore window»,
	// (b) namet'ить commit когда confidence высокая,
	// (c) воздерживаться от premature recommendation одной ветки когда
	//     scores близки.
	writeForkStatus(&sb, in)

	// ── RESOURCE TRAIL ───────────────
	// Сигналы из user_resource_log: что закрыто, что открыто, что
	// маркировано unhelpful. Coach не дублирует «прочитай X» если уже
	// finished, и видит когда юзер скейпает на новые без reflection.
	writeResourceTrail(&sb, in)

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
	severity, severityReason := deriveSeverity(in)
	fmt.Fprintf(sb, "  severity=%s · %s — match headline tone and narrative pressure to this grade.\n",
		severity, severityReason)
	// Stale-data guard: when the user has been off for >=14 days, every
	// "old" mock / arena / queue signal becomes context-only. Coach
	// MUST NOT cite a 22-day-old mock as if it were yesterday — the
	// pattern is dated and the user has likely forgotten the details.
	if days := daysSinceLastTouch(in); days >= LongAbsenceDays {
		fmt.Fprintf(sb, "  STALE_DATA_GUARD: last activity was %d days ago. Do NOT cite mock scores, arena losses, queue items, or focus stats as if they were current. Tone = welcome-back nudge. Recommendations = ONE small re-entry win (today's kata, one short focus block, schedule a fresh mock to recalibrate).\n", days)
	}
	fmt.Fprintf(sb, "  data_coverage: focus_days=%d mocks=%d queue_items=%d weak_skills=%d notes=%d cue_memories=%d codex_articles=%d past_coach=%d\n",
		len(in.FocusDays), len(in.Mocks), len(in.Queue.Items),
		len(in.WeakSkills), len(in.RecentNotes)+len(in.DailyNotes)+len(in.Reflections),
		len(in.CueMemories), len(in.CodexArticles), len(in.PastEpisodes))
	wrote := false
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
	// Surface the user's primary track. The first non-paused track wins
	// the digest slot; coach is steered to anchor today's recommendations
	// to its current step's skill_keys.
	for _, t := range in.ActiveTracks {
		if t.IsPaused {
			continue
		}
		stalledTag := ""
		if t.DaysSinceLastTouch >= 5 && t.DaysSinceLastTouch < 999 {
			stalledTag = fmt.Sprintf(" · stalled %dd", t.DaysSinceLastTouch)
		}
		skills := strings.Join(t.CurrentStepSkills, ",")
		if skills == "" {
			skills = "no-skill-key"
		}
		fmt.Fprintf(sb, "  P1 active_track: %s · step %d/%d %q · skills=[%s]%s\n",
			t.Name, t.CurrentStep+1, t.StepsTotal, t.CurrentStepTitle, skills, stalledTag)
		wrote = true
		break
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
		add(kw.Keyword, "mock_keywords", max(1, kw.Count))
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
	slices.SortFunc(out, func(a, b hit) int {
		if a.count == b.count {
			return strings.Compare(a.topic, b.topic)
		}
		return b.count - a.count
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
			domain.EpisodeCueConversationMemory,
			domain.EpisodeWeeklyMemorySummary,
			domain.EpisodeExternalActivity,
			domain.EpisodeCueSession,
			domain.EpisodeFocusReflectionAdded:
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

// writeForkStatus — печатает FORK STATUS блок только когда юзер в
// explore-режиме.
func writeForkStatus(sb *strings.Builder, in domain.BriefPromptInput) {
	if in.Fork.Mode != "explore" {
		return
	}
	sb.WriteString("FORK STATUS (user is in explore-mode — DO NOT push commit prematurely; mention current lean if confidence is clear):\n")
	fmt.Fprintf(sb, "  branch: explore · week %d\n", in.Fork.ExploreWeekIndex)
	if len(in.Fork.ScoresByBranch) > 0 {
		sb.WriteString("  scores: ")
		for i, b := range in.Fork.ScoresByBranch {
			if i > 0 {
				sb.WriteString(" · ")
			}
			fmt.Fprintf(sb, "%s %d mocks (avg %.0f), %d deep-dives",
				b.Branch, b.MockCount, b.AvgScore, b.VoluntaryDeepDives)
		}
		sb.WriteString("\n")
	}
	if in.Fork.CurrentBranch != "" {
		fmt.Fprintf(sb, "  declared lean: %s\n", in.Fork.CurrentBranch)
	}
	sb.WriteString("\n")
}

// writeResourceTrail — daily snapshot user_resource_log за last 7 days.
// Coach использует чтобы (a) не дублировать ссылки на finished, (b) знать
// про unfinished open tabs, (c) reflect missed reflections.
func writeResourceTrail(sb *strings.Builder, in domain.BriefPromptInput) {
	t := in.ResourceTrail
	if len(t.FinishedRecent) == 0 && t.UnfinishedCount == 0 && len(t.MarkedUnhelpful) == 0 && len(t.RecentReflections) == 0 {
		return
	}
	sb.WriteString("RESOURCE TRAIL · last 7 days (DON'T re-suggest URLs in `finished`; if `unhelpful` non-empty, prefer recommending alternatives):\n")
	if len(t.FinishedRecent) > 0 {
		sb.WriteString("  finished: ")
		for i, r := range t.FinishedRecent {
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(sb, "%s (%dh ago)", r.URL, r.HoursAgo)
		}
		sb.WriteString("\n")
	}
	if t.UnfinishedCount > 0 {
		fmt.Fprintf(sb, "  unfinished count: %d (clicked but not marked finished/skipped)\n", t.UnfinishedCount)
	}
	if len(t.MarkedUnhelpful) > 0 {
		sb.WriteString("  unhelpful: ")
		for i, r := range t.MarkedUnhelpful {
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(sb, "%s (%dh ago)", r.URL, r.HoursAgo)
		}
		sb.WriteString("\n")
	}
	if len(t.RecentReflections) > 0 {
		sb.WriteString("  recent reflections: ")
		for i, r := range t.RecentReflections {
			if i > 0 {
				sb.WriteString(" · ")
			}
			snippet := r.Reflection
			if len(snippet) > 80 {
				snippet = snippet[:80] + "…"
			}
			fmt.Fprintf(sb, "%q", snippet)
		}
		sb.WriteString("\n")
	}
	sb.WriteString("\n")
}
