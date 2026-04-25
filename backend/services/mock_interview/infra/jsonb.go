// Package infra — pgx-backed adapters for mock_interview repos.
//
// We hand-roll pgx (no sqlc) for v1 — see WIRING.md "Out of scope" for
// rationale. JSONB-typed columns flow through the helpers in this file.
package infra

import (
	"encoding/json"
	"fmt"

	"druz9/mock_interview/domain"
)

// marshalReferenceCriteria — write-side JSONB helper. nil-safe (empty
// arrays preserved so the row never holds `null` where UI expects `[]`).
func marshalReferenceCriteria(rc domain.ReferenceCriteria) ([]byte, error) {
	if rc.MustMention == nil {
		rc.MustMention = []string{}
	}
	if rc.NiceToHave == nil {
		rc.NiceToHave = []string{}
	}
	if rc.CommonPitfalls == nil {
		rc.CommonPitfalls = []string{}
	}
	b, err := json.Marshal(rc)
	if err != nil {
		return nil, fmt.Errorf("marshal reference_criteria: %w", err)
	}
	return b, nil
}

// scanReferenceCriteria — read-side JSONB helper. Permissive on extra keys
// (forward-compat) but strict on shape: unknown values get dropped, the
// three known arrays get populated.
func scanReferenceCriteria(raw []byte) (domain.ReferenceCriteria, error) {
	var rc domain.ReferenceCriteria
	if len(raw) == 0 {
		return domain.ReferenceCriteria{
			MustMention: []string{}, NiceToHave: []string{}, CommonPitfalls: []string{},
		}, nil
	}
	if err := json.Unmarshal(raw, &rc); err != nil {
		return domain.ReferenceCriteria{}, fmt.Errorf("unmarshal reference_criteria: %w", err)
	}
	if rc.MustMention == nil {
		rc.MustMention = []string{}
	}
	if rc.NiceToHave == nil {
		rc.NiceToHave = []string{}
	}
	if rc.CommonPitfalls == nil {
		rc.CommonPitfalls = []string{}
	}
	return rc, nil
}

// marshalStringList serialises a []string as JSONB. Used for
// `pipeline_attempts.ai_missing_points`.
func marshalStringList(xs []string) ([]byte, error) {
	if xs == nil {
		xs = []string{}
	}
	b, err := json.Marshal(xs)
	if err != nil {
		return nil, fmt.Errorf("marshal string list: %w", err)
	}
	return b, nil
}

func scanStringList(raw []byte) ([]string, error) {
	if len(raw) == 0 {
		return []string{}, nil
	}
	var xs []string
	if err := json.Unmarshal(raw, &xs); err != nil {
		return nil, fmt.Errorf("unmarshal string list: %w", err)
	}
	if xs == nil {
		xs = []string{}
	}
	return xs, nil
}
