// Notes repository — split out of postgres.go.
package infra

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedMw "druz9/shared/pkg/middleware"
	sharedpg "druz9/shared/pkg/pg"
	"druz9/shared/pkg/synctomb"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Notes implements domain.NoteRepo. Embedding column is a float4[] in
// Postgres; we map to []float32 in Go without pgvector.
type Notes struct {
	pool *pgxpool.Pool
}

// NewNotes wraps a pool.
func NewNotes(pool *pgxpool.Pool) *Notes { return &Notes{pool: pool} }

// Create inserts a note.
func (n *Notes) Create(ctx context.Context, note domain.Note) (domain.Note, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	var folderID *pgtype.UUID
	if note.FolderID != nil {
		v := sharedpg.UUID(*note.FolderID)
		folderID = &v
	}
	err := n.pool.QueryRow(ctx,
		`INSERT INTO hone_notes (user_id, title, body_md, size_bytes, folder_id)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(note.UserID), note.Title, note.BodyMD, int32(note.SizeBytes), folderID,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.Notes.Create: %w", err)
	}
	note.ID = sharedpg.UUIDFrom(id)
	note.CreatedAt = createdAt
	note.UpdatedAt = updatedAt
	return note, nil
}

// Update overwrites title + body.
func (n *Notes) Update(ctx context.Context, note domain.Note) (domain.Note, error) {
	var (
		createdAt time.Time
		updatedAt time.Time
	)
	err := n.pool.QueryRow(ctx,
		`UPDATE hone_notes
		    SET title=$3, body_md=$4, size_bytes=$5, updated_at=now()
		  WHERE id=$1 AND user_id=$2
		  RETURNING created_at, updated_at`,
		sharedpg.UUID(note.ID), sharedpg.UUID(note.UserID), note.Title, note.BodyMD, int32(note.SizeBytes),
	).Scan(&createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Note{}, domain.ErrNotFound
		}
		return domain.Note{}, fmt.Errorf("hone.Notes.Update: %w", err)
	}
	note.CreatedAt = createdAt
	note.UpdatedAt = updatedAt
	return note, nil
}

// Get fetches one note with its embedding.
func (n *Notes) Get(ctx context.Context, userID, noteID uuid.UUID) (domain.Note, error) {
	var (
		title          string
		bodyMD         string
		sizeBytes      int32
		folderID       pgtype.UUID
		embedding      []float32
		embeddingModel pgtype.Text
		embeddedAt     pgtype.Timestamptz
		createdAt      time.Time
		updatedAt      time.Time
		encrypted      bool
	)
	err := n.pool.QueryRow(ctx,
		`SELECT n.title, n.body_md, n.size_bytes, n.folder_id, n.embedding,
		        em.name, n.embedded_at, n.created_at, n.updated_at, n.encrypted
		   FROM hone_notes n
		   LEFT JOIN embedding_models em ON em.id = n.embedding_model_id
		  WHERE n.id=$1 AND n.user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID),
	).Scan(&title, &bodyMD, &sizeBytes, &folderID, &embedding, &embeddingModel, &embeddedAt, &createdAt, &updatedAt, &encrypted)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Note{}, domain.ErrNotFound
		}
		return domain.Note{}, fmt.Errorf("hone.Notes.Get: %w", err)
	}
	out := domain.Note{
		ID:        noteID,
		UserID:    userID,
		Title:     title,
		BodyMD:    bodyMD,
		SizeBytes: int(sizeBytes),
		Embedding: embedding,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
		Encrypted: encrypted,
	}
	if folderID.Valid {
		fid := sharedpg.UUIDFrom(folderID)
		out.FolderID = &fid
	}
	if embeddingModel.Valid {
		out.EmbeddingModel = embeddingModel.String
	}
	if embeddedAt.Valid {
		t := embeddedAt.Time
		out.EmbeddedAt = &t
	}
	return out, nil
}

// notesListCursor — инкапсулирует якорь keyset-пагинации. Сериализуется в
// base64(JSON), непрозрачный для клиента. (updated_at, id) — составной ключ;
// id нужен чтобы развести записи с одинаковым updated_at при массовых
// импортах или сек.-точностях TS.
type notesListCursor struct {
	UpdatedAt time.Time `json:"u"`
	ID        string    `json:"i"`
}

