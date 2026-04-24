// Package domain declares the core types and interfaces for the documents
// bounded context. No infra or transport concerns leak here — repositories,
// extractors and embedders are abstracted as interfaces so app use-cases
// can be unit-tested with fakes.
package domain

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Status encodes the async pipeline stage of a Document. Clients poll
// GET /documents/{id} until status=ready before attaching to a session.
type Status string

const (
	StatusPending    Status = "pending"
	StatusExtracting Status = "extracting"
	StatusEmbedding  Status = "embedding"
	StatusReady      Status = "ready"
	StatusFailed     Status = "failed"
	StatusDeleting   Status = "deleting"
)

// Document is a user-owned uploaded file. The raw bytes are NOT persisted
// anywhere after extraction — only the derived text (split into Chunks
// with embeddings) is. This is a deliberate privacy property: a breach
// of documents/doc_chunks cannot recover the original PDF/DOCX.
type Document struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	Filename     string
	MIME         string
	SizeBytes    int64
	SHA256       string
	SourceURL    string
	Status       Status
	ErrorMessage string
	ChunkCount   int
	TokenCount   int
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// Chunk is a semantically-coherent slice of a Document plus its embedding.
// Ordering by Ord reconstructs the document's text contiguously.
//
// Embedding is L2-normalized float32[384] (bge-small-en-v1.5 output).
// Normalization is done by the embedder — downstream cosine similarity
// reduces to a plain dot product.
type Chunk struct {
	ID         uuid.UUID
	DocID      uuid.UUID
	Ord        int
	Content    string
	Embedding  []float32
	TokenCount int
	CreatedAt  time.Time
}

// SearchHit pairs a Chunk with its similarity score for ranking output.
// Score is cosine similarity in [-1, 1]; values ≥ ~0.4 are typically
// on-topic for user-facing RAG (threshold tuning lives in the caller).
type SearchHit struct {
	Chunk Chunk
	Score float32
}

// ─────────────────────────────────────────────────────────────────────────
// Ports (interfaces implemented by infra)
// ─────────────────────────────────────────────────────────────────────────

// Repository is the persistence boundary. All methods are user-scoped
// where applicable; callers pass UserID as a guard rail so a handler
// bug can't leak another user's rows.
type Repository interface {
	// InsertDocument is idempotent on (user_id, sha256): re-uploading the
	// same bytes twice returns the original row instead of a duplicate.
	InsertDocument(ctx context.Context, d Document) (Document, error)

	// GetDocument returns ErrNotFound when the id is unknown OR belongs
	// to a different user — we never distinguish the two to avoid leaking
	// existence of other users' documents.
	GetDocument(ctx context.Context, userID, id uuid.UUID) (Document, error)

	// ListDocuments returns a page plus an optional next cursor. cursor="" +
	// page 1; pass back the returned next cursor for the subsequent page.
	ListDocuments(ctx context.Context, userID uuid.UUID, cursor string, limit int) ([]Document, string, error)

	// UpdateDocumentStatus persists the terminal state of the ingest
	// pipeline. Also writes denormalized counters (chunk_count, token_count)
	// so listing doesn't need a JOIN.
	UpdateDocumentStatus(ctx context.Context, id uuid.UUID, status Status, errMsg string, chunkCount, tokenCount int) error

	// DeleteDocument cascades through doc_chunks via FK. Returns
	// ErrNotFound when the id doesn't exist for this user.
	DeleteDocument(ctx context.Context, userID, id uuid.UUID) error

	// InsertChunks writes a batch atomically via CopyFrom. Caller guarantees
	// chunk.DocID == docID for every element and that the ord sequence is
	// 0..N-1. Repo does not re-order.
	InsertChunks(ctx context.Context, docID uuid.UUID, chunks []Chunk) error

	// ListChunks pulls every chunk of every doc in docIDs. The caller is
	// expected to keep docIDs small (a session's attached documents —
	// typically ≤10). Cosine search runs in Go on the returned set.
	ListChunks(ctx context.Context, docIDs []uuid.UUID) ([]Chunk, error)
}

// Extractor converts an uploaded file into plain text suitable for
// chunking + embedding. Implementations dispatch on MIME type; unknown
// types must return ErrUnsupportedMIME rather than a best-effort text dump.
type Extractor interface {
	Extract(ctx context.Context, mime string, content []byte) (string, error)
}

// Chunker splits extracted text into semantically-coherent pieces with a
// rolling token budget. The returned slice is ordered; caller assigns
// chunk.Ord = i to each.
type Chunker interface {
	Chunk(text string) []string
}

// Embedder produces a dense vector for a piece of text. L2-normalized.
// Dim() exposes the fixed output size for schema/sanity checks.
// (The production implementation is llmcache.OllamaEmbedder which already
// satisfies this shape — no adapter needed.)
type Embedder interface {
	Embed(ctx context.Context, text string) ([]float32, error)
	Dim() int
}

// ─────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────

var (
	// ErrNotFound — row missing OR belonging to another user. Handlers
	// map to 404 uniformly.
	ErrNotFound = errors.New("documents: not found")

	// ErrUnsupportedMIME — extractor doesn't handle this type yet.
	// Maps to 415 Unsupported Media Type.
	ErrUnsupportedMIME = errors.New("documents: unsupported mime type")

	// ErrTooLarge — content exceeds the per-document byte cap. The DB
	// also enforces this via CHECK but we reject earlier at the API
	// boundary for a clean error message.
	ErrTooLarge = errors.New("documents: content too large")

	// ErrEmptyContent — after extraction, no text remained. Usually
	// scanned PDFs without OCR or empty files. Surfaces as 422.
	ErrEmptyContent = errors.New("documents: extracted text is empty")
)

// MaxUploadBytes is the hard upper bound on raw content size. Kept in
// sync with the CHECK constraint in migration 00011 (documents.size_bytes).
const MaxUploadBytes int64 = 10 * 1024 * 1024
