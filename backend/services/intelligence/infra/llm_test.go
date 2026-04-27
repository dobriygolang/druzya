package infra

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

func TestBuildBriefUserPromptIncludesSignalDigest(t *testing.T) {
	noteID := uuid.New()
	prompt := buildBriefUserPrompt(domain.BriefPromptInput{
		Today: time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC),
		UpcomingInterviews: []domain.UpcomingInterview{{
			CompanyName:  "Yandex",
			Role:         "backend",
			DaysFromNow:  3,
			ReadinessPct: 42,
		}},
		Mocks: []domain.MockSessionSummary{{
			Section:    "system_design",
			Score:      5,
			WeakTopics: []string{"sharding", "capacity-estimation"},
			FinishedAt: time.Date(2026, 4, 25, 0, 0, 0, 0, time.UTC),
		}},
		WeakSkills: []domain.SkillWeak{{
			SkillKey: "sharding",
			Title:    "Cache design",
			Progress: 12,
		}},
		MockKeywords: []domain.MockKeywords{{Keyword: "sharding", Count: 9}},
		RecentNotes: []domain.NoteHead{{
			NoteID:  noteID,
			Title:   "redis-deep-dive",
			Excerpt: "Redis notes",
		}},
		CodexArticles: []domain.CodexArticleSuggestion{{
			Slug:        "caching-strategies",
			Title:       "Cache strategies",
			Description: "Read-through and write-back caching patterns.",
			Category:    "system_design",
			Source:      "AWS docs",
			ReadMin:     10,
			Link:        "/codex?topic=system_design&article=caching-strategies",
		}},
		PastEpisodes: []domain.Episode{
			{Kind: domain.EpisodeBriefDismissed, Summary: "Practice algorithms"},
			{Kind: domain.EpisodeBriefFollowed, Summary: "Run one system_design mock"},
		},
	})

	for _, want := range []string{
		"SIGNAL DIGEST",
		"data_coverage:",
		"P0 upcoming_interview: Yandex backend in 3 days",
		"P1 latest_mock: section=system_design score=5/10",
		"P1 weakest_skill: sharding",
		"P1 codex_match: system_design · Cache strategies · 10 min · /codex?topic=system_design&article=caching-strategies",
		"P1 topic_convergence: sharding",
		"COACH DIAGNOSIS",
		"interview_pressure: Yandex backend in 3 days",
		"skill_atlas_gap: sharding",
		"ACTION CANDIDATES",
		"kind=schedule",
		"Available Codex curated articles",
		"slug=\"caching-strategies\"",
		"memory_avoid_repeating_dismissed",
		"memory_continue_if_relevant",
		"ANTI-REPEAT",
		"ACTION CONTRACT",
		"review_note target_id allow-list",
		noteID.String(),
		"markdown link allow-list",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestCoachDiagnosesRankCrossProductEvidence(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"outcome": "weak",
		"topics":  []string{"redis"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	in := domain.BriefPromptInput{
		Today: time.Date(2026, 4, 27, 0, 0, 0, 0, time.UTC),
		UpcomingInterviews: []domain.UpcomingInterview{{
			CompanyName:  "Yandex",
			Role:         "backend",
			DaysFromNow:  2,
			ReadinessPct: 35,
		}},
		Mocks: []domain.MockSessionSummary{
			{WeakTopics: []string{"redis", "cache-design"}},
			{WeakTopics: []string{"redis"}},
		},
		Arena: []domain.ArenaMatchSummary{
			{Section: "algorithms", Outcome: "lost"},
			{Section: "algorithms", Outcome: "lost"},
			{Section: "algorithms", Outcome: "won"},
		},
		SkippedRecent: []domain.SkippedPlanItem{
			{ItemID: "p1", SkillKey: "cache-design", Title: "Read cache notes"},
			{ItemID: "p2", SkillKey: "cache-design", Title: "Read cache notes"},
		},
		FocusDays: []domain.FocusDay{
			{Seconds: 0},
			{Seconds: focusedDaySeconds},
		},
		Queue:      domain.QueueSnapshot{Total: 3, Done: 0, InProgress: 1, Todo: 2},
		WeakSkills: []domain.SkillWeak{{SkillKey: "redis", Title: "Redis caching", Progress: 20}},
		CueMemories: []domain.Episode{{
			Kind:    domain.EpisodeCueConversationMemory,
			Payload: payload,
		}},
		KataStreak: domain.KataStreak{Current: 9, Longest: 12},
	}

	got := coachDiagnoses(in)
	if len(got) == 0 {
		t.Fatal("empty diagnoses")
	}
	if !strings.Contains(got[0].line, "interview_pressure") {
		t.Fatalf("first diagnosis=%q, want interview pressure", got[0].line)
	}
	joined := diagnosisLines(got)
	for _, want := range []string{
		"repeated_mock_weakness: cache-design appears in 3",
		"arena_loss_streak: lost 2 recent algorithms",
		"avoidance_pattern: skipped \"Read cache notes\" 2",
		"focus_coverage: 1/2 days reached 30+ min",
		"today_queue_pressure: done=0/3",
		"skill_atlas_gap: redis",
		"cue_memory_pattern: cache-design appears in 1",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("diagnoses missing %q:\n%s", want, joined)
		}
	}
}

func TestSignalDigestIgnoresPastInterviewPressure(t *testing.T) {
	var sb strings.Builder
	writeSignalDigest(&sb, domain.BriefPromptInput{
		UpcomingInterviews: []domain.UpcomingInterview{{
			CompanyName:  "PastCo",
			Role:         "backend",
			DaysFromNow:  -1,
			ReadinessPct: 20,
		}},
	})
	got := sb.String()
	if strings.Contains(got, "P0 upcoming_interview") {
		t.Fatalf("digest promoted past interview:\n%s", got)
	}
	if !strings.Contains(got, "sparse_data") {
		t.Fatalf("digest should remain sparse when only past interview exists:\n%s", got)
	}
}

func TestFirstNIsRuneAware(t *testing.T) {
	got := firstN("привет", 3)
	if got != "при…" {
		t.Fatalf("firstN=%q, want rune-aware cut", got)
	}
	if !utf8.ValidString(got) {
		t.Fatalf("firstN returned invalid utf-8: %q", got)
	}
}

func diagnosisLines(items []coachDiagnosis) string {
	var sb strings.Builder
	for _, item := range items {
		sb.WriteString(item.line)
		sb.WriteString("\n")
	}
	return sb.String()
}

func TestCoachActionCandidatesUseSpecificSafeActions(t *testing.T) {
	noteID := uuid.New()
	in := domain.BriefPromptInput{
		UpcomingInterviews: []domain.UpcomingInterview{{
			CompanyName:  "Yandex",
			Role:         "backend",
			DaysFromNow:  2,
			ReadinessPct: 35,
		}},
		Mocks: []domain.MockSessionSummary{
			{WeakTopics: []string{"cache-design"}},
			{WeakTopics: []string{"redis"}},
		},
		SkippedRecent: []domain.SkippedPlanItem{
			{ItemID: "plan-cache", SkillKey: "cache-design", Title: "Read cache notes"},
			{ItemID: "plan-cache-2", SkillKey: "cache-design", Title: "Read cache notes"},
		},
		RecentNotes: []domain.NoteHead{{
			NoteID:  noteID,
			Title:   "cache design notes",
			Excerpt: "Redis invalidation tradeoffs",
		}},
		Queue: domain.QueueSnapshot{
			Total: 2,
			Done:  0,
			Todo:  2,
			Items: []domain.QueueLine{{
				Title:    "Capacity estimation prompt",
				Status:   "todo",
				SkillKey: "system_design",
			}},
		},
		WeakSkills: []domain.SkillWeak{{SkillKey: "cache-design", Title: "Cache design", Progress: 18}},
		CodexArticles: []domain.CodexArticleSuggestion{{
			Title:       "Cache strategies",
			Slug:        "caching-strategies",
			Description: "Caching patterns",
			Category:    "system_design",
			Source:      "AWS docs",
			ReadMin:     10,
			Link:        "/codex?topic=system_design&article=caching-strategies",
		}},
		KataStreak: domain.KataStreak{Current: 6},
	}

	got := coachActionCandidatesForPrompt(in, 8)
	joined := actionCandidateLines(got)
	for _, want := range []string{
		"Run one mock block for Yandex backend today.",
		"Do one cache-design drill for Yandex backend.",
		"Write 3 concrete tradeoffs for cache-design.",
		"target=plan-cache",
		"target=" + noteID.String(),
		"[Cache strategies](/codex?topic=system_design&article=caching-strategies)",
		"Block 25 minutes for \"Capacity estimation prompt\".",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("action candidates missing %q:\n%s", want, joined)
		}
	}
}

