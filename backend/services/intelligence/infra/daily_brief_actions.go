package infra

import (
	"fmt"
	"sort"
	"strings"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

type coachActionCandidate struct {
	priority  int
	kind      domain.RecommendationKind
	title     string
	rationale string
	targetID  string
	topic     string
}

func writeActionCandidates(sb *strings.Builder, in domain.BriefPromptInput) {
	candidates := coachActionCandidatesForPrompt(in, 8)
	sb.WriteString("ACTION CANDIDATES (use these as the safest source for recommendations; you may tighten wording but keep target_id exact):\n")
	if len(candidates) == 0 {
		sb.WriteString("  - kind=tiny_task title=\"Schedule one first mock interview.\" rationale=\"Sparse data: mock history is empty, so the coach needs a baseline.\" target_id=\"\"\n\n")
		return
	}
	for _, c := range candidates {
		fmt.Fprintf(sb, "  - kind=%s title=%q rationale=%q target_id=%q",
			c.kind, c.title, c.rationale, c.targetID)
		if c.topic != "" {
			fmt.Fprintf(sb, " topic=%q", c.topic)
		}
		sb.WriteString("\n")
	}
	sb.WriteString("\n")
}

func coachActionCandidatesForPrompt(in domain.BriefPromptInput, limit int) []coachActionCandidate {
	if limit <= 0 {
		return nil
	}
	out := make([]coachActionCandidate, 0, limit+4)
	add := func(priority int, kind domain.RecommendationKind, title, rationale, targetID, topic string) {
		title = strings.TrimSpace(title)
		rationale = strings.TrimSpace(rationale)
		if title == "" || rationale == "" {
			return
		}
		out = append(out, coachActionCandidate{
			priority:  priority,
			kind:      kind,
			title:     title,
			rationale: rationale,
			targetID:  strings.TrimSpace(targetID),
			topic:     normalizeTopic(topic),
		})
	}
	for _, ui := range in.UpcomingInterviews {
		if ui.DaysFromNow < 0 || ui.DaysFromNow > 7 {
			continue
		}
		for _, c := range interviewActionCandidates(in, ui) {
			add(c.priority, c.kind, c.title, c.rationale, c.targetID, c.topic)
		}
	}
	if topic, count := repeatedMockWeakTopic(in.Mocks); topic != "" {
		add(85+count, domain.RecommendationTinyTask,
			fmt.Sprintf("Write 3 concrete tradeoffs for %s.", topic),
			fmt.Sprintf("%s appears in %d recent mock weak-topic report(s).", topic, count),
			"", topic)
	}
	if item, count := repeatedSkippedPlanItem(in.SkippedRecent); item.ItemID != "" {
		add(78+count, domain.RecommendationUnblock,
			fmt.Sprintf("Open %q and do the first 5 minutes.", item.Title),
			fmt.Sprintf("Skipped %d time(s) recently; shrinking the first step breaks avoidance.", count),
			item.ItemID, item.SkillKey)
	}
	if note, topic := noteForCurrentTopics(in); note.NoteID != uuid.Nil {
		add(72, domain.RecommendationReviewNote,
			fmt.Sprintf("Open %q and extract one reusable rule.", note.Title),
			fmt.Sprintf("Recent note matches the active bottleneck %s.", topic),
			note.NoteID.String(), topic)
	}
	if article, topic := codexArticleForCurrentTopics(in); article.Link != "" {
		add(70, domain.RecommendationTinyTask,
			fmt.Sprintf("Read [%s](%s) and write 3 takeaways.", article.Title, article.Link),
			fmt.Sprintf("Curated Codex match for %s; source=%s, read_min=%d.", topic, article.Source, article.ReadMin),
			"", topic)
	}
	if section, losses := arenaLossStreak(in.Arena); losses > 0 {
		add(62+losses, domain.RecommendationTinyTask,
			fmt.Sprintf("Replay one failed %s arena pattern slowly.", section),
			fmt.Sprintf("Lost %d recent %s arena match(es); slow replay targets pattern recognition.", losses, section),
			"", section)
	}
	if line, ok := firstUndoneQueueLine(in.Queue); ok {
		add(58+in.Queue.Todo+in.Queue.InProgress, domain.RecommendationSchedule,
			fmt.Sprintf("Block 25 minutes for %q.", line.Title),
			fmt.Sprintf("Today's queue is %d/%d done with %d item(s) still todo.", in.Queue.Done, in.Queue.Total, in.Queue.Todo),
			"", line.SkillKey)
	}
	if len(in.WeakSkills) > 0 {
		w := in.WeakSkills[0]
		add(50+(100-w.Progress)/10, domain.RecommendationTinyTask,
			fmt.Sprintf("Do one focused drill for %s.", w.Title),
			fmt.Sprintf("Skill Atlas shows %s at %d/100.", w.SkillKey, w.Progress),
			"", w.SkillKey)
	}
	if in.KataStreak.Current > 0 {
		add(42+in.KataStreak.Current/3, domain.RecommendationTinyTask,
			"Do today's daily kata before anything else.",
			fmt.Sprintf("Current kata streak is %d days; this is a cheap consistency win.", in.KataStreak.Current),
			"", "algorithms")
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].priority == out[j].priority {
			return out[i].title < out[j].title
		}
		return out[i].priority > out[j].priority
	})
	return dedupeActionCandidates(out, limit)
}

