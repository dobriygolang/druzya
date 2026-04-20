package infra

import (
	"hash/fnv"
	"strings"
	"sync"

	"druz9/ai_native/domain"
	"druz9/shared/enums"
)

// StaticTrapStore is the MVP hallucination-trap catalog: a hardcoded list
// scanned linearly. The catalog is small (tens of entries), so an index is
// not worth the complexity.
//
// STUB: load from a CMS-backed table in a future migration so product can
// curate traps without a deploy.
type StaticTrapStore struct {
	mu    sync.RWMutex
	traps []domain.HallucinationTrap
}

// NewStaticTrapStore returns the default curated catalog.
func NewStaticTrapStore() *StaticTrapStore {
	return &StaticTrapStore{traps: defaultTraps()}
}

// NewStaticTrapStoreWith returns a store with the supplied traps — used by
// tests and by the WIRING for CMS backfills.
func NewStaticTrapStoreWith(traps []domain.HallucinationTrap) *StaticTrapStore {
	return &StaticTrapStore{traps: append([]domain.HallucinationTrap(nil), traps...)}
}

// All returns the full catalog (snapshot — safe to iterate).
func (s *StaticTrapStore) All() []domain.HallucinationTrap {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]domain.HallucinationTrap, len(s.traps))
	copy(out, s.traps)
	return out
}

// Pick picks the best-matching trap for a prompt + section. "Best match" is:
//
//  1. A trap whose Category matches `section` and whose PromptPattern is a
//     substring of the (lower-cased) prompt.
//  2. Ties broken deterministically by a hash of (prompt, trap.ID) so the
//     same prompt always fires the same trap — useful for replay.
//  3. If no section-specific trap matches, a trap from any section whose
//     pattern matches.
//
// Returns (HallucinationTrap{}, false) when nothing matches.
func (s *StaticTrapStore) Pick(prompt, section string) (domain.HallucinationTrap, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	lower := strings.ToLower(prompt)
	var sectionMatches, genericMatches []domain.HallucinationTrap
	for _, t := range s.traps {
		if t.PromptPattern == "" || !strings.Contains(lower, strings.ToLower(t.PromptPattern)) {
			continue
		}
		if string(t.Category) == section {
			sectionMatches = append(sectionMatches, t)
		} else {
			genericMatches = append(genericMatches, t)
		}
	}
	pick := func(set []domain.HallucinationTrap) domain.HallucinationTrap {
		h := fnv.New64a()
		_, _ = h.Write([]byte(prompt))
		idx := int(h.Sum64() % uint64(len(set)))
		return set[idx]
	}
	if len(sectionMatches) > 0 {
		return pick(sectionMatches), true
	}
	if len(genericMatches) > 0 {
		return pick(genericMatches), true
	}
	return domain.HallucinationTrap{}, false
}

// defaultTraps is the curated catalog — small, illustrative, safe.
//
// Each entry pairs a realistic-looking wrong answer with the correct one, so
// post-round UI can explain what went wrong. Patterns are intentionally
// broad so the simple substring match hits common prompts.
func defaultTraps() []domain.HallucinationTrap {
	return []domain.HallucinationTrap{
		{
			ID:            "sql-delete-no-where",
			Category:      enums.SectionSQL,
			PromptPattern: "delete",
			WrongAnswer:   "You can simply write `DELETE FROM users;` — Postgres will only remove the rows that match the implicit scope.",
			CorrectAnswer: "DELETE without a WHERE clause removes every row in the table. Always provide a WHERE predicate or use TRUNCATE knowingly.",
			Rationale:     "Classic LLM hallucination — confidently wrong claim about implicit row scope.",
		},
		{
			ID:            "sql-group-by-silent",
			Category:      enums.SectionSQL,
			PromptPattern: "group by",
			WrongAnswer:   "Postgres lets you select non-aggregated columns alongside `GROUP BY` — it silently picks the first value per group.",
			CorrectAnswer: "Postgres errors out unless the selected column is functionally dependent on the GROUP BY key or wrapped in an aggregate.",
			Rationale:     "Confuses MySQL's ONLY_FULL_GROUP_BY-off behaviour with Postgres semantics.",
		},
		{
			ID:            "go-range-copy",
			Category:      enums.SectionGo,
			PromptPattern: "range",
			WrongAnswer:   "`for i, v := range slice { v.Field = x }` mutates the original slice element in place.",
			CorrectAnswer: "`v` is a copy of the element; mutating it does NOT affect the slice. Use `slice[i].Field = x` instead.",
			Rationale:     "Common gotcha the LLM gets wrong when pushed for a one-liner.",
		},
		{
			ID:            "go-goroutine-close",
			Category:      enums.SectionGo,
			PromptPattern: "goroutine",
			WrongAnswer:   "Calling `close(ch)` in the receiver goroutine signals the sender to stop — it's the idiomatic way to cancel a producer.",
			CorrectAnswer: "Only the sender should close a channel; closing a channel you're still receiving from is a race and a common panic source.",
			Rationale:     "Role-reversal hallucination about channel close ownership.",
		},
		{
			ID:            "algo-binary-search-off-by-one",
			Category:      enums.SectionAlgorithms,
			PromptPattern: "binary search",
			WrongAnswer:   "The classic lower-bound loop is `while lo < hi: mid = (lo+hi)//2; if a[mid] < x: lo = mid; else hi = mid` — it converges because we always move one pointer.",
			CorrectAnswer: "Using `lo = mid` (instead of `lo = mid + 1`) when `a[mid] < x` creates an infinite loop when `hi - lo == 1`.",
			Rationale:     "Classic binary-search off-by-one the LLM regurgitates confidently.",
		},
		{
			ID:            "algo-hashmap-worst-case",
			Category:      enums.SectionAlgorithms,
			PromptPattern: "hash map",
			WrongAnswer:   "Hash map operations are always O(1) regardless of input — that's what the `amortised` in the docs means.",
			CorrectAnswer: "Worst-case is O(n) under adversarial keys or poor hashing. Amortised O(1) assumes a well-behaved hash distribution.",
			Rationale:     "Over-simplification passed off as the full story.",
		},
		{
			ID:            "sysdesign-cap",
			Category:      enums.SectionSystemDesign,
			PromptPattern: "cap theorem",
			WrongAnswer:   "CAP says you can pick any two of Consistency, Availability, Partition tolerance — modern clouds give you all three.",
			CorrectAnswer: "Partition tolerance is non-negotiable on a distributed system; CAP is the trade-off between C and A under partition, and real systems surface this as tunable consistency.",
			Rationale:     "Headline-level CAP misreading; common interview trap.",
		},
		{
			ID:            "behavioral-star",
			Category:      enums.SectionBehavioral,
			PromptPattern: "conflict",
			WrongAnswer:   "A strong answer is to avoid naming the conflicting party — just say 'some people disagreed' and move on to your solution.",
			CorrectAnswer: "The STAR format benefits from concrete stakes — name roles (not people) and the tradeoffs so the interviewer can gauge ownership.",
			Rationale:     "Vague-framing advice that hurts behavioural answers.",
		},
	}
}

// Interface guard.
var _ domain.TrapStore = (*StaticTrapStore)(nil)