func encodeNotesCursor(c notesListCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeNotesCursor(s string) (notesListCursor, error) {
	if s == "" {
		return notesListCursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return notesListCursor{}, fmt.Errorf("decode cursor: %w", err)
	}
	var c notesListCursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return notesListCursor{}, fmt.Errorf("unmarshal cursor: %w", err)
	}
	return c, nil
}

// List возвращает страницу заметок, отсортированных (updated_at DESC, id DESC).
// Keyset-пагинация: next_cursor = якорь последней строки. Невалидный cursor
// возвращает ошибку (не маскируется под пустую страницу, чтобы баг клиента
// не стал «ничего нет»).
//
// Пустая строка next_cursor означает конец выборки. Размер страницы: до limit.
// Дополнительная строка «подглядывания» (limit+1) используется чтобы понять,
// есть ли следующая страница, не делая второй запрос.
func (n *Notes) List(ctx context.Context, userID uuid.UUID, limit int, cursor string, folderID *uuid.UUID) ([]domain.NoteSummary, string, error) {
	c, err := decodeNotesCursor(cursor)
	if err != nil {
		return nil, "", fmt.Errorf("hone.Notes.List: %w", err)
	}

	// v2 baseline: archived_at column dropped (hard delete only). Listing
	// is straight by user_id; no soft-delete filter.
	sqlBase := `SELECT id, title, size_bytes, folder_id, updated_at
	              FROM hone_notes
	             WHERE user_id=$1`
	args := []any{sharedpg.UUID(userID)}

	if folderID != nil {
		sqlBase += ` AND folder_id=$2`
		args = append(args, sharedpg.UUID(*folderID))
	}

	// Peek limit+1: если вернулось больше limit — значит ещё есть страница.
	peek := int32(limit) + 1

	var rows pgx.Rows
	if c.UpdatedAt.IsZero() {
		nextParam := len(args) + 1
		rows, err = n.pool.Query(ctx,
			sqlBase+fmt.Sprintf(`
			  ORDER BY updated_at DESC, id DESC
			  LIMIT $%d`, nextParam),
			append(args, peek)...,
		)
	} else {
		cid, parseErr := uuid.Parse(c.ID)
		if parseErr != nil {
			return nil, "", fmt.Errorf("hone.Notes.List: cursor id: %w", parseErr)
		}
		np := len(args) + 1
		rows, err = n.pool.Query(ctx,
			sqlBase+fmt.Sprintf(` AND (updated_at, id) < ($%d, $%d)
			  ORDER BY updated_at DESC, id DESC
			  LIMIT $%d`, np, np+1, np+2),
			append(args, c.UpdatedAt, sharedpg.UUID(cid), peek)...,
		)
	}
	if err != nil {
		return nil, "", fmt.Errorf("hone.Notes.List: %w", err)
	}
	defer rows.Close()

	out := make([]domain.NoteSummary, 0, limit)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			sizeBytes int32
			fid       pgtype.UUID
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &sizeBytes, &fid, &updatedAt); err != nil {
			return nil, "", fmt.Errorf("hone.Notes.List: scan: %w", err)
		}
		s := domain.NoteSummary{
			ID:        sharedpg.UUIDFrom(id),
			Title:     title,
			SizeBytes: int(sizeBytes),
			UpdatedAt: updatedAt,
		}
		if fid.Valid {
			v := sharedpg.UUIDFrom(fid)
			s.FolderID = &v
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, "", fmt.Errorf("hone.Notes.List: rows: %w", err)
	}

	// Есть ли следующая страница? Peek-строка обрезается, её якорь не
	// выдаём — возвращаем якорь последней строки текущей страницы.
	var nextCursor string
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextCursor = encodeNotesCursor(notesListCursor{
			UpdatedAt: last.UpdatedAt,
			ID:        last.ID.String(),
		})
	}
	return out, nextCursor, nil
}

