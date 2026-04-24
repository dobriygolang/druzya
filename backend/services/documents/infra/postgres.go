package infra

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"druz9/documents/domain"
	documentsdb "druz9/documents/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PgRepo is the Postgres-backed domain.Repository. Holds a *pgxpool.Pool
// and a sqlc Queries view — the pool is used directly for CopyFrom (bulk
// chunk insert) which sqlc doesn't emit.
type PgRepo struct {
	pool *pgxpool.Pool
	q    *documentsdb.Queries
}

// NewPgRepo returns a Repository backed by the shared pgxpool.
func NewPgRepo(pool *pgxpool.Pool) *PgRepo {
	return &PgRepo{pool: pool, q: documentsdb.New(pool)}
}

// InsertDocument upserts on (user_id, sha256) — see migration 00011.
func (r *PgRepo) InsertDocument(ctx context.Context, d domain.Document) (domain.Document, error) {
	row, err := r.q.InsertDocument(ctx, documentsdb.InsertDocumentParams{
		UserID:    toUUID(d.UserID),
		Filename:  d.Filename,
		Mime:      d.MIME,
		SizeBytes: d.SizeBytes,
		Sha256:    d.SHA256,
		SourceUrl: d.SourceURL,
	})
	if err != nil {
		return domain.Document{}, fmt.Errorf("documents.PgRepo.InsertDocument: %w", err)
	}
	return fromDB(row), nil
}

func (r *PgRepo) GetDocument(ctx context.Context, userID, id uuid.UUID) (domain.Document, error) {
	row, err := r.q.GetDocument(ctx, documentsdb.GetDocumentParams{
		ID: toUUID(id), UserID: toUUID(userID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Document{}, domain.ErrNotFound
		}
		return domain.Document{}, fmt.Errorf("documents.PgRepo.GetDocument: %w", err)
	}
	return fromDB(row), nil
}

// ListDocuments implements keyset pagination. cursor is an opaque base64
// string encoding (createdAt, id) — opaque so callers can't manipulate
// ordering by hand-crafting one.
func (r *PgRepo) ListDocuments(ctx context.Context, userID uuid.UUID, cursor string, limit int) ([]domain.Document, string, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	isFirst := cursor == ""
	curTS, curID, err := decodeCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("decode cursor: %w", err)
	}

	// Fetch limit+1 so we can tell whether there's another page without
	// issuing a second query. The extra row is trimmed before returning.
	rows, err := r.q.ListDocumentsByUser(ctx, documentsdb.ListDocumentsByUserParams{
		UserID:          toUUID(userID),
		IsFirstPage:     isFirst,
		CursorCreatedAt: toTimestamp(curTS),
		CursorID:        toUUID(curID),
		PageSize:        int32(limit + 1),
	})
	if err != nil {
		return nil, "", fmt.Errorf("documents.PgRepo.ListDocuments: %w", err)
	}

	var nextCursor string
	if len(rows) > limit {
		last := rows[limit-1]
		nextCursor = encodeCursor(last.CreatedAt.Time, fromUUID(last.ID))
		rows = rows[:limit]
	}

	out := make([]domain.Document, len(rows))
	for i, r := range rows {
		out[i] = fromDB(r)
	}
	return out, nextCursor, nil
}

func (r *PgRepo) UpdateDocumentStatus(ctx context.Context, id uuid.UUID, status domain.Status, errMsg string, chunkCount, tokenCount int) error {
	_, err := r.q.UpdateDocumentStatus(ctx, documentsdb.UpdateDocumentStatusParams{
		ID:           toUUID(id),
		Status:       string(status),
		ErrorMessage: errMsg,
		ChunkCount:   int32(chunkCount),
		TokenCount:   int32(tokenCount),
	})
	if err != nil {
		return fmt.Errorf("documents.PgRepo.UpdateDocumentStatus: %w", err)
	}
	return nil
}

