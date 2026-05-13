package infra

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"druz9/intelligence/domain"
)

type coachDiagnosis struct {
	priority int
	key      string
	line     string
}

// coachSeverity is a deterministic urgency grade derived from the same
// signals the LLM sees. We pre-compute it (not the LLM) so the brain
// reasons about *how loud to be* before composing words. The grade then
// shapes headline tone, narrative pressure, and action scheduling.
type coachSeverity string

const (
	severityCruise   coachSeverity = "cruise"
	severityNudge    coachSeverity = "nudge"
	severityWarn     coachSeverity = "warn"
	severityCritical coachSeverity = "critical"
)

const focusedDaySeconds = 30 * 60

// LongAbsenceDays — beyond this gap with zero touchpoints (no focus, no
// mocks, no kata, no plan moves, no fresh notes) we treat the user as
// "returning after a long break". The coach then must NOT cite stale
// evidence as if it were live; severity drops to cruise and the
// headline is pinned to a welcome-back nudge. 14 days picks up
// vacation gaps without firing for the average weekend skipper.
const LongAbsenceDays = 14

// daysSinceLastTouch returns how many full days passed since the user
// last did *anything* the coach reads — focus, mock, kata, plan move
// (skip/complete), reflection note, daily note. Returns -1 when there
// is literally no signal in the input (fresh account); the caller
// treats that as "not stale, just empty".
//
// The function is cheap (single linear pass over already-loaded slices)
// and intentionally lives next to deriveSeverity so the long-absence
// branch stays right where the urgency grading lives.
func daysSinceLastTouch(in domain.BriefPromptInput) int {
	var newest time.Time
	bump := func(t time.Time) {
		if t.IsZero() {
			return
		}
		if newest.IsZero() || t.After(newest) {
			newest = t
		}
	}
	for _, d := range in.FocusDays {
		if d.Seconds > 0 {
			bump(d.Day)
		}
	}
	for _, m := range in.Mocks {
		bump(m.FinishedAt)
	}
	for _, c := range in.CompletedRecent {
		bump(c.PlanDate)
	}
	for _, s := range in.SkippedRecent {
		bump(s.PlanDate)
	}
	for _, r := range in.Reflections {
		bump(r.CreatedAt)
	}
	for _, n := range in.DailyNotes {
		bump(n.Day)
	}
	for _, n := range in.RecentNotes {
		bump(n.UpdatedAt)
	}
	if newest.IsZero() {
		return -1
	}
	today := in.Today.UTC().Truncate(24 * time.Hour)
	gap := today.Sub(newest.UTC().Truncate(24 * time.Hour))
	d := int(gap.Hours() / 24)
	if d < 0 {
		return 0
	}
	return d
}

