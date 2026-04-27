package infra

import (
	"testing"

	"druz9/intelligence/domain"
)

func TestCodexTopicSignalsNormalizeWithoutCategoryMap(t *testing.T) {
	signals := codexTopicSignals([]string{"system-design", "system design", "cache-design"})
	if len(signals) != 2 {
		t.Fatalf("signals len = %d, want 2", len(signals))
	}
	if signals[0].raw != "system_design" || signals[0].phrase != "system design" {
		t.Fatalf("first signal = %+v", signals[0])
	}
	if signals[1].raw != "cache_design" || signals[1].phrase != "cache design" {
		t.Fatalf("second signal = %+v", signals[1])
	}
}

func TestCodexScoreCandidateUsesArticleAndCategoryText(t *testing.T) {
	signals := codexTopicSignals([]string{"cache-design"})
	cacheArticle := codexCandidate{
		article: domain.CodexArticleSuggestion{
			Slug:        "caching-strategies",
			Title:       "Cache strategies",
			Description: "Read-through and write-back caching",
			Category:    "system_design",
			Source:      "AWS docs",
		},
	}
	cacheArticle.text = codexSearchText(cacheArticle.article, "System Design", "")
	cacheArticle.tokens = codexTokenSet(cacheArticle.text)

	capArticle := codexCandidate{
		article: domain.CodexArticleSuggestion{
			Slug:        "cap",
			Title:       "CAP theorem",
			Description: "Consistency, availability, partition tolerance",
			Category:    "system_design",
			Source:      "Wikipedia",
		},
	}
	capArticle.text = codexSearchText(capArticle.article, "System Design", "")
	capArticle.tokens = codexTokenSet(capArticle.text)

	cacheScore := codexScoreCandidate(cacheArticle, signals)
	capScore := codexScoreCandidate(capArticle, signals)
	if cacheScore <= capScore {
		t.Fatalf("cache score = %d, cap score = %d; cache article should rank higher", cacheScore, capScore)
	}
}

func TestCodexScoreCandidateMatchesDBCategorySlug(t *testing.T) {
	signals := codexTopicSignals([]string{"system design"})
	candidate := codexCandidate{
		article: domain.CodexArticleSuggestion{
			Slug:     "cap",
			Title:    "CAP theorem",
			Category: "system_design",
			Source:   "Wikipedia",
		},
	}
	candidate.text = codexSearchText(candidate.article, "System Design", "")
	candidate.tokens = codexTokenSet(candidate.text)

	if score := codexScoreCandidate(candidate, signals); score == 0 {
		t.Fatalf("score = 0, want category/text match")
	}
}