func (r *PgRepo) DeleteDocument(ctx context.Context, userID, id uuid.UUID) error {
	n, err := r.q.DeleteDocument(ctx, documentsdb.DeleteDocumentParams{
		ID: toUUID(id), UserID: toUUID(userID),
	})
	if err != nil {
		return fmt.Errorf("documents.PgRepo.DeleteDocument: %w", err)
	}
	if n == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// InsertChunks bulk-loads via pgx's CopyFrom. Much faster than N inserts
// for the typical 30-200 chunks per document. Runs inside a transaction
// so a partial failure doesn't leave half a document indexed.
func (r *PgRepo) InsertChunks(ctx context.Context, docID uuid.UUID, chunks []domain.Chunk) error {
	if len(chunks) == 0 {
		return nil
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("documents.PgRepo.InsertChunks: begin: %w", err)
	}
	// Commit-or-rollback is the norm; the deferred rollback is a no-op
	// after a successful Commit. Explicit `_ =` beats a //nolint for the
	// errcheck linter and keeps the intent obvious to readers.
	defer func() { _ = tx.Rollback(ctx) }()

	rows := make([][]any, len(chunks))
	for i, c := range chunks {
		// Let Postgres fill id + created_at via defaults — the COPY
		// protocol requires a full column list match, so we omit them
		// from both the column list and the row tuple.
		rows[i] = []any{
			toUUID(docID),
			int32(c.Ord),
			c.Content,
			c.Embedding,
			int32(c.TokenCount),
		}
	}

	_, err = tx.CopyFrom(
		ctx,
		pgx.Identifier{"doc_chunks"},
		[]string{"doc_id", "ord", "content", "embedding", "token_count"},
		pgx.CopyFromRows(rows),
	)
	if err != nil {
		return fmt.Errorf("copy doc_chunks: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("documents.PgRepo.InsertChunks: commit: %w", err)
	}
	return nil
}

func (r *PgRepo) ListChunks(ctx context.Context, docIDs []uuid.UUID) ([]domain.Chunk, error) {
	if len(docIDs) == 0 {
		return []domain.Chunk{}, nil
	}
	ids := make([]pgtype.UUID, len(docIDs))
	for i, id := range docIDs {
		ids[i] = toUUID(id)
	}
	rows, err := r.q.ListChunksByDoc(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("documents.PgRepo.ListChunks: %w", err)
	}
	out := make([]domain.Chunk, len(rows))
	for i, r := range rows {
		out[i] = domain.Chunk{
			ID:         fromUUID(r.ID),
			DocID:      fromUUID(r.DocID),
			Ord:        int(r.Ord),
			Content:    r.Content,
			Embedding:  r.Embedding,
			TokenCount: int(r.TokenCount),
			CreatedAt:  r.CreatedAt.Time,
		}
	}
	return out, nil
}

// ─────────────────────────────────────────────────────────────────────────
// type bridges
// ─────────────────────────────────────────────────────────────────────────

func toUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

func fromUUID(u pgtype.UUID) uuid.UUID {
	return uuid.UUID(u.Bytes)
}

func toTimestamp(t time.Time) pgtype.Timestamptz {
	if t.IsZero() {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func fromDB(r documentsdb.Document) domain.Document {
	return domain.Document{
		ID:           fromUUID(r.ID),
		UserID:       fromUUID(r.UserID),
		Filename:     r.Filename,
		MIME:         r.Mime,
		SizeBytes:    r.SizeBytes,
		SHA256:       r.Sha256,
		SourceURL:    r.SourceUrl,
		Status:       domain.Status(r.Status),
		ErrorMessage: r.ErrorMessage,
		ChunkCount:   int(r.ChunkCount),
		TokenCount:   int(r.TokenCount),
		CreatedAt:    r.CreatedAt.Time,
		UpdatedAt:    r.UpdatedAt.Time,
	}
}

// ─────────────────────────────────────────────────────────────────────────
// cursor codec — opaque base64(uuid.Bytes + int64 nanos)
// ─────────────────────────────────────────────────────────────────────────
//
// Opaque on purpose: clients can't invent a cursor to jump around,
// and we can swap the underlying ordering later without an API bump.

func encodeCursor(t time.Time, id uuid.UUID) string {
	var buf [24]byte
	copy(buf[:16], id[:])
	nanos := t.UnixNano()
	for i := 0; i < 8; i++ {
		buf[16+i] = byte(nanos >> (56 - i*8))
	}
	return base64.RawURLEncoding.EncodeToString(buf[:])
}

func decodeCursor(s string) (time.Time, uuid.UUID, error) {
	if s == "" {
		return time.Time{}, uuid.UUID{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || len(raw) != 24 {
		return time.Time{}, uuid.UUID{}, errors.New("invalid cursor")
	}
	var id uuid.UUID
	copy(id[:], raw[:16])
	var nanos int64
	for i := 0; i < 8; i++ {
		nanos = (nanos << 8) | int64(raw[16+i])
	}
	return time.Unix(0, nanos), id, nil
}

// Guard.
var _ domain.Repository = (*PgRepo)(nil)
