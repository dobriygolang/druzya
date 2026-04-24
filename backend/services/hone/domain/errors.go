package domain

import "errors"

// ErrNotFound is the canonical not-found sentinel across all four
// sub-contexts (plan/focus/notes/whiteboards). Transports map to
// connect.CodeNotFound (HTTP 404).
var ErrNotFound = errors.New("hone: not found")

// ErrNotOwner — the caller authenticated successfully but the resource
// belongs to another user. Maps to connect.CodePermissionDenied (HTTP 403)
// rather than 404, because 404 would leak whether the resource exists at
// all via timing/presence. All per-user domains in Hone are private.
var ErrNotOwner = errors.New("hone: not owner")

// ErrStaleVersion — optimistic-concurrency failure on whiteboard update.
// Client must refetch, merge, retry. Maps to connect.CodeAborted which the
// client SDK surfaces distinctly from network errors.
var ErrStaleVersion = errors.New("hone: stale version")

// ErrLLMUnavailable — the llmchain.ChatClient is nil (no provider keys
// configured) or every provider in the chain failed. Surfaces to the
// client as connect.CodeUnavailable. Anti-fallback: we NEVER return a
// stub/fake plan or critique when the chain is down — a 503 is honest,
// a fake plan is a lie.
var ErrLLMUnavailable = errors.New("hone: llm unavailable")

// ErrEmbeddingUnavailable — bge-small endpoint down. GetNoteConnections
// surfaces this to the client; the UI shows the "connections not indexed
// yet" state rather than fabricating bogus edges.
var ErrEmbeddingUnavailable = errors.New("hone: embedding unavailable")

// ErrInvalidInput — запрос синтаксически валиден, но нарушает доменный
// инвариант (пустой обязательный body, отрицательные величины и т.п.).
// Маппится в connect.CodeInvalidArgument (HTTP 400). В отличие от
// standard-library errors возврат этого sentinel'а НЕ значит, что request
// пришёл поломанным — валидация wire-формата делается в proto-слое.
var ErrInvalidInput = errors.New("hone: invalid input")

// ErrProRequired — пользователь аутентифицирован, но его subscription tier
// ниже требуемого. Возвращается для premium endpoint'ов (GeneratePlan,
// CritiqueWhiteboard, GetNoteConnections). Маппится в connect.CodePermissionDenied
// (HTTP 403) с сообщением «upgrade to Pro» — клиент знает что показать
// paywall, а не auth-error.
var ErrProRequired = errors.New("hone: pro subscription required")
