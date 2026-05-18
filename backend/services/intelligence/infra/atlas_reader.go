// atlas_reader.go — bridges intelligence.GetUserContext.AtlasReader
// into the atlas_nodes catalogue (services/curation owns the writes;
// this is read-only).
//
// Strategy (semantic-free):
//   - Tokenise goalText (active goal kind + company + custom text) into
//     keywords and run ILIKE matches against atlas_nodes.title + description.
//   - Boost nodes whose section/cluster overlaps recentActivity kinds.
//   - De-rank nodes the user has already mastered (skill_nodes.progress=100).
//   - Cap at limit (default 5). Each match returns one AtlasResourceRef: ID
//     points to the node, URL is the first curated external_resource (when
//     present) so the Cue copilot can deep-link.
//
// Why ILIKE rather than pg_trgm / vectors:
//   - atlas_nodes is small (~30 rows seeded; <1000 after F-curation produces).
//   - Goal text is also short (few words).
//   - Vector/embedding upgrade can come once the corpus grows.
//
// Why no caching here: GetUserContext is itself cached at the copilot
// boundary (Redis 60s TTL). Adapter stays stateless.
package infra

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	intelApp "druz9/intelligence/app"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AtlasReaderAdapter implements intelApp.AtlasReader.
type AtlasReaderAdapter struct {
	pool *pgxpool.Pool
}

// NewAtlasReaderAdapter wires the adapter.
func NewAtlasReaderAdapter(pool *pgxpool.Pool) intelApp.AtlasReader {
	return &AtlasReaderAdapter{pool: pool}
}

// Compile-time guard.
var _ intelApp.AtlasReader = (*AtlasReaderAdapter)(nil)

// TopRelevantNodes returns up to `limit` atlas nodes most relevant to the
// user's goal + recent activity, projected as AtlasResourceRef.
//
// Result ordering (DESC by score):
//
//	+3 per keyword hit on title (strongest signal)
//	+2 per keyword hit on description
//	+2 per recentActivity match on section
//	+1 per recentActivity match on cluster
//	−5 if user has already maxed this node (skill_nodes.progress=100)
//
// Ties are broken by total_count ASC (smaller node = quicker win).
func (a *AtlasReaderAdapter) TopRelevantNodes(
	ctx context.Context,
	userID uuid.UUID,
	goalText string,
	recentActivity []intelApp.ActivityKind,
	limit int,
) ([]intelApp.AtlasResourceRef, error) {
	if a == nil || a.pool == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 5
	}
	if limit > 25 {
		limit = 25
	}

	keywords := tokenizeAtlasGoal(goalText)
	activityKeys := normaliseActivityKeys(recentActivity)

	// Build candidate set: any node matching at least one keyword OR any
	// section/cluster matching an activity kind. ILIKE with leading '%'
	// can't use btree index, but seeded corpus is tiny so a full scan is
	// cheap (<1ms).
	const baseQuery = `
		SELECT n.id,
		       n.title,
		       COALESCE(n.description, '') AS description,
		       COALESCE(n.section, '')     AS section,
		       COALESCE(n.cluster, '')     AS cluster,
		       n.total_count,
		       COALESCE(n.external_resources, '[]'::jsonb)::text AS resources_json,
		       COALESCE(sn.progress, 0)    AS progress
		  FROM atlas_nodes n
		  LEFT JOIN skill_nodes sn
		    ON sn.user_id = $1 AND sn.node_key = n.id
		 WHERE n.is_active = TRUE
		 LIMIT 1000`

	rows, err := a.pool.Query(ctx, baseQuery, userID)
	if err != nil {
		return nil, fmt.Errorf("intelligence.AtlasReaderAdapter.TopRelevantNodes: %w", err)
	}
	defer rows.Close()

	type scored struct {
		ref   intelApp.AtlasResourceRef
		score int
		total int
	}
	scoredNodes := make([]scored, 0, 32)

	for rows.Next() {
		var (
			id, title, description, section, cluster, resources string
			total, progress                                     int
		)
		if scanErr := rows.Scan(&id, &title, &description, &section, &cluster, &total, &resources, &progress); scanErr != nil {
			return nil, fmt.Errorf("intelligence.AtlasReaderAdapter scan: %w", scanErr)
		}

		score := scoreAtlasNode(title, description, section, cluster, keywords, activityKeys)
		if progress >= 100 {
			score -= 5
		}
		// Below-zero score means the node was neither matched nor activity-
		// adjacent; skip outright so the result set stays meaningful when
		// the user has no goal/activity yet.
		if score <= 0 {
			continue
		}

		ref := intelApp.AtlasResourceRef{ID: id, Title: title}
		// Best-effort: project the first curated external resource so Cue
		// can deep-link. When external_resources is empty we still emit
		// the node (atlas page deep-link instead).
		if url, kind := firstExternalResource(resources); url != "" {
			ref.URL = url
			ref.Kind = kind
		}
		scoredNodes = append(scoredNodes, scored{ref: ref, score: score, total: total})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("intelligence.AtlasReaderAdapter rows: %w", err)
	}

	slices.SortStableFunc(scoredNodes, func(a, b scored) int {
		if a.score != b.score {
			return cmp.Compare(b.score, a.score) // desc by score
		}
		// Ties: smaller total_count first (quicker win).
		return cmp.Compare(a.total, b.total)
	})

	if len(scoredNodes) > limit {
		scoredNodes = scoredNodes[:limit]
	}
	out := make([]intelApp.AtlasResourceRef, 0, len(scoredNodes))
	for _, s := range scoredNodes {
		out = append(out, s.ref)
	}
	return out, nil
}