func interviewActionCandidates(in domain.BriefPromptInput, ui domain.UpcomingInterview) []coachActionCandidate {
	if ui.DaysFromNow < 0 || ui.DaysFromNow > 7 {
		return nil
	}
	label := interviewLabel(ui)
	out := []coachActionCandidate{{
		priority:  100 - ui.DaysFromNow,
		kind:      domain.RecommendationSchedule,
		title:     fmt.Sprintf("Run one mock block for %s today.", label),
		rationale: fmt.Sprintf("%s interview is in %d days; self-readiness=%d%%.", label, ui.DaysFromNow, ui.ReadinessPct),
		topic:     normalizeTopic(ui.Role),
	}}
	if topic := topInterviewPrepTopic(in, ui); topic != "" {
		out = append(out, coachActionCandidate{
			priority:  99 - ui.DaysFromNow,
			kind:      domain.RecommendationTinyTask,
			title:     fmt.Sprintf("Do one %s drill for %s.", topic, label),
			rationale: fmt.Sprintf("%s interview is in %d days and current evidence points at %s.", label, ui.DaysFromNow, topic),
			topic:     topic,
		})
	}
	return out
}

func interviewLabel(ui domain.UpcomingInterview) string {
	parts := make([]string, 0, 2)
	if s := strings.TrimSpace(ui.CompanyName); s != "" {
		parts = append(parts, s)
	}
	if s := strings.TrimSpace(ui.Role); s != "" {
		parts = append(parts, s)
	}
	if len(parts) == 0 {
		return "upcoming interview"
	}
	return strings.Join(parts, " ")
}

func topInterviewPrepTopic(in domain.BriefPromptInput, ui domain.UpcomingInterview) string {
	if topic, _ := repeatedMockWeakTopic(in.Mocks); topic != "" {
		return topic
	}
	if len(in.WeakSkills) > 0 {
		if topic := normalizeTopic(in.WeakSkills[0].SkillKey); topic != "" {
			return topic
		}
	}
	if topic := normalizeTopic(ui.Role); topic != "" {
		return topic
	}
	for _, topic := range currentTopics(in, 3) {
		if topic != "" {
			return topic
		}
	}
	return ""
}

func dedupeActionCandidates(in []coachActionCandidate, limit int) []coachActionCandidate {
	out := make([]coachActionCandidate, 0, limit)
	seenTitle := make(map[string]struct{}, limit)
	for _, c := range in {
		key := recommendationDedupeKey(c.kind, c.title, c.targetID)
		if _, ok := seenTitle[key]; ok {
			continue
		}
		seenTitle[key] = struct{}{}
		out = append(out, c)
		if len(out) >= limit {
			return out
		}
	}
	return out
}

func writeActionContract(sb *strings.Builder, in domain.BriefPromptInput) {
	sb.WriteString("ACTION CONTRACT (parser enforces this after generation):\n")
	if len(in.RecentNotes) > 0 {
		sb.WriteString("  review_note target_id allow-list:\n")
		for _, n := range in.RecentNotes {
			fmt.Fprintf(sb, "    - %s title=%q\n", n.NoteID.String(), firstN(n.Title, 80))
		}
	} else {
		sb.WriteString("  review_note: unavailable; do not use this kind.\n")
	}
	if len(in.SkippedRecent) > 0 {
		sb.WriteString("  unblock target_id allow-list:\n")
		for _, item := range in.SkippedRecent {
			fmt.Fprintf(sb, "    - %s skill=%q title=%q\n", item.ItemID, item.SkillKey, firstN(item.Title, 80))
		}
	} else {
		sb.WriteString("  unblock: unavailable; do not use this kind.\n")
	}
	if len(in.CodexArticles) > 0 {
		sb.WriteString("  markdown link allow-list:\n")
		for _, a := range in.CodexArticles {
			fmt.Fprintf(sb, "    - %s title=%q\n", a.Link, firstN(a.Title, 80))
		}
	} else {
		sb.WriteString("  markdown links: unavailable; do not use markdown links.\n")
	}
	sb.WriteString("  Any invalid target_id or invented markdown link is removed from the final brief.\n\n")
}
