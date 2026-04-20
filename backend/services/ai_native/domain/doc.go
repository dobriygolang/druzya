// Package domain contains the entities, value objects and repository
// interfaces for the ai_native bounded context (AI-Native Round, bible §19.1).
// No external framework imports here.
//
// Security invariant — read before editing:
//
//	solution_hint lives ONLY in TaskWithHint (consumed by BuildAssistantPrompt).
//	Every client-facing shape (TaskPublic, ProvenanceRecord DTO, Scores, …)
//	MUST NOT carry that field. Breaking this invariant is an information-leak
//	bug.
//
// The domain is strict about isolation: we do NOT import druz9/ai_mock.
// The LLMProvider interface is re-declared here even though its shape matches
// ai_mock's — each bounded context owns its own abstractions.
package domain