// Delete removes a note. Атомарно с DELETE пишет sync_tombstone —
// pull-endpoint потом вернёт это удаление другим устройствам юзера.
func (n *Notes) Delete(ctx context.Context, userID, noteID uuid.UUID) error {
	tx, err := n.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("hone.Notes.Delete: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	cmd, err := tx.Exec(ctx,
		`DELETE FROM hone_notes WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.Notes.Delete: exec: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if err := synctomb.Write(ctx, tx, synctomb.TableHoneNotes,
		userID, noteID, sharedMw.DeviceIDFromContext(ctx)); err != nil {
		return fmt.Errorf("hone.Notes.Delete: tombstone: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("hone.Notes.Delete: commit: %w", err)
	}
	return nil
}

// ExistsByTitleForUser — точный match по title, archived'ы игнорируются.
// Используется TodayStandup endpoint для проверки «уже записал standup
// на сегодня?» (note title формируется как "Standup YYYY-MM-DD").
func (n *Notes) ExistsByTitleForUser(ctx context.Context, userID uuid.UUID, title string) (bool, error) {
	var exists bool
	err := n.pool.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM hone_notes
		    WHERE user_id=$1 AND title=$2
		 )`,
		sharedpg.UUID(userID), title,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("hone.Notes.ExistsByTitleForUser: %w", err)
	}
	return exists, nil
}

// SetEmbedding writes the vector + metadata. The model name is resolved
// against the embedding_models lookup table; an unknown name leaves the
// FK NULL (and the row will be re-embedded next time the model is seeded).
//
// Writes both embedding columns: legacy real[] and pgvector vector(384).
// Backfill старых rows вручную — см. migration baseline.sql у
// CREATE INDEX idx_hone_notes_embedding_vec.
func (n *Notes) SetEmbedding(ctx context.Context, userID, noteID uuid.UUID, vec []float32, model string, at time.Time) error {
	_, err := n.pool.Exec(ctx,
		`UPDATE hone_notes
		    SET embedding=$3,
		        embedding_vec=NULLIF($6, '')::vector,
		        embedding_model_id=(SELECT id FROM embedding_models WHERE name = $4),
		        embedded_at=$5
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID), vec, model, at, sharedpg.VectorString(vec),
	)
	if err != nil {
		return fmt.Errorf("hone.Notes.SetEmbedding: %w", err)
	}
	return nil
}

// Move sets folder_id for a note. folderID nil = move to root (unfiled).
// Validates folder ownership before the UPDATE so a non-existent or
// foreign folder surfaces as ErrNotFound instead of leaking a generic
// FK / "hone failure" 500 to the client.
func (n *Notes) Move(ctx context.Context, userID, noteID uuid.UUID, folderID *uuid.UUID) (domain.Note, error) {
	var fid *pgtype.UUID
	if folderID != nil {
		var ownerID pgtype.UUID
		err := n.pool.QueryRow(ctx,
			`SELECT user_id FROM hone_note_folders WHERE id=$1`,
			sharedpg.UUID(*folderID),
		).Scan(&ownerID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.Note{}, domain.ErrNotFound
			}
			return domain.Note{}, fmt.Errorf("hone.Notes.Move: folder lookup: %w", err)
		}
		if sharedpg.UUIDFrom(ownerID) != userID {
			return domain.Note{}, domain.ErrNotOwner
		}
		v := sharedpg.UUID(*folderID)
		fid = &v
	}
	tag, err := n.pool.Exec(ctx,
		`UPDATE hone_notes SET folder_id=$3, updated_at=now()
		  WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID), fid,
	)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.Notes.Move: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Note{}, domain.ErrNotFound
	}
	return n.Get(ctx, userID, noteID)
}

// MarkStaleForReembed clears embedded_at for every note whose vector was
// produced by a model OTHER than currentModelName. The async embed worker
// picks them up via the existing partial index. Returns count of marked rows.
//
// Не трогает encrypted notes (там embedding невозможен) и notes без
// embedding'а вовсе (worker сам подберёт).
func (n *Notes) MarkStaleForReembed(ctx context.Context, currentModelName string) (int64, error) {
	if currentModelName == "" {
		return 0, fmt.Errorf("hone.Notes.MarkStaleForReembed: currentModelName is required")
	}
	tag, err := n.pool.Exec(ctx,
		`UPDATE hone_notes
		    SET embedded_at = NULL
		  WHERE embedded_at IS NOT NULL
		    AND embedding IS NOT NULL
		    AND NOT encrypted
		    AND embedding_model_id IS DISTINCT FROM
		        (SELECT id FROM embedding_models WHERE name = $1)`,
		currentModelName,
	)
	if err != nil {
		return 0, fmt.Errorf("hone.Notes.MarkStaleForReembed: %w", err)
	}
	return tag.RowsAffected(), nil
}

