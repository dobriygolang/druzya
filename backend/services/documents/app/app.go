// Package app holds the documents bounded-context use-cases. One file
// per use-case would fragment at this size; all live here until the
// service outgrows it.
package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"druz9/documents/domain"

	"github.com/google/uuid"
)

// Upload ingests raw bytes end-to-end: dedup → extract → chunk → embed →
// persist. Returns the Document row with status=ready.
//
// Embedding is the slow step. To keep p95 under ~3s for a 50-chunk doc
// we fan-out across EmbedWorkers goroutines. Ordering is preserved by
// writing back into a pre-sized slice at each chunk's index, not by
// using a channel.
type Upload struct {
	Repo      domain.Repository
	Extractor domain.Extractor
	Chunker   domain.Chunker
	Embedder  domain.Embedder
	Log       *slog.Logger
	Now       func() time.Time

	// EmbedWorkers: upper bound on concurrent Embed calls. Zero uses a
	// sensible default (4). Ollama is CPU-bound single-threaded per
	// request; 4 workers on an 8-core sidecar is a healthy trade-off.
	EmbedWorkers int
}

// UploadInput carries everything a handler needs to pass through.
// SourceURL is informational — empty for direct uploads, set when
// fetching from a URL (future).
type UploadInput struct {
	UserID    uuid.UUID
	Filename  string
	MIME      string
	Content   []byte
	SourceURL string
}

// Do runs the full pipeline. On failure after the document row exists,
// we flip its status to 'failed' with the error text so the client can
// see why via GetDocument — we never leave a 'pending' zombie row.
func (u *Upload) Do(ctx context.Context, in UploadInput) (domain.Document, error) {
	if int64(len(in.Content)) > domain.MaxUploadBytes {
		return domain.Document{}, domain.ErrTooLarge
	}
	if len(in.Content) == 0 {
		return domain.Document{}, domain.ErrEmptyContent
	}

	sum := sha256.Sum256(in.Content)
	sha := hex.EncodeToString(sum[:])

	// InsertDocument is idempotent on (user_id, sha256). If the user
	// re-uploads identical bytes we simply return the existing ready
	// row; no re-indexing — that's the whole point of sha-based dedup.
	doc, err := u.Repo.InsertDocument(ctx, domain.Document{
		UserID:    in.UserID,
		Filename:  in.Filename,
		MIME:      in.MIME,
		SizeBytes: int64(len(in.Content)),
		SHA256:    sha,
		SourceURL: in.SourceURL,
		Status:    domain.StatusPending,
	})
	if err != nil {
		return domain.Document{}, fmt.Errorf("insert document: %w", err)
	}

	// Already indexed — nothing to do. Status will be 'ready' from the
	// prior ingest. If it's 'failed' the user should DELETE and retry
	// with a newer file; we don't auto-retry here because the last
	// run's error text is the only breadcrumb and we'd overwrite it.
	if doc.Status == domain.StatusReady || doc.Status == domain.StatusFailed {
		return doc, nil
	}

	if updErr := u.Repo.UpdateDocumentStatus(ctx, doc.ID, domain.StatusExtracting, "", 0, 0); updErr != nil {
		return domain.Document{}, fmt.Errorf("update status extracting: %w", updErr)
	}

	text, err := u.Extractor.Extract(ctx, in.MIME, in.Content)
	if err != nil {
		_ = u.Repo.UpdateDocumentStatus(ctx, doc.ID, domain.StatusFailed, err.Error(), 0, 0)
		return domain.Document{}, fmt.Errorf("extract: %w", err)
	}

	pieces := u.Chunker.Chunk(text)
	if len(pieces) == 0 {
		_ = u.Repo.UpdateDocumentStatus(ctx, doc.ID, domain.StatusFailed, domain.ErrEmptyContent.Error(), 0, 0)
		return domain.Document{}, domain.ErrEmptyContent
	}

	if updErr := u.Repo.UpdateDocumentStatus(ctx, doc.ID, domain.StatusEmbedding, "", 0, 0); updErr != nil {
		return domain.Document{}, fmt.Errorf("update status embedding: %w", updErr)
	}

	chunks, totalTokens, err := u.embedAll(ctx, doc.ID, pieces)
	if err != nil {
		_ = u.Repo.UpdateDocumentStatus(ctx, doc.ID, domain.StatusFailed, err.Error(), 0, 0)
		return domain.Document{}, fmt.Errorf("embed: %w", err)
	}

	if insErr := u.Repo.InsertChunks(ctx, doc.ID, chunks); insErr != nil {
		_ = u.Repo.UpdateDocumentStatus(ctx, doc.ID, domain.StatusFailed, insErr.Error(), 0, 0)
		return domain.Document{}, fmt.Errorf("insert chunks: %w", insErr)
	}

	if updErr := u.Repo.UpdateDocumentStatus(ctx, doc.ID, domain.StatusReady, "", len(chunks), totalTokens); updErr != nil {
		return domain.Document{}, fmt.Errorf("update status ready: %w", updErr)
	}

	// Re-fetch to return the canonical row with the terminal status +
	// counters populated. One extra roundtrip, but keeps the response
	// shape truthful — returning `doc` from the insert call would show
	// the stale 'pending' status and zero counters.
	final, err := u.Repo.GetDocument(ctx, in.UserID, doc.ID)
	if err != nil {
		return domain.Document{}, fmt.Errorf("rehydrate: %w", err)
	}
	return final, nil
}

