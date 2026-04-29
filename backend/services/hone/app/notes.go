package app

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── CreateNote ────────────────────────────────────────────────────────────

// CreateNote inserts a new markdown note. The embedding is computed
// asynchronously (see EmbedQueue) so the create endpoint stays snappy —
// the client sees the new note immediately, connections populate a few
// hundred ms later when the user hits ⌘J.
type CreateNote struct {
	Notes   domain.NoteRepo
	EmbedFn func(ctx context.Context, userID, noteID uuid.UUID, text string) // async
	Log     *slog.Logger
	Now     func() time.Time
	// Memory — optional Phase B-2 hook в Coach memory. nil = no-op.
	Memory domain.MemoryHook
}

// CreateNoteInput — wire body.
type CreateNoteInput struct {
	UserID   uuid.UUID
	Title    string
	BodyMD   string
	FolderID *uuid.UUID
}

// Do executes the use case.
func (uc *CreateNote) Do(ctx context.Context, in CreateNoteInput) (domain.Note, error) {
	now := uc.Now().UTC()
	n := domain.Note{
		UserID:    in.UserID,
		Title:     in.Title,
		BodyMD:    in.BodyMD,
		SizeBytes: len(in.BodyMD),
		FolderID:  in.FolderID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := uc.Notes.Create(ctx, n)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.CreateNote.Do: %w", err)
	}
	if uc.EmbedFn != nil && !created.Encrypted {
		// Fire-and-forget; caller owns the queue/goroutine. The embed job
		// is idempotent — re-running for the same note replaces the vector.
		// Encrypted (Phase C-7) → skip: server can't see plaintext to embed.
		go uc.EmbedFn(context.Background(), in.UserID, created.ID, created.Title+"\n\n"+created.BodyMD)
	}
	if uc.Memory != nil {
		if isDailyNoteTitle(created.Title) {
			uc.Memory.OnDailyNoteSaved(ctx, in.UserID, created.ID, created.Title, compactNoteMemoryBody(created.BodyMD, 600), now)
		} else {
			uc.Memory.OnNoteCreated(ctx, in.UserID, created.ID, created.Title, compactNoteMemoryBody(created.BodyMD, 200), now)
		}
	}
	return created, nil
}

// ─── UpdateNote ────────────────────────────────────────────────────────────

// UpdateNote overwrites title + body. Embedding is re-queued. No optimistic
// concurrency on notes (last-write-wins) — notes are typed-into-by-one-user
// on one machine at a time by construction. Whiteboards DO have OCC because
// they're richer and more prone to "oops two tabs".
type UpdateNote struct {
	Notes   domain.NoteRepo
	EmbedFn func(ctx context.Context, userID, noteID uuid.UUID, text string)
	Log     *slog.Logger
	Now     func() time.Time
	// Memory — optional Phase B-2 hook в Coach memory. Only Today daily
	// notes emit update snapshots; regular note edits stay in notes/search.
	Memory domain.MemoryHook
}

// UpdateNoteInput — wire body.
type UpdateNoteInput struct {
	UserID uuid.UUID
	NoteID uuid.UUID
	Title  string
	BodyMD string
}

// Do executes the use case.
func (uc *UpdateNote) Do(ctx context.Context, in UpdateNoteInput) (domain.Note, error) {
	now := uc.Now().UTC()
	n := domain.Note{
		ID:        in.NoteID,
		UserID:    in.UserID,
		Title:     in.Title,
		BodyMD:    in.BodyMD,
		SizeBytes: len(in.BodyMD),
		UpdatedAt: now,
	}
	updated, err := uc.Notes.Update(ctx, n)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.UpdateNote.Do: %w", err)
	}
	if uc.EmbedFn != nil && !updated.Encrypted {
		// Encrypted (Phase C-7) → skip embed (см. CreateNote rationale).
		go uc.EmbedFn(context.Background(), in.UserID, updated.ID, updated.Title+"\n\n"+updated.BodyMD)
	}
	if uc.Memory != nil && !updated.Encrypted && isDailyNoteTitle(updated.Title) {
		uc.Memory.OnDailyNoteSaved(ctx, in.UserID, updated.ID, updated.Title, compactNoteMemoryBody(updated.BodyMD, 600), now)
	}
	return updated, nil
}

func isDailyNoteTitle(title string) bool {
	return strings.HasPrefix(strings.TrimSpace(title), "Daily ")
}

func compactNoteMemoryBody(body string, limit int) string {
	body = strings.Join(strings.Fields(strings.TrimSpace(body)), " ")
	if body == "" || limit <= 0 {
		return ""
	}
	runes := []rune(body)
	if len(runes) <= limit {
		return body
	}
	return string(runes[:limit]) + "..."
}

// ─── GetNote / ListNotes / DeleteNote — trivial passthroughs ───────────────

// GetNote fetches one note by id + owner.
type GetNote struct {
	Notes domain.NoteRepo
}