// deriveSeverity ranks signals into one of four buckets. The reason
// returned is a short English fragment used in the SIGNAL DIGEST so the
// LLM knows *why* this severity was assigned and can echo it concretely.
//
// Long-absence guard runs FIRST. If the user has been off for
// LongAbsenceDays+, every "old" mock score / arena loss becomes stale
// evidence — citing it as fresh is dishonest. Severity drops to cruise
// with an explicit "welcome back" reason; the prompt sees a guard that
// blocks recommendations whose rationale leans on >7d-old facts.
// Critical interview events still override (an interview in 2 days is
// urgent regardless of whether the user opened the app yesterday).
//
// Rules (first match wins, top-down):
//   - critical: interview/exam ≤3 days, deadline ≤2 days, OR same plan
//     item skipped ≥4×, OR 3+ consecutive arena losses.
//   - cruise (long absence): no touchpoints in ≥LongAbsenceDays AND no
//     critical-event override above.
//   - warn:     interview ≤7 days, exam ≤7 days, deadline ≤5 days, OR
//     same mock weak_topic across ≥3 mocks, OR 2 same plan item skips,
//     OR all-zero focus week.
//   - nudge:    weak skill ≤30/100, broken kata streak, club_session
//     in ≤2 days with pre-read pinned, or open queue pressure.
//   - cruise:   nothing meaningful; healthy momentum or no data.
func deriveSeverity(in domain.BriefPromptInput) (coachSeverity, string) {
	// Critical signals — chronic avoidance + arena loss streak still
	// fire here. Calendar pressure was removed in the 2026-05-04 pivot
	// (personal_events drop), so interview/exam/deadline events no
	// longer surface as severity inputs.
	if _, _, n := repeatedSkippedItem(in.SkippedRecent); n >= 4 {
		return severityCritical, fmt.Sprintf("plan item skipped %d times — chronic avoidance", n)
	}
	// Phase 4.3 — goal deadline crit. job_target в 3 дня = равноценно
	// interview-event критическому: нужен срочный фокус. skill/track
	// goals с deadline считаем тоже — юзер сам поставил дедлайн.
	for _, g := range in.ActiveGoals {
		if g.Deadline == nil || g.DaysToDeadline < 0 {
			continue
		}
		if g.DaysToDeadline <= 3 {
			return severityCritical, fmt.Sprintf("goal %q (%s) due in %d day(s)",
				strings.TrimSpace(g.Title), g.Kind, g.DaysToDeadline)
		}
	}
	// Long absence — runs after critical-event detection so urgent dates
	// still surface, but before warn-grade signals so old mocks /
	// arena losses don't mislead the coach into "you're failing".
	if days := daysSinceLastTouch(in); days >= LongAbsenceDays {
		return severityCruise, fmt.Sprintf("welcome back — %d days off; old data is stale, treat today as a fresh start", days)
	}
	if topic, n := repeatedMockWeakTopic(in.Mocks); n >= 3 {
		return severityWarn, fmt.Sprintf("%s flagged weak in %d mocks", topic, n)
	}
	// Phase 4.3 — goal deadline warn. ≤7 дней = «приближается» — ниже
	// critical, но достаточно близко чтобы coach об этом сказал.
	for _, g := range in.ActiveGoals {
		if g.Deadline == nil || g.DaysToDeadline < 0 {
			continue
		}
		if g.DaysToDeadline <= 7 {
			return severityWarn, fmt.Sprintf("goal %q (%s) due in %d days",
				strings.TrimSpace(g.Title), g.Kind, g.DaysToDeadline)
		}
	}
	// Phase 4.7 — abandoned mock pipelines = consistency-break сигнал.
	// 2+ за 14 дней = pattern, не случайность; coach должен это проговорить
	// пока юзер не залип в loop'е start-mock-bail-out.
	if in.MockAbandonedRecent >= 2 {
		return severityWarn, fmt.Sprintf("%d mock pipelines abandoned in 14 days — consistency_break", in.MockAbandonedRecent)
	}
	if _, _, n := repeatedSkippedItem(in.SkippedRecent); n >= 2 {
		return severityWarn, fmt.Sprintf("plan item skipped %d times", n)
	}
	if focusedDays, totalMin := focusCoverage(in.FocusDays); len(in.FocusDays) >= 5 && focusedDays == 0 && totalMin < 30 {
		return severityWarn, fmt.Sprintf("near-zero deep focus across %d days", len(in.FocusDays))
	}
	if len(in.WeakSkills) > 0 && in.WeakSkills[0].Progress <= 30 {
		w := in.WeakSkills[0]
		return severityNudge, fmt.Sprintf("weakest skill %s at %d/100", w.SkillKey, w.Progress)
	}
	if in.Queue.Total > 0 && in.Queue.Done == 0 && (in.Queue.Todo+in.Queue.InProgress) >= 3 {
		return severityNudge, fmt.Sprintf("queue stalled: 0/%d done", in.Queue.Total)
	}
	// Phase 3 final — ghosted clubs. Если за неделю юзер пропустил ≥1
	// сессию на которую RSVP'нул_yes — это disengagement signal. nudge,
	// не warn: клубы — soft commitment, не hard как mock или goal.
	if len(in.GhostedClubs) > 0 {
		gc := in.GhostedClubs[0]
		topic := strings.TrimSpace(gc.TopicTitle)
		if topic == "" {
			topic = strings.TrimSpace(gc.ClubName)
		}
		if topic != "" {
			return severityNudge, fmt.Sprintf("RSVP'd_yes но не дошёл на %q (%d дн назад) — disengagement",
				topic, gc.HappenedAgo)
		}
	}
	// Phase 2d — track stalled. Active (non-paused) track that hasn't
	// seen activity for 5+ days = warn. Coach should call out the
	// specific step the user is stuck on.
	for _, t := range in.ActiveTracks {
		if t.IsPaused {
			continue
		}
		if t.DaysSinceLastTouch >= 5 && t.DaysSinceLastTouch < 999 {
			return severityWarn, fmt.Sprintf("track %q stalled %d days on step %d/%d (%s)",
				t.Name, t.DaysSinceLastTouch, t.CurrentStep+1, t.StepsTotal, t.CurrentStepTitle)
		}
	}
	return severityCruise, "no urgent bottleneck detected"
}

func writeCoachDiagnosis(sb *strings.Builder, in domain.BriefPromptInput) {
	items := coachDiagnoses(in)
	sb.WriteString("COACH DIAGNOSIS (ranked deterministic evidence; choose recommendations from here before raw sections):\n")
	if len(items) == 0 {
		sb.WriteString("  - sparse_data: no stable bottleneck yet; ask for first high-signal action instead of inventing a pattern.\n\n")
		return
	}
	for i, item := range items {
		fmt.Fprintf(sb, "  %d. %s\n", i+1, item.line)
	}
	sb.WriteString("\n")
}