// embedAll runs Embed concurrently while preserving input order. Token
// counts are accumulated for the denormalized documents.token_count.
func (u *Upload) embedAll(ctx context.Context, docID uuid.UUID, pieces []string) ([]domain.Chunk, int, error) {
	workers := u.EmbedWorkers
	if workers <= 0 {
		workers = 4
	}
	if workers > len(pieces) {
		workers = len(pieces)
	}

	type job struct {
		idx int
		txt string
	}
	type result struct {
		idx   int
		chunk domain.Chunk
		err   error
	}

	jobs := make(chan job)
	results := make(chan result, len(pieces))
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				vec, err := u.Embedder.Embed(ctx, j.txt)
				if err != nil {
					results <- result{idx: j.idx, err: err}
					continue
				}
				results <- result{idx: j.idx, chunk: domain.Chunk{
					DocID:      docID,
					Ord:        j.idx,
					Content:    j.txt,
					Embedding:  vec,
					TokenCount: approxWords(j.txt),
				}}
			}
		}()
	}

	go func() {
		for i, p := range pieces {
			select {
			case jobs <- job{idx: i, txt: p}:
			case <-ctx.Done():
				break
			}
		}
		close(jobs)
	}()

	wg.Wait()
	close(results)

	chunks := make([]domain.Chunk, len(pieces))
	filled := make([]bool, len(pieces))
	total := 0
	var firstErr error
	for r := range results {
		if r.err != nil {
			if firstErr == nil {
				firstErr = r.err
			}
			continue
		}
		chunks[r.idx] = r.chunk
		filled[r.idx] = true
		total += r.chunk.TokenCount
	}
	if firstErr != nil {
		return nil, 0, fmt.Errorf("embed: %w", firstErr)
	}
	// Sanity: every slot populated. A skipped slot would be silently
	// dropped below and surface as "search misses something"; verify
	// instead.
	for i, ok := range filled {
		if !ok {
			return nil, 0, fmt.Errorf("embed: chunk %d missing", i)
		}
	}

	// Keep chunks sorted by Ord (redundant given we wrote by index, but
	// defends against any future change to the filling strategy).
	sort.Slice(chunks, func(i, j int) bool { return chunks[i].Ord < chunks[j].Ord })
	return chunks, total, nil
}

func approxWords(s string) int {
	n := 0
	inWord := false
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			inWord = false
			continue
		}
		if !inWord {
			n++
			inWord = true
		}
	}
	return n
}

// ─────────────────────────────────────────────────────────────────────────
// UploadFromURL
// ─────────────────────────────────────────────────────────────────────────

// URLFetcher abstracts the URL→plaintext step so tests can stub it. The
// shape mirrors infra.URLFetcher.Fetch exactly — the adapter in wiring
// is a pass-through.
type URLFetcher interface {
	Fetch(ctx context.Context, url string) (URLFetchResult, error)
}

type URLFetchResult struct {
	Filename  string
	Content   []byte
	SourceURL string
}

// UploadFromURL fetches a URL, runs it through readability to extract
// the main content, then hands the plaintext to the normal Upload
// pipeline. The user-visible Document ends up with mime=text/plain and
// source_url pointing at the canonical (post-redirect) URL.
//
// Errors bubble from the fetcher (ErrUnsupportedMIME for non-HTML
// responses, ErrTooLarge for oversize pages) and the embedder (transient
// Ollama failures) — handler layer maps to HTTP codes.
type UploadFromURL struct {
	Fetcher URLFetcher
	Upload  *Upload
}

type UploadFromURLInput struct {
	UserID uuid.UUID
	URL    string
}