func actionCandidateLines(items []coachActionCandidate) string {
	var sb strings.Builder
	for _, item := range items {
		fmt.Fprintf(&sb, "%s | %s | target=%s\n", item.kind, item.title, item.targetID)
	}
	return sb.String()
}

func TestParseBriefJSONNormalizesLegacyKindsAndDedupes(t *testing.T) {
	raw := `{
		"headline":"Redis gap before interview.",
		"narrative":"System design mock scored 5/10. Redis appeared 12 times in recent practice.",
		"recommendations":[
			{"kind":"drill_mock","title":"Run a system_design mock today.","rationale":"Interview is in 3 days.","target_id":"system_design"},
			{"kind":"drill_mock","title":"Run a system_design mock today.","rationale":"Duplicate should be dropped.","target_id":"system_design"},
			{"kind":"practice_skill","title":"Solve one cache invalidation prompt.","rationale":"cache-design progress is 12/100.","target_id":"cache-design"},
			{"kind":"drill_kata","title":"Do today's daily kata.","rationale":"Streak is at risk.","target_id":""}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if len(brief.Recommendations) != 3 {
		t.Fatalf("len=%d, want 3: %#v", len(brief.Recommendations), brief.Recommendations)
	}
	if brief.Recommendations[0].Kind != domain.RecommendationSchedule {
		t.Fatalf("first kind=%q, want schedule", brief.Recommendations[0].Kind)
	}
	if brief.Recommendations[0].TargetID != "" {
		t.Fatalf("schedule target=%q, want empty", brief.Recommendations[0].TargetID)
	}
	if brief.Recommendations[1].Kind != domain.RecommendationTinyTask {
		t.Fatalf("second kind=%q, want tiny_task", brief.Recommendations[1].Kind)
	}
	if brief.Recommendations[2].Kind != domain.RecommendationTinyTask {
		t.Fatalf("third kind=%q, want tiny_task", brief.Recommendations[2].Kind)
	}
}

func TestParseBriefJSONDropsGenericRecommendations(t *testing.T) {
	raw := `{
		"headline":"Sparse data, start with signal.",
		"narrative":"Only one cue memory exists, so the brief should avoid fake certainty.",
		"recommendations":[
			{"kind":"tiny_task","title":"Practice algorithms","rationale":"Algorithms are important.","target_id":""},
			{"kind":"schedule","title":"Block 30 minutes for one system_design cache prompt.","rationale":"Cue memory mentioned cache-design as a weak answer today.","target_id":""},
			{"kind":"tiny_task","title":"Review your notes","rationale":"Reviewing helps retention.","target_id":""}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if len(brief.Recommendations) != 1 {
		t.Fatalf("len=%d, want 1: %#v", len(brief.Recommendations), brief.Recommendations)
	}
	if brief.Recommendations[0].Title != "Block 30 minutes for one system_design cache prompt." {
		t.Fatalf("title=%q", brief.Recommendations[0].Title)
	}
}

func TestParseBriefJSONDropsInvalidTargetedActions(t *testing.T) {
	raw := `{
		"headline":"Redis gap before interview.",
		"narrative":"The latest mock exposed cache-design.",
		"recommendations":[
			{"kind":"review_note","title":"Open redis note.","rationale":"The note exists in memory.","target_id":"made-up-note"},
			{"kind":"unblock","title":"Unblock cache review.","rationale":"Skipped repeatedly.","target_id":"made-up-plan-item"},
			{"kind":"tiny_task","title":"Write 3 cache invalidation tradeoffs.","rationale":"cache-design is the repeated weak topic.","target_id":""}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if len(brief.Recommendations) != 1 {
		t.Fatalf("len=%d, want 1: %#v", len(brief.Recommendations), brief.Recommendations)
	}
	if brief.Recommendations[0].Kind != domain.RecommendationTinyTask {
		t.Fatalf("kind=%q, want tiny_task", brief.Recommendations[0].Kind)
	}
}

func TestParseBriefJSONBackfillsFromActionCandidates(t *testing.T) {
	raw := `{
		"headline":"Cache gap before interview.",
		"narrative":"The latest mock exposed cache-design.",
		"recommendations":[
			{"kind":"review_note","title":"Open missing note.","rationale":"Invalid target.","target_id":"made-up-note"},
			{"kind":"tiny_task","title":"Write one cache tradeoff.","rationale":"cache-design is repeated.","target_id":""},
			{"kind":"tiny_task","title":"Practice algorithms","rationale":"Generic filler.","target_id":""}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{
		UpcomingInterviews: []domain.UpcomingInterview{{
			CompanyName:  "Yandex",
			Role:         "backend",
			DaysFromNow:  2,
			ReadinessPct: 35,
		}},
		Mocks: []domain.MockSessionSummary{
			{WeakTopics: []string{"cache-design"}},
			{WeakTopics: []string{"redis"}},
		},
		Queue: domain.QueueSnapshot{
			Total: 2,
			Done:  0,
			Todo:  2,
			Items: []domain.QueueLine{{
				Title:  "Capacity estimation prompt",
				Status: "todo",
			}},
		},
	})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if len(brief.Recommendations) != 3 {
		t.Fatalf("len=%d, want 3: %#v", len(brief.Recommendations), brief.Recommendations)
	}
	titles := recommendationTitles(brief.Recommendations)
	for _, want := range []string{
		"Write one cache tradeoff.",
		"Run one mock block for Yandex backend today.",
		"Do one cache-design drill for Yandex backend.",
	} {
		if !strings.Contains(titles, want) {
			t.Fatalf("titles missing %q: %s", want, titles)
		}
	}
}

func TestParseBriefJSONEnforcesUrgentInterviewRecommendations(t *testing.T) {
	raw := `{
		"headline":"Cache gap remains.",
		"narrative":"There is an interview soon, but recommendations ignored it.",
		"recommendations":[
			{"kind":"tiny_task","title":"Write one cache tradeoff.","rationale":"cache-design is repeated.","target_id":""},
			{"kind":"schedule","title":"Block 25 minutes for queue cleanup.","rationale":"Queue is behind.","target_id":""},
			{"kind":"tiny_task","title":"Do today's daily kata.","rationale":"Streak is active.","target_id":""}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{
		UpcomingInterviews: []domain.UpcomingInterview{{
			CompanyName:  "Yandex",
			Role:         "backend",
			DaysFromNow:  2,
			ReadinessPct: 35,
		}},
		Mocks: []domain.MockSessionSummary{{WeakTopics: []string{"cache-design"}}},
	})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if len(brief.Recommendations) != 3 {
		t.Fatalf("len=%d, want 3", len(brief.Recommendations))
	}
	titles := recommendationTitles(brief.Recommendations)
	for _, want := range []string{
		"Run one mock block for Yandex backend today.",
		"Do one cache-design drill for Yandex backend.",
	} {
		if !strings.Contains(titles, want) {
			t.Fatalf("titles missing %q:\n%s", want, titles)
		}
	}
}

func TestParseBriefJSONKeepsValidTargets(t *testing.T) {
	noteID := uuid.New()
	raw := `{
		"headline":"Redis note is actionable.",
		"narrative":"The latest mock exposed cache-design.",
		"recommendations":[
			{"kind":"review_note","title":"Open redis note.","rationale":"Recent note has Redis material.","target_id":"` + noteID.String() + `"},
			{"kind":"unblock","title":"Read first cache paragraph.","rationale":"Skipped repeatedly.","target_id":"plan-1"}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{
		RecentNotes:   []domain.NoteHead{{NoteID: noteID, Title: "redis"}},
		SkippedRecent: []domain.SkippedPlanItem{{ItemID: "plan-1", Title: "cache"}},
	})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if len(brief.Recommendations) != 2 {
		t.Fatalf("len=%d, want 2: %#v", len(brief.Recommendations), brief.Recommendations)
	}
	if brief.Recommendations[0].TargetID != noteID.String() {
		t.Fatalf("note target=%q", brief.Recommendations[0].TargetID)
	}
	if brief.Recommendations[1].TargetID != "plan-1" {
		t.Fatalf("plan target=%q", brief.Recommendations[1].TargetID)
	}
}

func recommendationTitles(recs []domain.Recommendation) string {
	var sb strings.Builder
	for _, rec := range recs {
		sb.WriteString(rec.Title)
		sb.WriteString("\n")
	}
	return sb.String()
}

func TestParseBriefJSONSanitizesInventedLinks(t *testing.T) {
	raw := `{
		"headline":"Use [cache](/codex?topic=system_design&article=caching-strategies).",
		"narrative":"Do not open [fake](/codex?topic=made_up&article=nope), use [cache](/codex?topic=system_design&article=caching-strategies).",
		"recommendations":[
			{"kind":"tiny_task","title":"Read [fake](/codex?topic=x&article=y).","rationale":"Then read [cache](/codex?topic=system_design&article=caching-strategies).","target_id":""}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{
		CodexArticles: []domain.CodexArticleSuggestion{{
			Link: "/codex?topic=system_design&article=caching-strategies",
		}},
	})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if strings.Contains(brief.Narrative, "/codex?topic=made_up") {
		t.Fatalf("narrative kept invented link: %q", brief.Narrative)
	}
	if !strings.Contains(brief.Narrative, "[cache](/codex?topic=system_design&article=caching-strategies)") {
		t.Fatalf("narrative lost allowed link: %q", brief.Narrative)
	}
	if strings.Contains(brief.Recommendations[0].Title, "/codex?topic=x") {
		t.Fatalf("title kept invented link: %q", brief.Recommendations[0].Title)
	}
	if !strings.Contains(brief.Recommendations[0].Rationale, "[cache](/codex?topic=system_design&article=caching-strategies)") {
		t.Fatalf("rationale lost allowed link: %q", brief.Recommendations[0].Rationale)
	}
}

func TestParseBriefJSONDropsDismissedRepeat(t *testing.T) {
	raw := `{
		"headline":"Cache remains the bottleneck.",
		"narrative":"The latest mock exposed cache-design again.",
		"recommendations":[
			{"kind":"tiny_task","title":"Write 3 cache invalidation tradeoffs.","rationale":"cache-design is weak.","target_id":""},
			{"kind":"schedule","title":"Run a system_design mock today.","rationale":"Last mock was weak on cache-design.","target_id":""}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{
		PastEpisodes: []domain.Episode{{
			Kind:    domain.EpisodeBriefDismissed,
			Summary: `{"title":"Write 3 cache invalidation tradeoffs."}`,
		}},
	})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if len(brief.Recommendations) != 1 {
		t.Fatalf("len=%d, want 1: %#v", len(brief.Recommendations), brief.Recommendations)
	}
	if brief.Recommendations[0].Title != "Run a system_design mock today." {
		t.Fatalf("title=%q", brief.Recommendations[0].Title)
	}
}

func TestParseBriefJSONDropsRecentlyEmittedRepeat(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"brief_id": "brief-1",
		"recommendations": []map[string]any{{
			"kind":  "tiny_task",
			"title": "Write 3 cache invalidation tradeoffs.",
		}},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	raw := `{
		"headline":"Cache remains the bottleneck.",
		"narrative":"The latest mock exposed cache-design again.",
		"recommendations":[
			{"kind":"tiny_task","title":"Write 3 cache invalidation tradeoffs.","rationale":"cache-design is weak.","target_id":""},
			{"kind":"schedule","title":"Run a system_design mock today.","rationale":"Last mock was weak on cache-design.","target_id":""}
		]
	}`

	brief, err := parseBriefJSON(raw, domain.BriefPromptInput{
		PastEpisodes: []domain.Episode{{
			Kind:    domain.EpisodeBriefEmitted,
			Summary: "Old brief",
			Payload: payload,
		}},
	})
	if err != nil {
		t.Fatalf("parseBriefJSON: %v", err)
	}
	if len(brief.Recommendations) != 1 {
		t.Fatalf("len=%d, want 1: %#v", len(brief.Recommendations), brief.Recommendations)
	}
	if brief.Recommendations[0].Title != "Run a system_design mock today." {
		t.Fatalf("title=%q", brief.Recommendations[0].Title)
	}
}

func TestConvergedTopicsUsesMultipleSources(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"outcome": "weak",
		"topics":  []string{"redis", "system design"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := convergedTopics(domain.BriefPromptInput{
		Mocks: []domain.MockSessionSummary{{
			Section:    "system_design",
			WeakTopics: []string{"cache-design"},
			Score:      5,
		}},
		WeakSkills:   []domain.SkillWeak{{SkillKey: "cache-design", Title: "Caching", Progress: 12}},
		MockKeywords: []domain.MockKeywords{{Keyword: "redis", Count: 8}},
		CueMemories: []domain.Episode{{
			Kind:    domain.EpisodeCueConversationMemory,
			Summary: "Weak Redis answer",
			Payload: payload,
		}},
	}, 3)
	if len(got) == 0 || !strings.Contains(got[0], "cache-design") {
		t.Fatalf("converged topics=%v, want cache-design first", got)
	}
}

func TestUUIDOrNilParsesBriefID(t *testing.T) {
	id := uuid.New()
	if got := uuidOrNil(id.String()); got != id {
		t.Fatalf("uuidOrNil=%s, want %s", got, id)
	}
	if got := uuidOrNil(""); got != uuid.Nil {
		t.Fatalf("uuidOrNil empty=%s, want nil", got)
	}
}
