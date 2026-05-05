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
		"P1 latest_mock: section=system_design score=5/10",
		"P1 weakest_skill: sharding",
		"P1 codex_match: system_design · Cache strategies · 10 min · /codex?topic=system_design&article=caching-strategies",
		"P1 topic_convergence: sharding",
		"COACH DIAGNOSIS",
		"skill_atlas_gap: sharding",
		"ACTION CANDIDATES",
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
		Mocks: []domain.MockSessionSummary{
			{WeakTopics: []string{"redis", "cache-design"}},
			{WeakTopics: []string{"redis"}},
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
	}

	got := coachDiagnoses(in)
	if len(got) == 0 {
		t.Fatal("empty diagnoses")
	}
	joined := diagnosisLines(got)
	for _, want := range []string{
		"repeated_mock_weakness: cache-design appears in 3",
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
	}

	got := coachActionCandidatesForPrompt(in, 8)
	joined := actionCandidateLines(got)
	for _, want := range []string{
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

func TestCoachActionCandidatesDropGenericQueueItems(t *testing.T) {
	in := domain.BriefPromptInput{
		Queue: domain.QueueSnapshot{
			Total: 1,
			Todo:  1,
			Items: []domain.QueueLine{{
				Title:    "Solve a basic algorithmic problem",
				Status:   "todo",
				SkillKey: "dynamic_programming",
			}},
		},
	}

	got := coachActionCandidatesForPrompt(in, 8)
	joined := actionCandidateLines(got)
	if strings.Contains(joined, "Solve a basic algorithmic problem") {
		t.Fatalf("generic queue title leaked into candidates:\n%s", joined)
	}
	if !strings.Contains(joined, "one dynamic-programming drill") {
		t.Fatalf("specific skill-based replacement missing:\n%s", joined)
	}
}

func TestNoteForCurrentTopicsIgnoresStaleStandup(t *testing.T) {
	noteID := uuid.New()
	in := domain.BriefPromptInput{
		Today: time.Date(2026, 4, 28, 0, 0, 0, 0, time.UTC),
		Mocks: []domain.MockSessionSummary{{
			WeakTopics: []string{"cache-design"},
		}},
		RecentNotes: []domain.NoteHead{{
			NoteID:    noteID,
			Title:     "Standup 2026-04-25",
			Excerpt:   "cache design follow-up",
			UpdatedAt: time.Date(2026, 4, 25, 9, 0, 0, 0, time.UTC),
		}},
	}

	if note, topic := noteForCurrentTopics(in); note.NoteID != uuid.Nil || topic != "" {
		t.Fatalf("stale standup selected: note=%#v topic=%q", note, topic)
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
	if len(brief.Recommendations) == 0 {
		t.Fatalf("len=%d, want at least 1: %#v", len(brief.Recommendations), brief.Recommendations)
	}
	titles := recommendationTitles(brief.Recommendations)
	if !strings.Contains(titles, "Write one cache tradeoff.") {
		t.Fatalf("titles missing %q: %s", "Write one cache tradeoff.", titles)
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

func timePtr(t time.Time) *time.Time { return &t }

func TestDeriveSeverityRanksSignals(t *testing.T) {
	tests := []struct {
		name string
		in   domain.BriefPromptInput
		want coachSeverity
	}{
		{
			name: "skipped_4x_is_critical",
			in: domain.BriefPromptInput{
				SkippedRecent: []domain.SkippedPlanItem{
					{ItemID: "a", SkillKey: "prefix-sum", Title: "review prefix sum"},
					{ItemID: "b", SkillKey: "prefix-sum", Title: "review prefix sum"},
					{ItemID: "c", SkillKey: "prefix-sum", Title: "review prefix sum"},
					{ItemID: "d", SkillKey: "prefix-sum", Title: "review prefix sum"},
				},
			},
			want: severityCritical,
		},
		{
			name: "weak_skill_alone_is_nudge",
			in: domain.BriefPromptInput{
				WeakSkills: []domain.SkillWeak{{SkillKey: "graphs", Title: "Graphs", Progress: 18}},
			},
			want: severityNudge,
		},
		{
			// Phase 4.7 — abandoned mock pipelines = consistency-break warn.
			name: "two_abandoned_mocks_is_warn",
			in: domain.BriefPromptInput{
				MockAbandonedRecent: 2,
			},
			want: severityWarn,
		},
		{
			// Phase 4.3 — goal deadline ≤3 days → critical.
			name: "goal_due_in_2_days_is_critical",
			in: domain.BriefPromptInput{
				ActiveGoals: []domain.UserGoal{{
					Kind:           domain.UserGoalKindJob,
					Title:          "Yandex L4 offer",
					Deadline:       timePtr(time.Date(2026, 5, 2, 0, 0, 0, 0, time.UTC)),
					DaysToDeadline: 2,
				}},
			},
			want: severityCritical,
		},
		{
			// Phase 4.3 — goal deadline 4-7 days → warn.
			name: "goal_due_in_5_days_is_warn",
			in: domain.BriefPromptInput{
				ActiveGoals: []domain.UserGoal{{
					Kind:           domain.UserGoalKindSkill,
					Title:          "Системный дизайн до L4",
					Deadline:       timePtr(time.Date(2026, 5, 5, 0, 0, 0, 0, time.UTC)),
					DaysToDeadline: 5,
				}},
			},
			want: severityWarn,
		},
		{
			// Phase 4.3 — goal без deadline → не триггерит severity (cruise
			// если нет других сигналов).
			name: "goal_without_deadline_is_cruise",
			in: domain.BriefPromptInput{
				ActiveGoals: []domain.UserGoal{{
					Kind:           domain.UserGoalKindSkill,
					Title:          "Освоить Go",
					DaysToDeadline: -1,
				}},
			},
			want: severityCruise,
		},
		{
			// Single abandoned — random fluctuation, не паттерн. Cruise.
			name: "one_abandoned_mock_is_cruise",
			in: domain.BriefPromptInput{
				MockAbandonedRecent: 1,
			},
			want: severityCruise,
		},
		{
			name: "empty_input_is_cruise",
			in:   domain.BriefPromptInput{},
			want: severityCruise,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := deriveSeverity(tc.in)
			if got != tc.want {
				t.Fatalf("severity=%q, want %q", got, tc.want)
			}
		})
	}
}

func TestPinCriticalHeadlineOverridesGenericLLMHeadline(t *testing.T) {
	in := domain.BriefPromptInput{
		SkippedRecent: []domain.SkippedPlanItem{
			{ItemID: "p1", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p2", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p3", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p4", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
		},
	}
	got := pinCriticalHeadline("Stay focused and consistent.", in)
	if !strings.Contains(got, "Skipped") || !strings.Contains(got, "4") {
		t.Fatalf("pinned headline lost critical anchor: %q", got)
	}
}

func TestPinCriticalHeadlineNoOpForCruise(t *testing.T) {
	llm := "Steady week, ship one drill."
	got := pinCriticalHeadline(llm, domain.BriefPromptInput{})
	if got != llm {
		t.Fatalf("pin should not touch cruise-severity briefs: %q -> %q", llm, got)
	}
}

func TestLongAbsenceDropsToCruiseWithWelcomeBack(t *testing.T) {
	today := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	// Last activity 22 days ago (≥ LongAbsenceDays = 14).
	old := today.AddDate(0, 0, -22)
	in := domain.BriefPromptInput{
		Today:     today,
		FocusDays: []domain.FocusDay{{Day: old, Seconds: 1800}},
		Mocks: []domain.MockSessionSummary{{
			Section: "system_design", Score: 4, FinishedAt: old,
			WeakTopics: []string{"caching"},
		}},
	}
	got, reason := deriveSeverity(in)
	if got != severityCruise {
		t.Fatalf("severity=%q, want cruise after %dd absence", got, 22)
	}
	if !strings.Contains(reason, "22 days off") {
		t.Fatalf("reason should mention exact absence days, got %q", reason)
	}
}

func TestPinWelcomeBackOverridesGenericLLMHeadline(t *testing.T) {
	today := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	old := today.AddDate(0, 0, -18)
	in := domain.BriefPromptInput{
		Today: today,
		Mocks: []domain.MockSessionSummary{{
			Section: "algorithms", Score: 5, FinishedAt: old,
		}},
	}
	got := pinWelcomeBackHeadline("Caching gap — drill today.", in)
	if !strings.Contains(strings.ToLower(got), "welcome back") {
		t.Fatalf("welcome-back pin missing, got %q", got)
	}
}

func TestPinWelcomeBackKeepsLLMHeadlineThatGreetsAlready(t *testing.T) {
	today := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	old := today.AddDate(0, 0, -20)
	in := domain.BriefPromptInput{
		Today: today,
		Mocks: []domain.MockSessionSummary{{Section: "go", Score: 6, FinishedAt: old}},
	}
	llm := "Welcome back — start with one focus block."
	got := pinWelcomeBackHeadline(llm, in)
	if got != llm {
		t.Fatalf("pin overrode an already-welcoming headline: %q -> %q", llm, got)
	}
}

func TestCriticalSignalOverridesLongAbsence(t *testing.T) {
	today := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	in := domain.BriefPromptInput{
		Today: today,
		// Even after 30 days off, 4× same skipped item stays critical.
		SkippedRecent: []domain.SkippedPlanItem{
			{ItemID: "p1", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p2", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p3", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
			{ItemID: "p4", SkillKey: "prefix-sum", Title: "Review prefix-sum patterns"},
		},
		FocusDays: []domain.FocusDay{{
			Day: today.AddDate(0, 0, -30), Seconds: 1800,
		}},
	}
	got, reason := deriveSeverity(in)
	if got != severityCritical {
		t.Fatalf("severity=%q, want critical despite long absence", got)
	}
	if !strings.Contains(reason, "skipped") {
		t.Fatalf("reason should mention skipped pattern, got %q", reason)
	}
}

func TestDaysSinceLastTouchEmptyInputReturnsMinusOne(t *testing.T) {
	got := daysSinceLastTouch(domain.BriefPromptInput{
		Today: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
	})
	if got != -1 {
		t.Fatalf("daysSinceLastTouch on empty input = %d, want -1", got)
	}
}

func TestTrackStalledEscalatesToWarn(t *testing.T) {
	in := domain.BriefPromptInput{
		Today: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		ActiveTracks: []domain.ActiveTrack{{
			TrackID:            uuid.New(),
			Slug:               "yandex-backend-prep",
			Name:               "Yandex Backend Prep",
			CurrentStep:        3,
			StepsTotal:         6,
			CurrentStepTitle:   "Sysdesign · cache + consistency",
			CurrentStepSkills:  []string{"cache-design"},
			IsPaused:           false,
			DaysSinceLastTouch: 7,
		}},
	}
	got, reason := deriveSeverity(in)
	if got != severityWarn {
		t.Fatalf("severity=%q, want warn for stalled track", got)
	}
	if !strings.Contains(reason, "stalled 7 days") {
		t.Fatalf("reason should mention stalled days, got %q", reason)
	}
}

func TestTrackPausedDoesNotEscalate(t *testing.T) {
	in := domain.BriefPromptInput{
		Today: time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC),
		ActiveTracks: []domain.ActiveTrack{{
			TrackID:            uuid.New(),
			Slug:               "algorithms-full-cycle",
			Name:               "Algorithms",
			CurrentStep:        2,
			StepsTotal:         12,
			IsPaused:           true,
			DaysSinceLastTouch: 30,
		}},
	}
	got, _ := deriveSeverity(in)
	if got != severityCruise {
		t.Fatalf("severity=%q, want cruise for paused track (no signal)", got)
	}
}
