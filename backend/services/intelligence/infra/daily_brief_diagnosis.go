package infra

import (
	"fmt"
	"sort"
	"strings"

	"druz9/intelligence/domain"
)

type coachDiagnosis struct {
	priority int
	key      string
	line     string
}

const focusedDaySeconds = 30 * 60

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
	for _, ui := range in.UpcomingInterviews {
		if ui.DaysFromNow < 0 || ui.DaysFromNow > 7 {
			continue
		}
		add(100-ui.DaysFromNow, "interview:"+ui.CompanyName,
			fmt.Sprintf("interview_pressure: %s %s in %d days, readiness=%d%%",
				ui.CompanyName, ui.Role, ui.DaysFromNow, ui.ReadinessPct))
	}
	if topic, count := repeatedMockWeakTopic(in.Mocks); topic != "" {
		add(80+count, "mock-topic:"+topic,
			fmt.Sprintf("repeated_mock_weakness: %s appears in %d mock weak-topic reports", topic, count))
	}
	if section, losses := arenaLossStreak(in.Arena); losses > 0 {
		add(70+losses, "arena-loss:"+section,
			fmt.Sprintf("arena_loss_streak: lost %d recent %s match(es)", losses, section))
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
	if in.KataStreak.Current > 0 || in.KataStreak.Longest > 0 {
		last := "unknown"
		if in.KataStreak.LastKataDate != nil {
			last = in.KataStreak.LastKataDate.Format("2006-01-02")
		}
		add(35+in.KataStreak.Current/3, "kata",
			fmt.Sprintf("kata_consistency: current=%d longest=%d last=%s", in.KataStreak.Current, in.KataStreak.Longest, last))
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].priority == items[j].priority {
			return items[i].key < items[j].key
		}
		return items[i].priority > items[j].priority
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

func arenaLossStreak(matches []domain.ArenaMatchSummary) (string, int) {
	count := 0
	section := ""
	for _, m := range matches {
		if strings.TrimSpace(m.Outcome) != "lost" {
			break
		}
		count++
		if section == "" {
			section = normalizeTopic(m.Section)
			if section == "" {
				section = strings.TrimSpace(m.Section)
			}
		}
	}
	return section, count
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
	topics := currentTopics(in, 8)
	for _, topic := range topics {
		needle := strings.ReplaceAll(topic, "-", " ")
		for _, note := range in.RecentNotes {
			text := normalizeTopicText(note.Title + " " + note.Excerpt)
			if strings.Contains(text, needle) {
				return note, topic
			}
		}
	}
	return domain.NoteHead{}, ""
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
		add(kw.Keyword, maxInt(1, kw.Count))
	}
	for _, a := range in.Arena {
		add(a.Section, 2)
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
	sort.Slice(all, func(i, j int) bool {
		if all[i].count == all[j].count {
			return all[i].topic < all[j].topic
		}
		return all[i].count > all[j].count
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
