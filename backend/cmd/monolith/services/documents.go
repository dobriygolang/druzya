package services

import (
	"context"
	"fmt"
	"os"

	copilotDomain "druz9/copilot/domain"
	docsApp "druz9/documents/app"
	docsDomain "druz9/documents/domain"
	docsInfra "druz9/documents/infra"
	docsExtractor "druz9/documents/infra/extractor"
	docsPorts "druz9/documents/ports"
	"druz9/shared/pkg/llmcache"
	"druz9/shared/pkg/ratelimit"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// NewDocuments wires the documents bounded context. Returns an empty
// Module (no routes, no background workers) when OLLAMA_HOST is unset —
// that is the explicit opt-in signal for the embedder. Unlike the
// copilot LLM path there is no usable "fallback": without embeddings
// you can't index, and without indexing every route would 500. Skip
// registration cleanly instead of returning half-broken endpoints.
//
// This matches how llmchain.go already treats Ollama — single source of
// truth for "is self-host available".
//
// Second return value is the adapter exposing the documents Search
// use-case behind the copilot.DocumentSearcher interface. It's nil when
// the module is disabled; copilot treats nil as "RAG disabled" cleanly.
func NewDocuments(d Deps) (*Module, copilotDomain.DocumentSearcher) {
	ollamaHost := os.Getenv("OLLAMA_HOST")
	if ollamaHost == "" {
		if d.Log != nil {
			d.Log.Info("documents: disabled (OLLAMA_HOST not set)")
		}
		return &Module{}, nil
	}

	embedder := llmcache.NewOllamaEmbedder(ollamaHost, llmcache.DefaultOllamaEmbedModel, 0)
	repo := docsInfra.NewPgRepo(d.Pool)
	chunker := docsInfra.DefaultChunker()
	extractor := docsExtractor.NewTextExtractor()

	upload := &docsApp.Upload{
		Repo:      repo,
		Extractor: extractor,
		Chunker:   chunker,
		Embedder:  embedder,
		Log:       d.Log,
		Now:       d.Now,
	}
	get := &docsApp.Get{Repo: repo}
	list := &docsApp.List{Repo: repo}
	del := &docsApp.Delete{Repo: repo}
	search := &docsApp.Search{Repo: repo, Embedder: embedder, TopK: 5}
	uploadFromURL := &docsApp.UploadFromURL{
		Fetcher: urlFetcherAdapter{inner: docsInfra.NewURLFetcher()},
		Upload:  upload,
	}

	// Rate limiter: only active when Redis is configured. Without it
	// the handlers fall through to unlimited (matches dev-mode copilot
	// behaviour where Redis-less builds skip the `StartSession` limit).
	var limiter *ratelimit.RedisFixedWindow
	if d.Redis != nil {
		limiter = ratelimit.NewRedisFixedWindow(d.Redis)
	}

	h := &docsPorts.Handler{
		Upload:        upload,
		UploadFromURL: uploadFromURL,
		Get:           get,
		List:          list,
		Delete:        del,
		Search:        search,
		Limiter:       limiter,
		KillSwitch:    d.KillSwitch,
		Log:           d.Log,
	}

	searcher := &documentsSearcherAdapter{search: search, repo: repo}

	return &Module{
		MountREST: func(r chi.Router) {
			h.Mount(r)
		},
	}, searcher
}

// urlFetcherAdapter bridges infra.URLFetcher (returns FetchResult) to
// the app.URLFetcher interface (expects URLFetchResult). Both structs
// have the same shape — keeping them separate avoids the app layer
// importing infra types, which would break the dependency direction.
type urlFetcherAdapter struct {
	inner *docsInfra.URLFetcher
}

func (a urlFetcherAdapter) Fetch(ctx context.Context, url string) (docsApp.URLFetchResult, error) {
	res, err := a.inner.Fetch(ctx, url)
	if err != nil {
		return docsApp.URLFetchResult{}, fmt.Errorf("monolith.urlFetcherAdapter.Fetch: %w", err)
	}
	return docsApp.URLFetchResult{
		Filename:  res.Filename,
		Content:   res.Content,
		SourceURL: res.SourceURL,
	}, nil
}

// documentsSearcherAdapter bridges documents/app Search to copilot's
// DocumentSearcher port. Lives here (not in documents/) so the documents
// module stays agnostic of copilot's prompt-shape needs.
type documentsSearcherAdapter struct {
	search *docsApp.Search
	repo   docsDomain.Repository
}

func (a *documentsSearcherAdapter) SearchForSession(
	ctx context.Context,
	userID uuid.UUID,
	docIDs []uuid.UUID,
	query string,
	topK int,
) ([]copilotDomain.DocContextHit, error) {
	hits, err := a.search.Do(ctx, docsApp.SearchInput{
		UserID: userID,
		DocIDs: docIDs,
		Query:  query,
		TopK:   topK,
	}, docsInfra.CosineTopK)
	if err != nil {
		return nil, fmt.Errorf("monolith.documentsSearcherAdapter.SearchForSession: %w", err)
	}

	// Enrich SourceLabel with the filename. Fetching per-hit would be
	// O(hits) round-trips; instead we do one pass over the unique
	// doc ids we actually got hits for.
	labels := make(map[uuid.UUID]string, 4)
	for _, h := range hits {
		if _, ok := labels[h.Chunk.DocID]; ok {
			continue
		}
		if doc, err := a.repo.GetDocument(ctx, userID, h.Chunk.DocID); err == nil {
			labels[h.Chunk.DocID] = doc.Filename
		} else {
			// Stale id or deletion-race. Fall back to a short tag so the
			// LLM still sees something attribution-worthy.
			labels[h.Chunk.DocID] = "document"
		}
	}

	out := make([]copilotDomain.DocContextHit, len(hits))
	for i, h := range hits {
		label := labels[h.Chunk.DocID]
		if label == "" {
			label = "document"
		}
		out[i] = copilotDomain.DocContextHit{
			SourceLabel: label,
			Content:     h.Chunk.Content,
		}
	}
	return out, nil
}