func coachDiagnoses(in domain.BriefPromptInput) []coachDiagnosis {
	items := make([]coachDiagnosis, 0, 8)
	add := func(priority int, key, line string) {
		line = strings.TrimSpace(line)
		if line == "" {
			return
		}
		items = append(items, coachDiagnosis{priority: priority, key: key, line: line})
	}
	if topic, count := repeatedMockWeakTopic(in.Mocks); topic != "" {
		add(80+count, "mock-topic:"+topic,
			fmt.Sprintf("repeated_mock_weakness: %s appears in %d mock weak-topic reports", topic, count))
	}
	if key, title, count := repeatedSkippedItem(in.SkippedRecent); key != "" {
		add(65+count, "skipped:"+key,
			fmt.Sprintf("avoidance_pattern: skipped %q %d time(s) in recent plans", title, count))
	}
	if len(in.FocusDays) > 0 {
		focused, totalMin := focusCoverage(in.FocusDays)
		if focused < len(in.FocusDays) {
			add(55+(len(in.FocusDays)-focused), "focus-coverage",
				fmt.Sprintf("focus_coverage: %d/%d days reached 30+ min, total=%d min", focused, len(in.FocusDays), totalMin))
		}
	}
	if in.Queue.Total > 0 {
		add(50+in.Queue.Todo+in.Queue.InProgress, "queue",
			fmt.Sprintf("today_queue_pressure: done=%d/%d, in_progress=%d, todo=%d", in.Queue.Done, in.Queue.Total, in.Queue.InProgress, in.Queue.Todo))
	}
	if len(in.WeakSkills) > 0 {
		w := in.WeakSkills[0]
		add(45+(100-w.Progress)/10, "weak-skill:"+w.SkillKey,
			fmt.Sprintf("skill_atlas_gap: %s (%s) progress=%d/100", w.SkillKey, w.Title, w.Progress))
	}
	if topic, count := cueWeakTopic(in.CueMemories); topic != "" {
		add(40+count, "cue:"+topic,
			fmt.Sprintf("cue_memory_pattern: %s appears in %d useful Cue memory item(s)", topic, count))
	}
	slices.SortStableFunc(items, func(a, b coachDiagnosis) int {
		if a.priority == b.priority {
			return strings.Compare(a.key, b.key)
		}
		return b.priority - a.priority
	})
	return dedupeCoachDiagnoses(items, 8)
}

func dedupeCoachDiagnoses(items []coachDiagnosis, limit int) []coachDiagnosis {
	if limit <= 0 {
		return nil
	}
	out := make([]coachDiagnosis, 0, limit)
	seen := make(map[string]struct{}, limit)
	for _, item := range items {
		if _, ok := seen[item.key]; ok {
			continue
		}
		seen[item.key] = struct{}{}
		out = append(out, item)
		if len(out) >= limit {
			return out
		}
	}
	return out
}

func repeatedMockWeakTopic(mocks []domain.MockSessionSummary) (string, int) {
	counts := make(map[string]int)
	for _, m := range mocks {
		for _, raw := range m.WeakTopics {
			topic := normalizeTopic(raw)
			if topic == "" {
				continue
			}
			counts[topic]++
		}
	}
	return topCount(counts)
}

func repeatedSkippedItem(items []domain.SkippedPlanItem) (string, string, int) {
	counts := make(map[string]int)
	titles := make(map[string]string)
	for _, item := range items {
		key := normalizeTopic(item.SkillKey)
		if key == "" {
			key = recommendationDedupeKey(domain.RecommendationUnblock, item.Title, "")
		}
		if key == "" {
			continue
		}
		counts[key]++
		if titles[key] == "" {
			titles[key] = strings.TrimSpace(item.Title)
		}
	}
	key, count := topCount(counts)
	if count < 2 {
		return "", "", 0
	}
	return key, titles[key], count
}

func repeatedSkippedPlanItem(items []domain.SkippedPlanItem) (domain.SkippedPlanItem, int) {
	counts := make(map[string]int)
	first := make(map[string]domain.SkippedPlanItem)
	for _, item := range items {
		key := normalizeTopic(item.SkillKey)
		if key == "" {
			key = recommendationDedupeKey(domain.RecommendationUnblock, item.Title, "")
		}
		if key == "" {
			continue
		}
		counts[key]++
		if first[key].ItemID == "" {
			first[key] = item
		}
	}
	key, count := topCount(counts)
	if count < 2 {
		return domain.SkippedPlanItem{}, 0
	}
	return first[key], count
}