// Do executes the use case.
func (uc *GetNote) Do(ctx context.Context, userID, noteID uuid.UUID) (domain.Note, error) {
	n, err := uc.Notes.Get(ctx, userID, noteID)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.GetNote.Do: %w", err)
	}
	return n, nil
}

// ListNotes returns the list-view projection, paginated.
type ListNotes struct {
	Notes domain.NoteRepo
}

// Do executes the use case. folderID nil = all notes; non-nil = filter by folder.
func (uc *ListNotes) Do(ctx context.Context, userID uuid.UUID, limit int, cursor string, folderID *uuid.UUID) ([]domain.NoteSummary, string, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, next, err := uc.Notes.List(ctx, userID, limit, cursor, folderID)
	if err != nil {
		return nil, "", fmt.Errorf("hone.ListNotes.Do: %w", err)
	}
	return rows, next, nil
}

// DeleteNote removes a note by id + owner.
type DeleteNote struct {
	Notes domain.NoteRepo
}

// Do executes the use case.
func (uc *DeleteNote) Do(ctx context.Context, userID, noteID uuid.UUID) error {
	if err := uc.Notes.Delete(ctx, userID, noteID); err != nil {
		return fmt.Errorf("hone.DeleteNote.Do: %w", err)
	}
	return nil
}

// ─── GetNoteConnections ────────────────────────────────────────────────────

// GetNoteConnections scans the user's note corpus (and external kinds in
// future iterations) and emits a stream of Connection rows ordered by
// similarity DESC. MVP scans only hone_notes; v2 adds PR/task/session
// sources via cross-domain readers.
//
// Streaming rationale: brute-force cosine over a few thousand notes runs
// ~30ms on a modern server, but the same infra will fan out to Postgres
// (PRs) + ClickHouse (sessions) in v2 — those are slower. Ship the
// streaming contract now to avoid a breaking change.
type GetNoteConnections struct {
	Notes    domain.NoteRepo
	Embedder domain.Embedder
	Log      *slog.Logger
}

// GetNoteConnectionsInput — wire body.
type GetNoteConnectionsInput struct {
	UserID uuid.UUID
	NoteID uuid.UUID
}

// Do emits matches via `yield`. Error ends the stream; yielded nil means
// "no more results". Caller closes the underlying transport.
func (uc *GetNoteConnections) Do(ctx context.Context, in GetNoteConnectionsInput, yield func(domain.Connection) error) error {
	if uc.Embedder == nil {
		return fmt.Errorf("hone.GetNoteConnections.Do: %w", domain.ErrEmbeddingUnavailable)
	}
	seed, err := uc.Notes.Get(ctx, in.UserID, in.NoteID)
	if err != nil {
		return fmt.Errorf("hone.GetNoteConnections.Do: seed: %w", err)
	}

	// Phase I: always re-embed seed with the current model so the corpus
	// filter (by embedding_model_id) is anchored to the same vector space.
	// Stored seed.Embedding may have been written by an older model — using
	// it across a model swap silently produces meaningless cosine scores.
	// The extra embed call is cheap (~50ms, batched-tier model).
	seedVec, modelName, embedErr := uc.Embedder.Embed(ctx, seed.Title+"\n\n"+seed.BodyMD)
	if embedErr != nil {
		return fmt.Errorf("hone.GetNoteConnections.Do: embed seed: %w", embedErr)
	}

	// Phase IX v2: top-K push-down в Postgres через pgvector. Filter
	// (model + exclude seed + simFloor) + ranking + LIMIT — всё в одном
	// SQL'е c IVFFlat-index'ом. Никакого Go-cosine, никакого pre-fetch'а.
	hits, err := uc.Notes.SearchSimilarNotes(ctx, in.UserID, seedVec, modelName, seed.ID, 0.6, 10)
	if err != nil {
		return fmt.Errorf("hone.GetNoteConnections.Do: similar: %w", err)
	}

	for _, h := range hits {
		if err := yield(domain.Connection{
			Kind:         domain.ConnectionKindNote,
			TargetID:     h.ID.String(),
			DisplayTitle: h.Title,
			Snippet:      h.Snippet,
			Similarity:   h.Score,
		}); err != nil {
			return err
		}
	}
	return nil
}

// cosine returns the cosine similarity of two same-length vectors. Assumes
// non-zero inputs — bge-small outputs are always non-zero for non-empty
// inputs. Returns 0 for length mismatch rather than panic (defensive).
func cosine(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, na, nb float32
	for i := range a {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (sqrt32(na) * sqrt32(nb))
}

// sqrt32 wraps math.Sqrt with a float32 cast. Earlier Newton-iteration
// version was off by ~8% at x=384 (the full bge-small norm), corrupting
// cosine ranks near the 0.6 similarity threshold.
func sqrt32(x float32) float32 {
	if x <= 0 {
		return 0
	}
	return float32(math.Sqrt(float64(x)))
}

// Keep time import live for future date-based ranking (recency boost).
var _ = time.Time{}