// ─── Helpers ────────────────────────────────────────────────────────────

// tokenizeAtlasGoal lowercases + splits on non-letter runes + drops
// stop-words / short tokens. Returns unique keywords.
func tokenizeAtlasGoal(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	lowered := strings.ToLower(s)
	// Replace common separators so Split returns clean words.
	for _, r := range []string{"_", "-", "/", ",", ".", ":", ";", "(", ")", "\"", "'"} {
		lowered = strings.ReplaceAll(lowered, r, " ")
	}
	raw := strings.Fields(lowered)
	stop := map[string]struct{}{
		"the": {}, "and": {}, "for": {}, "with": {}, "into": {}, "from": {},
		"of": {}, "in": {}, "on": {}, "at": {}, "by": {}, "is": {}, "to": {},
		// PrimaryGoalKind canonical strings — they carry meaning but as
		// whole phrases not single tokens (avoid splitting noise).
		"top": {}, "tier": {}, "co": {}, "any": {}, "senior": {}, "ml": {},
		"offer": {}, "english": {}, "target": {}, "custom": {},
	}
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, w := range raw {
		if len(w) < 3 {
			continue
		}
		if _, drop := stop[w]; drop {
			continue
		}
		if _, dup := seen[w]; dup {
			continue
		}
		seen[w] = struct{}{}
		out = append(out, w)
	}
	return out
}

// normaliseActivityKeys lowercases + de-dups activity kinds into a
// match-friendly set.
func normaliseActivityKeys(in []intelApp.ActivityKind) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, k := range in {
		s := strings.TrimSpace(strings.ToLower(string(k)))
		if s == "" {
			continue
		}
		// Strip dotted segments — "algo.sorting" → "algo" — so the section
		// match works against the seeded atlas catalogue's coarse keys.
		if idx := strings.IndexByte(s, '.'); idx > 0 {
			s = s[:idx]
		}
		if _, dup := seen[s]; dup {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

// scoreAtlasNode is the heuristic ranker. See header comment.
func scoreAtlasNode(title, description, section, cluster string, keywords, activityKeys []string) int {
	score := 0
	titleL := strings.ToLower(title)
	descL := strings.ToLower(description)
	for _, kw := range keywords {
		if strings.Contains(titleL, kw) {
			score += 3
		}
		if strings.Contains(descL, kw) {
			score += 2
		}
	}
	sectionL := strings.ToLower(section)
	clusterL := strings.ToLower(cluster)
	for _, a := range activityKeys {
		if a == "" {
			continue
		}
		if strings.Contains(sectionL, a) || strings.Contains(a, sectionL) && sectionL != "" {
			score += 2
		}
		if strings.Contains(clusterL, a) || strings.Contains(a, clusterL) && clusterL != "" {
			score += 1
		}
	}
	return score
}

// firstExternalResource returns the first {url, kind} pair from the
// external_resources jsonb array, or ("", "") when absent / malformed.
func firstExternalResource(raw string) (string, string) {
	if raw == "" || raw == "[]" || raw == "null" {
		return "", ""
	}
	var items []map[string]any
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return "", ""
	}
	for _, it := range items {
		if it == nil {
			continue
		}
		url, _ := it["url"].(string)
		if url == "" {
			continue
		}
		kind, _ := it["kind"].(string)
		return url, kind
	}
	return "", ""
}
