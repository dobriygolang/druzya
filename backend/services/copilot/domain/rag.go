package domain

import (
	"context"

	"github.com/google/uuid"
)

// DocumentSearcher abstracts the cross-domain RAG lookup. Copilot's
// Analyze/Chat call it when a live session has documents attached;
// the concrete implementation is an adapter over the documents/app
// Search use-case (wired in cmd/monolith/services/documents.go →
// copilot.go).
//
// Kept as an interface here so copilot/app doesn't import documents/*:
//   - preserves the one-way domain dependency rule
//     (copilot doesn't know about documents; the monolith wires them);
//   - makes fakes trivial for unit tests of Analyze.
type DocumentSearcher interface {
	// SearchForSession returns the top-ranked chunks across the given
	// documents for the user's query. Implementations MUST enforce that
	// docIDs belong to userID — copilot trusts the list we pass here
	// (which came from Session.DocumentIDs, already user-scoped), but
	// defence-in-depth at the implementation layer is still expected.
	//
	// An empty/missing result (no hits above threshold, or no docs in
	// scope) is NOT an error — return an empty slice. Only real I/O or
	// transport failures surface as errors.
	SearchForSession(ctx context.Context, userID uuid.UUID, docIDs []uuid.UUID, query string, topK int) ([]DocContextHit, error)
}

// DocContextHit is the minimal shape needed to render a RAG context
// block in a system prompt. We deliberately don't carry scores, ids, or
// document metadata into copilot's domain — those belong to the
// documents service and would leak structure.
type DocContextHit struct {
	// SourceLabel — user-facing tag that prefixes the chunk in the
	// prompt (e.g. "CV.pdf (chunk 3)"). Helps the LLM attribute
	// information to the right document when synthesizing answers.
	SourceLabel string
	// Content — the chunk text. The adapter is expected to clip
	// pathological lengths before returning (per-chunk budget enforced
	// by the chunker already, so under normal operation this is a no-op).
	Content string
}