// SearchSimilarNotes — pgvector top-K с push-down в Postgres.
// modelName == "" → фильтр выключен (тестовый back-compat path);
// excludeNoteID == uuid.Nil → не фильтруем (например для AskNotes где
// seed-ноты нет). simFloor применяется как `1 - distance >= floor`
// (для cosine_ops `<=>` — distance в [0..2], score = 1-distance в [-1..1]).
func (n *Notes) SearchSimilarNotes(
	ctx context.Context,
	userID uuid.UUID,
	queryVec []float32,
	modelName string,
	excludeNoteID uuid.UUID,
	simFloor float32,
	limit int,
) ([]domain.NoteSimilarityHit, error) {
	if len(queryVec) == 0 {
		return nil, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	vecStr := sharedpg.VectorString(queryVec)
	if vecStr == "" {
		return nil, nil
	}
	q := `SELECT id, title, LEFT(body_md, 140),
	             1 - (embedding_vec <=> $2::vector) AS similarity
	   FROM hone_notes
	  WHERE user_id = $1
	    AND embedding_vec IS NOT NULL
	    AND NOT encrypted`
	args := []any{sharedpg.UUID(userID), vecStr}
	if modelName != "" {
		q += fmt.Sprintf(" AND embedding_model_id = (SELECT id FROM embedding_models WHERE name = $%d)", len(args)+1)
		args = append(args, modelName)
	}
	if excludeNoteID != uuid.Nil {
		q += fmt.Sprintf(" AND id <> $%d", len(args)+1)
		args = append(args, sharedpg.UUID(excludeNoteID))
	}
	// simFloor → переводим в distance ceiling (`embedding_vec <=> v <= 1 - simFloor`)
	// для использования IVFFlat index'а на ORDER BY.
	if simFloor > 0 {
		q += fmt.Sprintf(" AND (embedding_vec <=> $2::vector) <= $%d", len(args)+1)
		args = append(args, float64(1-simFloor))
	}
	q += fmt.Sprintf(" ORDER BY embedding_vec <=> $2::vector ASC LIMIT $%d", len(args)+1)
	args = append(args, limit)
	rows, err := n.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("hone.Notes.SearchSimilarNotes: %w", err)
	}
	defer rows.Close()
	out := make([]domain.NoteSimilarityHit, 0, limit)
	for rows.Next() {
		var (
			id         pgtype.UUID
			title      string
			snippet    string
			similarity float64
		)
		if err := rows.Scan(&id, &title, &snippet, &similarity); err != nil {
			return nil, fmt.Errorf("hone.Notes.SearchSimilarNotes: scan: %w", err)
		}
		out = append(out, domain.NoteSimilarityHit{
			ID:      sharedpg.UUIDFrom(id),
			Title:   title,
			Snippet: snippet,
			Score:   float32(similarity),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Notes.SearchSimilarNotes: rows: %w", err)
	}
	return out, nil
}

// WithEmbeddingsForUser returns the minimal projection for cosine scanning.
// Snippet is the first 140 chars of body_md.
//
// Filters by embedding_model_id matching modelName — mixed-model cosine is
// undefined (different vector spaces, often different dimensionality).
// modelName == "" disables the filter (test path); production always passes it.
func (n *Notes) WithEmbeddingsForUser(ctx context.Context, userID uuid.UUID, modelName string) ([]domain.NoteEmbedding, error) {
	// NOT encrypted: ciphertext body_md → embedding garbage. Embed worker
	// skips encrypted notes too (см. notes.go EmbedFn skip), но defensive-
	// фильтр здесь страхует на случай legacy embeddings от заметки которая
	// потом была encrypt'нута.
	q := `SELECT id, title, LEFT(body_md, 140), embedding
		   FROM hone_notes
		  WHERE user_id=$1 AND embedding IS NOT NULL AND NOT encrypted`
	args := []any{sharedpg.UUID(userID)}
	if modelName != "" {
		q += ` AND embedding_model_id = (SELECT id FROM embedding_models WHERE name = $2)`
		args = append(args, modelName)
	}
	rows, err := n.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("hone.Notes.WithEmbeddingsForUser: %w", err)
	}
	defer rows.Close()
	out := make([]domain.NoteEmbedding, 0, 32)
	for rows.Next() {
		var (
			id        pgtype.UUID
			title     string
			snippet   string
			embedding []float32
		)
		if err := rows.Scan(&id, &title, &snippet, &embedding); err != nil {
			return nil, fmt.Errorf("hone.Notes.WithEmbeddingsForUser: scan: %w", err)
		}
		out = append(out, domain.NoteEmbedding{
			ID:        sharedpg.UUIDFrom(id),
			Title:     title,
			Snippet:   snippet,
			Embedding: embedding,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Notes.WithEmbeddingsForUser: rows: %w", err)
	}
	return out, nil
}

// SetAIExcluded toggles hone_notes.ai_excluded (Phase K Wave 15).
// Stub returning ErrNotFound when the row is missing; real query path
// is owned by the parallel «AI-readable» agent (migration 00121_notes_ai_excluded).
// Wave 15 LLL agent surfaces it for interface completeness.
func (n *Notes) SetAIExcluded(ctx context.Context, userID, noteID uuid.UUID, excluded bool) (domain.Note, error) {
	row := n.pool.QueryRow(ctx, `
        UPDATE hone_notes
           SET ai_excluded = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2
        RETURNING id, title, body_md, created_at, updated_at, folder_id, encrypted, COALESCE(ai_excluded, false)`,
		sharedpg.UUID(noteID), sharedpg.UUID(userID), excluded,
	)
	var (
		id          pgtype.UUID
		title, body string
		createdAt, updatedAt time.Time
		folderID    pgtype.UUID
		encrypted   bool
		aiExcluded  bool
	)
	if err := row.Scan(&id, &title, &body, &createdAt, &updatedAt, &folderID, &encrypted, &aiExcluded); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Note{}, domain.ErrNotFound
		}
		return domain.Note{}, fmt.Errorf("hone.Notes.SetAIExcluded: %w", err)
	}
	out := domain.Note{
		ID:        sharedpg.UUIDFrom(id),
		UserID:    userID,
		Title:     title,
		BodyMD:    body,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
		SizeBytes: len(body),
		Encrypted: encrypted,
		AIExcluded: aiExcluded,
	}
	if folderID.Valid {
		fid := sharedpg.UUIDFrom(folderID)
		out.FolderID = &fid
	}
	return out, nil
}

// ListAIAvailable returns recent unencrypted non-ai_excluded notes
// (Phase K Wave 15). Stub: real impl is owned by parallel «suggest-tasks-
// from-notes» agent. Provides a basic SQL path so the build compiles —
// safe for fallback paths.
func (n *Notes) ListAIAvailable(ctx context.Context, userID uuid.UUID, lookback time.Duration, limit int) ([]domain.Note, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if lookback <= 0 {
		lookback = 7 * 24 * time.Hour
	}
	cutoff := time.Now().UTC().Add(-lookback)
	rows, err := n.pool.Query(ctx, `
        SELECT id, title, body_md, created_at, updated_at
          FROM hone_notes
         WHERE user_id = $1
           AND NOT encrypted
           AND COALESCE(ai_excluded, false) = false
           AND updated_at >= $2
         ORDER BY updated_at DESC
         LIMIT $3`,
		sharedpg.UUID(userID), cutoff, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Notes.ListAIAvailable: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Note, 0, limit)
	for rows.Next() {
		var (
			id          pgtype.UUID
			title, body string
			createdAt, updatedAt time.Time
		)
		if err := rows.Scan(&id, &title, &body, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.Notes.ListAIAvailable: scan: %w", err)
		}
		out = append(out, domain.Note{
			ID:        sharedpg.UUIDFrom(id),
			UserID:    userID,
			Title:     title,
			BodyMD:    body,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
			SizeBytes: len(body),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Notes.ListAIAvailable: rows: %w", err)
	}
	return out, nil
}