func (u *UploadFromURL) Do(ctx context.Context, in UploadFromURLInput) (domain.Document, error) {
	if strings.TrimSpace(in.URL) == "" {
		return domain.Document{}, fmt.Errorf("url is required")
	}
	res, err := u.Fetcher.Fetch(ctx, in.URL)
	if err != nil {
		return domain.Document{}, fmt.Errorf("fetch url: %w", err)
	}
	doc, err := u.Upload.Do(ctx, UploadInput{
		UserID:    in.UserID,
		Filename:  res.Filename,
		MIME:      "text/plain",
		Content:   res.Content,
		SourceURL: res.SourceURL,
	})
	if err != nil {
		return domain.Document{}, fmt.Errorf("upload: %w", err)
	}
	return doc, nil
}

// ─────────────────────────────────────────────────────────────────────────
// Read use-cases
// ─────────────────────────────────────────────────────────────────────────

type Get struct {
	Repo domain.Repository
}

func (g *Get) Do(ctx context.Context, userID, id uuid.UUID) (domain.Document, error) {
	doc, err := g.Repo.GetDocument(ctx, userID, id)
	if err != nil {
		return domain.Document{}, fmt.Errorf("documents.Get.Do: %w", err)
	}
	return doc, nil
}

type List struct {
	Repo domain.Repository
}

type ListInput struct {
	UserID uuid.UUID
	Cursor string
	Limit  int
}

type ListOutput struct {
	Documents  []domain.Document
	NextCursor string
}

func (l *List) Do(ctx context.Context, in ListInput) (ListOutput, error) {
	docs, next, err := l.Repo.ListDocuments(ctx, in.UserID, in.Cursor, in.Limit)
	if err != nil {
		return ListOutput{}, fmt.Errorf("documents.List.Do: %w", err)
	}
	return ListOutput{Documents: docs, NextCursor: next}, nil
}

type Delete struct {
	Repo domain.Repository
}

func (d *Delete) Do(ctx context.Context, userID, id uuid.UUID) error {
	if err := d.Repo.DeleteDocument(ctx, userID, id); err != nil {
		return fmt.Errorf("documents.Delete.Do: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────

// Search ranks chunks across a set of documents by cosine similarity to
// the query. This is the RAG-primitive that copilot will call on each
// turn once the integration is wired (next session). For now it's also
// directly exposed so humans/tests can poke at it.
type Search struct {
	Repo     domain.Repository
	Embedder domain.Embedder
	// TopK is the default cap on returned hits. Callers can override per
	// request; cap stops a runaway prompt from flooding the LLM context.
	TopK int
}

type SearchInput struct {
	UserID   uuid.UUID
	DocIDs   []uuid.UUID
	Query    string
	TopK     int
	MinScore float32
}

func (s *Search) Do(ctx context.Context, in SearchInput, rank func([]float32, []domain.Chunk, int) []domain.SearchHit) ([]domain.SearchHit, error) {
	if in.Query == "" {
		return nil, fmt.Errorf("search: empty query")
	}
	if len(in.DocIDs) == 0 {
		return []domain.SearchHit{}, nil
	}

	// Defense in depth: load + filter chunks to docs the user owns.
	// Without this a handler bug could let user A query user B's docs
	// if they know a doc id. We don't trust the DocIDs list past parse.
	owned, err := s.filterOwnedDocIDs(ctx, in.UserID, in.DocIDs)
	if err != nil {
		return nil, err
	}
	if len(owned) == 0 {
		return []domain.SearchHit{}, nil
	}

	qvec, err := s.Embedder.Embed(ctx, in.Query)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}

	chunks, err := s.Repo.ListChunks(ctx, owned)
	if err != nil {
		return nil, fmt.Errorf("list chunks: %w", err)
	}

	k := in.TopK
	if k <= 0 {
		k = s.TopK
	}
	if k <= 0 {
		k = 5
	}

	hits := rank(qvec, chunks, k)
	if in.MinScore > 0 {
		out := hits[:0]
		for _, h := range hits {
			if h.Score >= in.MinScore {
				out = append(out, h)
			}
		}
		hits = out
	}
	return hits, nil
}

func (s *Search) filterOwnedDocIDs(ctx context.Context, userID uuid.UUID, ids []uuid.UUID) ([]uuid.UUID, error) {
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if _, err := s.Repo.GetDocument(ctx, userID, id); err != nil {
			// Silently skip foreign-or-missing ids — the search is a
			// best-effort "find what's relevant in these docs you say
			// you have"; returning an error on one bad id would be
			// brittle for a client that just passed `session.documents`
			// and hit a race with a concurrent delete.
			continue
		}
		out = append(out, id)
	}
	return out, nil
}