func noteForCurrentTopics(in domain.BriefPromptInput) (domain.NoteHead, string) {
	freshSince := in.Today.Add(-48 * time.Hour)
	topics := currentTopics(in, 8)
	for _, topic := range topics {
		needle := strings.ReplaceAll(topic, "-", " ")
		for _, note := range in.RecentNotes {
			if note.UpdatedAt.Before(freshSince) {
				continue
			}
			if isStaleStandupNote(note, in.Today) {
				continue
			}
			text := normalizeTopicText(note.Title + " " + note.Excerpt)
			if strings.Contains(text, needle) {
				return note, topic
			}
		}
	}
	return domain.NoteHead{}, ""
}

func isStaleStandupNote(note domain.NoteHead, today time.Time) bool {
	title := strings.ToLower(strings.TrimSpace(note.Title))
	return strings.HasPrefix(title, "standup ") && note.UpdatedAt.Before(today)
}

func codexArticleForCurrentTopics(in domain.BriefPromptInput) (domain.CodexArticleSuggestion, string) {
	topics := currentTopics(in, 8)
	for _, topic := range topics {
		needle := strings.ReplaceAll(topic, "-", " ")
		for _, article := range in.CodexArticles {
			text := normalizeTopicText(strings.Join([]string{
				article.Slug,
				article.Title,
				article.Description,
				article.Category,
			}, " "))
			if strings.Contains(text, needle) {
				return article, topic
			}
		}
	}
	if len(in.CodexArticles) > 0 {
		return in.CodexArticles[0], normalizeTopic(in.CodexArticles[0].Category)
	}
	return domain.CodexArticleSuggestion{}, ""
}

func currentTopics(in domain.BriefPromptInput, limit int) []string {
	if limit <= 0 {
		return nil
	}
	counts := make(map[string]int)
	add := func(raw string, weight int) {
		topic := normalizeTopic(raw)
		if topic == "" {
			return
		}
		counts[topic] += weight
	}
	for _, m := range in.Mocks {
		add(m.Section, 1)
		for _, w := range m.WeakTopics {
			add(w, 3)
		}
	}
	for _, w := range in.WeakSkills {
		add(w.SkillKey, 3)
		add(w.Title, 1)
	}
	for _, kw := range in.MockKeywords {
		add(kw.Keyword, max(1, kw.Count))
	}
	for _, ep := range in.CueMemories {
		_, topics := cuePromptMeta(ep.Payload)
		for _, topic := range strings.Split(topics, ",") {
			add(topic, 1)
		}
	}
	type kv struct {
		topic string
		count int
	}
	all := make([]kv, 0, len(counts))
	for topic, count := range counts {
		all = append(all, kv{topic: topic, count: count})
	}
	slices.SortFunc(all, func(a, b kv) int {
		if a.count == b.count {
			return strings.Compare(a.topic, b.topic)
		}
		return b.count - a.count
	})
	if len(all) > limit {
		all = all[:limit]
	}
	out := make([]string, 0, len(all))
	for _, item := range all {
		out = append(out, item.topic)
	}
	return out
}

func normalizeTopicText(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.NewReplacer("_", " ", "-", " ", "/", " ", "ё", "е").Replace(s)
	s = strings.Join(strings.Fields(s), " ")
	return s
}

func firstUndoneQueueLine(q domain.QueueSnapshot) (domain.QueueLine, bool) {
	for _, line := range q.Items {
		if strings.TrimSpace(line.Status) != "done" {
			return line, true
		}
	}
	return domain.QueueLine{}, false
}

func focusCoverage(days []domain.FocusDay) (focusedDays, totalMin int) {
	for _, d := range days {
		if d.Seconds >= focusedDaySeconds {
			focusedDays++
		}
		totalMin += d.Seconds / 60
	}
	return focusedDays, totalMin
}

func cueWeakTopic(rows []domain.Episode) (string, int) {
	counts := make(map[string]int)
	for _, ep := range rows {
		outcome, topics := cuePromptMeta(ep.Payload)
		if outcome != "weak" {
			continue
		}
		for _, raw := range strings.Split(topics, ",") {
			topic := normalizeTopic(raw)
			if topic == "" {
				continue
			}
			counts[topic]++
		}
	}
	return topCount(counts)
}

func topCount(counts map[string]int) (string, int) {
	bestKey := ""
	bestCount := 0
	for key, count := range counts {
		if count > bestCount || (count == bestCount && (bestKey == "" || key < bestKey)) {
			bestKey = key
			bestCount = count
		}
	}
	return bestKey, bestCount
}
