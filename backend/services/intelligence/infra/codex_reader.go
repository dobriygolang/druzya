// CodexReader — curated Codex article suggestions for the daily-brief
// prompt. Pure pgx; lives in intelligence/infra so the intelligence-domain
// never depends on codex internals.
package infra

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CodexReader implements domain.CodexReader over codex_articles + codex_categories.
type CodexReader struct{ pool *pgxpool.Pool }

// NewCodexReader wraps a pool.
func NewCodexReader(pool *pgxpool.Pool) *CodexReader { return &CodexReader{pool: pool} }

type codexCandidate struct {
	article domain.CodexArticleSuggestion
	text    string
	tokens  map[string]struct{}
	score   int
	order   int
}

func (r *CodexReader) SuggestArticles(ctx context.Context, _ uuid.UUID, topics []string, limit int) ([]domain.CodexArticleSuggestion, error) {
	if limit <= 0 || limit > 12 {
		limit = 6
	}
	signals := codexTopicSignals(topics)
	if len(signals) == 0 {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx,
		`SELECT a.slug,
		        a.title,
		        a.description,
		        a.category,
		        a.source,
		        a.read_min,
		        COALESCE(c.label, ''),
		        COALESCE(c.description, '')
		   FROM codex_articles a
		   LEFT JOIN codex_categories c ON c.slug = a.category
		  WHERE a.active = true
		    AND COALESCE(c.active, true) = true
		  ORDER BY COALESCE(c.sort_order, 0), a.sort_order ASC
		  LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("intelligence.CodexReader: %w", err)
	}
	defer rows.Close()
	candidates := make([]codexCandidate, 0, 32)
	order := 0
	for rows.Next() {
		var a domain.CodexArticleSuggestion
		var categoryLabel, categoryDescription string
		if err := rows.Scan(
			&a.Slug,
			&a.Title,
			&a.Description,
			&a.Category,
			&a.Source,
			&a.ReadMin,
			&categoryLabel,
			&categoryDescription,
		); err != nil {
			return nil, fmt.Errorf("intelligence.CodexReader: scan: %w", err)
		}
		a.Link = "/codex?topic=" + url.QueryEscape(a.Category) + "&article=" + url.QueryEscape(a.Slug)
		text := codexSearchText(a, categoryLabel, categoryDescription)
		c := codexCandidate{
			article: a,
			text:    text,
			tokens:  codexTokenSet(text),
			order:   order,
		}
		order++
		c.score = codexScoreCandidate(c, signals)
		if c.score > 0 {
			candidates = append(candidates, c)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.CodexReader rows: %w", err)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].score == candidates[j].score {
			return candidates[i].order < candidates[j].order
		}
		return candidates[i].score > candidates[j].score
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	out := make([]domain.CodexArticleSuggestion, 0, len(candidates))
	for _, c := range candidates {
		out = append(out, c.article)
	}
	return out, nil
}

type codexSignal struct {
	raw    string
	phrase string
	tokens []string
}

func codexTopicSignals(topics []string) []codexSignal {
	seen := make(map[string]struct{}, len(topics))
	out := make([]codexSignal, 0, len(topics))
	for _, raw := range topics {
		phrase := codexNormalizeText(raw)
		if phrase == "" {
			continue
		}
		if _, ok := seen[phrase]; ok {
			continue
		}
		seen[phrase] = struct{}{}
		out = append(out, codexSignal{
			raw:    codexNormalizeSlug(raw),
			phrase: phrase,
			tokens: codexTokens(phrase),
		})
	}
	return out
}

func codexSearchText(a domain.CodexArticleSuggestion, categoryLabel, categoryDescription string) string {
	return codexNormalizeText(strings.Join([]string{
		a.Slug,
		a.Title,
		a.Description,
		a.Category,
		categoryLabel,
		categoryDescription,
		a.Source,
	}, " "))
}

func codexScoreCandidate(c codexCandidate, signals []codexSignal) int {
	score := 0
	category := codexNormalizeSlug(c.article.Category)
	slug := codexNormalizeSlug(c.article.Slug)
	for _, signal := range signals {
		if signal.raw != "" {
			if signal.raw == category {
				score += 12
			}
			if signal.raw == slug {
				score += 16
			}
		}
		if signal.phrase != "" && strings.Contains(c.text, signal.phrase) {
			score += 8
		}
		for _, token := range signal.tokens {
			if _, ok := c.tokens[token]; ok {
				score += 3
			}
		}
	}
	return score
}

func codexNormalizeSlug(raw string) string {
	return strings.Trim(strings.NewReplacer(" ", "_", "-", "_").Replace(strings.ToLower(strings.TrimSpace(raw))), "_")
}

func codexNormalizeText(raw string) string {
	return strings.Join(codexTokens(raw), " ")
}

func codexTokenSet(text string) map[string]struct{} {
	tokens := codexTokens(text)
	out := make(map[string]struct{}, len(tokens))
	for _, t := range tokens {
		out[t] = struct{}{}
	}
	return out
}

func codexTokens(raw string) []string {
	parts := strings.FieldsFunc(strings.ToLower(raw), func(r rune) bool {
		switch r {
		case ' ', '\t', '\n', '\r', '-', '_', '/', '.', ',', ':', ';', '(', ')', '[', ']', '{', '}', '|':
			return true
		default:
			return false
		}
	})
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if len([]rune(p)) < 2 {
			continue
		}
		out = append(out, p)
	}
	return out
}
