package infra

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"druz9/intelligence/domain"
)

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

	allowedLinks := allowedCodexLinks(in.CodexArticles)
	blockedPast := blockedRecommendationKeys(in.PastEpisodes)
	recs := make([]domain.Recommendation, 0, len(env.Recommendations))
	seen := make(map[string]struct{}, len(env.Recommendations))
	for _, r := range env.Recommendations {
		kind := normalizeRecommendationKind(r.Kind)
		title := sanitizeBriefLinks(strings.TrimSpace(r.Title), allowedLinks)
		if title == "" {
			continue
		}
		rationale := sanitizeBriefLinks(strings.TrimSpace(r.Rationale), allowedLinks)
		if isGenericRecommendation(title, rationale) {
			continue
		}
		target := strings.TrimSpace(r.TargetID)
		switch kind {
		case domain.RecommendationReviewNote:
			if _, ok := noteIDs[target]; !ok {
				continue
			}
		case domain.RecommendationUnblock:
			if _, ok := planItemIDs[target]; !ok {
				continue
			}
		case domain.RecommendationTinyTask, domain.RecommendationSchedule:
			target = ""
		default:
			target = ""
		}
		key := recommendationDedupeKey(kind, title, target)
		if _, exists := seen[key]; exists {
			continue
		}
		if _, repeatedPast := blockedPast[key]; repeatedPast {
			continue
		}
		seen[key] = struct{}{}
		recs = append(recs, domain.Recommendation{
			Kind:      kind,
			Title:     title,
			Rationale: rationale,
			TargetID:  target,
		})
	}
	enforceInterviewRecommendations(&recs, seen, blockedPast, in)
	fillRecommendationsFromCandidates(&recs, seen, blockedPast, in, 3)
	if len(recs) == 0 {
		return domain.DailyBrief{}, errors.New("all recommendations dropped as degenerate")
	}
	// Cap to 3 — LLM occasionally over-produces.
	if len(recs) > 3 {
		recs = recs[:3]
	}
	return domain.DailyBrief{
		Headline:        sanitizeBriefLinks(strings.TrimSpace(env.Headline), allowedLinks),
		Narrative:       sanitizeBriefLinks(strings.TrimSpace(env.Narrative), allowedLinks),
		Recommendations: recs,
	}, nil
}

func enforceInterviewRecommendations(
	recs *[]domain.Recommendation,
	seen map[string]struct{},
	blocked map[string]struct{},
	in domain.BriefPromptInput,
) {
	ui, ok := nearestUrgentInterview(in.UpcomingInterviews)
	if !ok {
		return
	}
	count := 0
	replaceIndexes := make([]int, 0, len(*recs))
	for i, rec := range *recs {
		if isInterviewRecommendation(rec, ui) {
			count++
		} else {
			replaceIndexes = append(replaceIndexes, i)
		}
	}
	if count >= 2 {
		return
	}
	for _, c := range interviewActionCandidates(in, ui) {
		if count >= 2 {
			return
		}
		key := recommendationDedupeKey(c.kind, c.title, c.targetID)
		if _, ok := seen[key]; ok {
			continue
		}
		if _, ok := blocked[key]; ok {
			continue
		}
		rec := domain.Recommendation{
			Kind:      c.kind,
			Title:     c.title,
			Rationale: c.rationale,
			TargetID:  c.targetID,
		}
		if len(*recs) < 3 {
			*recs = append(*recs, rec)
		} else if len(replaceIndexes) > 0 {
			idx := replaceIndexes[len(replaceIndexes)-1]
			replaceIndexes = replaceIndexes[:len(replaceIndexes)-1]
			(*recs)[idx] = rec
		} else {
			return
		}
		seen[key] = struct{}{}
		count++
	}
}

func isInterviewRecommendation(rec domain.Recommendation, ui domain.UpcomingInterview) bool {
	text := strings.ToLower(rec.Title + " " + rec.Rationale)
	if company := strings.ToLower(strings.TrimSpace(ui.CompanyName)); company != "" && strings.Contains(text, company) {
		return true
	}
	if role := strings.ToLower(strings.TrimSpace(ui.Role)); role != "" &&
		strings.Contains(text, role) &&
		strings.Contains(text, "interview") {
		return true
	}
	return false
}

func nearestUrgentInterview(items []domain.UpcomingInterview) (domain.UpcomingInterview, bool) {
	var best domain.UpcomingInterview
	ok := false
	for _, ui := range items {
		if ui.DaysFromNow < 0 || ui.DaysFromNow > 7 {
			continue
		}
		if !ok || ui.DaysFromNow < best.DaysFromNow {
			best = ui
			ok = true
		}
	}
	return best, ok
}

