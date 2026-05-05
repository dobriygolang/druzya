package infra

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

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
	// Phase 4.6 — anti-suggestion-fatigue cooldown. Если за последние 14
	// дней юзер dismissed ≥3 recommendations одного kind'а, блокируем
	// весь kind на этот brief — coach должен искать другую leverage
	// rather than продолжать ту же категорию.
	cooledKinds := cooledDownKinds(in.PastEpisodes, in.Today, 14, 3)
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
		if _, cooled := cooledKinds[kind]; cooled {
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
	fillRecommendationsFromCandidates(&recs, seen, blockedPast, in, 3)
	if len(recs) == 0 {
		return domain.DailyBrief{}, errors.New("all recommendations dropped as degenerate")
	}
	// Cap to 3 — LLM occasionally over-produces.
	if len(recs) > 3 {
		recs = recs[:3]
	}
	headline := sanitizeBriefLinks(strings.TrimSpace(env.Headline), allowedLinks)
	narrative := sanitizeBriefLinks(strings.TrimSpace(env.Narrative), allowedLinks)
	headline = pinCriticalHeadline(headline, in)
	headline = pinWelcomeBackHeadline(headline, in)
	severity, severityReason := deriveSeverity(in)
	return domain.DailyBrief{
		Headline:        headline,
		Narrative:       narrative,
		Recommendations: recs,
		Severity:        coachSeverityToDomain(severity),
		SeverityReason:  severityReason,
	}, nil
}

// coachSeverityToDomain converts the infra-only enum into the wire-shared
// domain.InsightSeverity (cruise / nudge / warn / critical). Both share
// the same string values, but keeping the conversion explicit means a
// future rename of one will not silently desync the other.
func coachSeverityToDomain(s coachSeverity) domain.InsightSeverity {
	switch s {
	case severityCruise:
		return domain.InsightSeverityCruise
	case severityNudge:
		return domain.InsightSeverityNudge
	case severityWarn:
		return domain.InsightSeverityWarn
	case severityCritical:
		return domain.InsightSeverityCritical
	}
	return domain.InsightSeverityCruise
}

// pinWelcomeBackHeadline overrides the LLM headline when the user was
// off for ≥LongAbsenceDays AND severity didn't already get pinned by
// pinCriticalHeadline (interview-in-3-days etc keep their override).
//
// Why pin here too: even with STALE_DATA_GUARD in the prompt, the LLM
// occasionally drifts back to "Caching gap — drill today" using stale
// mocks. The deterministic pin is a safety net.
func pinWelcomeBackHeadline(headline string, in domain.BriefPromptInput) string {
	severity, _ := deriveSeverity(in)
	if severity != severityCruise {
		return headline
	}
	days := daysSinceLastTouch(in)
	if days < LongAbsenceDays {
		return headline
	}
	// LLM could already greet the user properly — don't re-pin.
	low := strings.ToLower(headline)
	if strings.Contains(low, "welcome back") || strings.Contains(low, "fresh start") || strings.Contains(low, "снова") {
		return headline
	}
	return fmt.Sprintf("Welcome back — %d days off. One small win today.", days)
}

// pinCriticalHeadline overrides a vague LLM headline when the deterministic
// severity is critical and the LLM didn't echo the dominant signal. We keep
// the LLM headline if it already mentions the company / topic / streak —
// only swap when it drifted to a generic "keep going" line.
func pinCriticalHeadline(headline string, in domain.BriefPromptInput) string {
	severity, _ := deriveSeverity(in)
	if severity != severityCritical {
		return headline
	}
	pinned, anchor := criticalHeadlineFor(in)
	if pinned == "" {
		return headline
	}
	if anchor != "" && strings.Contains(strings.ToLower(headline), strings.ToLower(anchor)) {
		return headline
	}
	return pinned
}

// criticalHeadlineFor builds the deterministic headline for a critical
// signal. Returns the headline plus an "anchor" string that, if present
// in the LLM's own headline, means we should leave it alone.
func criticalHeadlineFor(in domain.BriefPromptInput) (string, string) {
	if item, n := repeatedSkippedPlanItem(in.SkippedRecent); n >= 4 {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			title = strings.TrimSpace(item.SkillKey)
		}
		if title == "" {
			title = "the same item"
		}
		return fmt.Sprintf("Skipped %s %d×. Wall — break it today.", title, n), title
	}
	return "", ""
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

// cooledDownKinds — Phase 4.6 anti-fatigue. Возвращает множество
// recommendation-kinds, по которым юзер dismissed ≥threshold раз за
// последние windowDays. Эти kinds исключаются из текущего brief.
//
// Решение работает на rec_kind (не на title), потому что title-level
// блокировку уже делает blockedRecommendationKeys: если юзер прибил
// 3 разных tiny_task'а подряд — явный сигнал «не для меня этот формат
// сейчас», и нужен schedule/review_note/unblock вместо очередного
// tiny_task.
//
// windowDays используется относительно `now` (= in.Today). PastEpisodes
// уже ограничены SinceDays=30 в use case'е, так что мы лишь сужаем
// 30→14d. threshold=3 — обоснованный минимум для «pattern not noise».
func cooledDownKinds(past []domain.Episode, now time.Time, windowDays, threshold int) map[domain.RecommendationKind]struct{} {
	out := make(map[domain.RecommendationKind]struct{})
	if threshold <= 0 || windowDays <= 0 {
		return out
	}
	cutoff := now.Add(-time.Duration(windowDays) * 24 * time.Hour)
	counts := make(map[domain.RecommendationKind]int)
	for _, ep := range past {
		if ep.Kind != domain.EpisodeBriefDismissed {
			continue
		}
		if !ep.OccurredAt.IsZero() && ep.OccurredAt.Before(cutoff) {
			continue
		}
		kind := extractDismissedKind(ep.Payload)
		if kind == "" {
			continue
		}
		counts[kind]++
	}
	for kind, n := range counts {
		if n >= threshold {
			out[kind] = struct{}{}
		}
	}
	return out
}

// extractDismissedKind — payload pattern from app/memory.go AckRecommendation:
// {"brief_id":..., "index":..., "rec_kind": "tiny_task", "target_id":...}.
// При отсутствии rec_kind возвращает пустой kind — caller просто скипает.
func extractDismissedKind(raw []byte) domain.RecommendationKind {
	if len(raw) == 0 {
		return ""
	}
	var payload struct {
		RecKind string `json:"rec_kind"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ""
	}
	k := domain.RecommendationKind(strings.TrimSpace(payload.RecKind))
	if !k.IsValid() {
		return ""
	}
	return k
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
		"review the standup",
		"reviewing the standup",
		"start with the first item",
		"first item in the queue",
		"solve a basic algorithmic problem",
		"solve an algorithmic problem",
		"basic algorithmic problem",
		"block focus time",
		"be consistent",
		"keep going",
		"stay consistent",
		"keep up the good work",
	}
	return slices.ContainsFunc(generic, func(phrase string) bool { return strings.Contains(s, phrase) })
}
