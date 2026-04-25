package domain

import "errors"

// ErrNotFound — canonical not-found sentinel. Maps to connect.CodeNotFound.
var ErrNotFound = errors.New("intelligence: not found")

// ErrLLMUnavailable — chain is nil or every provider failed. Maps to
// connect.CodeUnavailable. Anti-fallback: we NEVER fabricate a brief or
// QA answer. A 503 is honest.
var ErrLLMUnavailable = errors.New("intelligence: llm unavailable")

// ErrEmbeddingUnavailable — bge-small endpoint down. AskNotes surfaces
// this as 503 rather than fabricating a non-RAG answer.
var ErrEmbeddingUnavailable = errors.New("intelligence: embedding unavailable")

// ErrInvalidInput — пустой вопрос, etc. Maps to connect.CodeInvalidArgument.
var ErrInvalidInput = errors.New("intelligence: invalid input")

// ErrRateLimited — force=true vs the 1/h regen cap on GetDailyBrief.
// Maps to connect.CodeResourceExhausted.
var ErrRateLimited = errors.New("intelligence: rate limited")