func fillRecommendationsFromCandidates(
	recs *[]domain.Recommendation,
	seen map[string]struct{},
	blocked map[string]struct{},
	in domain.BriefPromptInput,
	targetLen int,
) {
	if targetLen <= 0 || len(*recs) >= targetLen {
		return
	}
	for _, c := range coachActionCandidatesForPrompt(in, targetLen*4) {
		if len(*recs) >= targetLen {
			return
		}
		key := recommendationDedupeKey(c.kind, c.title, c.targetID)
		if _, ok := seen[key]; ok {
			continue
		}
		if _, ok := blocked[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		*recs = append(*recs, domain.Recommendation{
			Kind:      c.kind,
			Title:     c.title,
			Rationale: c.rationale,
			TargetID:  c.targetID,
		})
	}
}

func allowedCodexLinks(articles []domain.CodexArticleSuggestion) map[string]struct{} {
	out := make(map[string]struct{}, len(articles))
	for _, a := range articles {
		link := strings.TrimSpace(a.Link)
		if link == "" {
			continue
		}
		out[link] = struct{}{}
	}
	return out
}

func blockedRecommendationKeys(past []domain.Episode) map[string]struct{} {
	out := make(map[string]struct{})
	for _, ep := range past {
		//nolint:exhaustive // Only brief emission/dismissal episodes affect repeat blocking.
		switch ep.Kind {
		case domain.EpisodeBriefDismissed:
			addBlockedTitle(out, extractMemoryTitle(ep.Summary))
		case domain.EpisodeBriefEmitted:
			for _, title := range extractEmittedRecommendationTitles(ep.Payload) {
				addBlockedTitle(out, title)
			}
		}
	}
	return out
}

func addBlockedTitle(out map[string]struct{}, title string) {
	if title == "" || isGenericRecommendation(title, "") {
		return
	}
	out[recommendationDedupeKey(domain.RecommendationTinyTask, title, "")] = struct{}{}
	out[recommendationDedupeKey(domain.RecommendationSchedule, title, "")] = struct{}{}
	out[recommendationDedupeKey(domain.RecommendationReviewNote, title, "")] = struct{}{}
	out[recommendationDedupeKey(domain.RecommendationUnblock, title, "")] = struct{}{}
}

func extractMemoryTitle(summary string) string {
	s := strings.TrimSpace(summary)
	if s == "" {
		return ""
	}
	var payload struct {
		Title string `json:"title"`
	}
	if json.Unmarshal([]byte(s), &payload) == nil && strings.TrimSpace(payload.Title) != "" {
		return strings.TrimSpace(payload.Title)
	}
	return s
}

func extractEmittedRecommendationTitles(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var payload struct {
		Recommendations []struct {
			Title string `json:"title"`
		} `json:"recommendations"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	out := make([]string, 0, len(payload.Recommendations))
	for _, rec := range payload.Recommendations {
		if title := strings.TrimSpace(rec.Title); title != "" {
			out = append(out, title)
		}
	}
	return out
}

var markdownLinkRE = regexp.MustCompile(`\[([^\]\n]{1,120})\]\(([^)\s]{1,300})\)`)

func sanitizeBriefLinks(s string, allowed map[string]struct{}) string {
	if s == "" {
		return ""
	}
	return markdownLinkRE.ReplaceAllStringFunc(s, func(match string) string {
		parts := markdownLinkRE.FindStringSubmatch(match)
		if len(parts) != 3 {
			return match
		}
		label := strings.TrimSpace(parts[1])
		link := strings.TrimSpace(parts[2])
		if _, ok := allowed[link]; ok {
			return match
		}
		return label
	})
}

func normalizeRecommendationKind(raw string) domain.RecommendationKind {
	kind := domain.RecommendationKind(strings.ToLower(strings.TrimSpace(raw)))
	if kind.IsValid() {
		return kind
	}
	//nolint:exhaustive // Legacy aliases are the only invalid values normalized here.
	switch kind {
	case "drill_mock":
		return domain.RecommendationSchedule
	case "practice_skill", "drill_kata":
		return domain.RecommendationTinyTask
	default:
		return domain.RecommendationTinyTask
	}
}

func recommendationDedupeKey(kind domain.RecommendationKind, title, target string) string {
	normTitle := strings.ToLower(strings.TrimSpace(title))
	normTitle = strings.NewReplacer(
		"ё", "е",
		".", "",
		",", "",
		":", "",
		";", "",
		"—", " ",
		"-", " ",
	).Replace(normTitle)
	normTitle = strings.Join(strings.Fields(normTitle), " ")
	if len(normTitle) > 80 {
		normTitle = normTitle[:80]
	}
	if target != "" {
		return string(kind) + "|target|" + target
	}
	return string(kind) + "|title|" + normTitle
}

func isGenericRecommendation(title, rationale string) bool {
	s := strings.ToLower(title + " " + rationale)
	generic := []string{
		"practice algorithms",
		"do system design",
		"work on databases",
		"review your notes",
		"be consistent",
		"keep going",
		"stay consistent",
		"keep up the good work",
	}
	for _, phrase := range generic {
		if strings.Contains(s, phrase) {
			return true
		}
	}
	return false
}
