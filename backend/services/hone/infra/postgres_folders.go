// Folders repository — moved out of postgres.go (Wave 10 split).
package infra

import (
	"context"
	"fmt"
	"time"

	"druz9/hone/domain"
	sharedpg "druz9/shared/pkg/pg"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Folders implements domain.FolderRepo.
type Folders struct {
	pool *pgxpool.Pool
}

// NewFolders wraps a pool.
func NewFolders(pool *pgxpool.Pool) *Folders { return &Folders{pool: pool} }

func (f *Folders) Create(ctx context.Context, folder domain.Folder) (domain.Folder, error) {
	var (
		id        pgtype.UUID
		createdAt time.Time
		updatedAt time.Time
	)
	var parentID *pgtype.UUID
	if folder.ParentID != nil {
		v := sharedpg.UUID(*folder.ParentID)
		parentID = &v
	}
	err := f.pool.QueryRow(ctx,
		`INSERT INTO hone_note_folders (user_id, name, parent_id)
		 VALUES ($1, $2, $3)
		 RETURNING id, created_at, updated_at`,
		sharedpg.UUID(folder.UserID), folder.Name, parentID,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return domain.Folder{}, fmt.Errorf("hone.Folders.Create: %w", err)
	}
	folder.ID = sharedpg.UUIDFrom(id)
	folder.CreatedAt = createdAt
	folder.UpdatedAt = updatedAt
	return folder, nil
}

func (f *Folders) List(ctx context.Context, userID uuid.UUID) ([]domain.Folder, error) {
	rows, err := f.pool.Query(ctx,
		`SELECT id, name, parent_id, created_at, updated_at
		   FROM hone_note_folders
		  WHERE user_id=$1
		  ORDER BY name ASC`,
		sharedpg.UUID(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("hone.Folders.List: %w", err)
	}
	defer rows.Close()
	var out []domain.Folder
	for rows.Next() {
		var (
			id        pgtype.UUID
			name      string
			parentID  pgtype.UUID
			createdAt time.Time
			updatedAt time.Time
		)
		if err := rows.Scan(&id, &name, &parentID, &createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("hone.Folders.List: scan: %w", err)
		}
		folder := domain.Folder{
			ID:        sharedpg.UUIDFrom(id),
			UserID:    userID,
			Name:      name,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
		}
		if parentID.Valid {
			pid := sharedpg.UUIDFrom(parentID)
			folder.ParentID = &pid
		}
		out = append(out, folder)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("hone.Folders.List: rows: %w", err)
	}
	return out, nil
}

func (f *Folders) Delete(ctx context.Context, userID, folderID uuid.UUID, moveNotesToRoot bool) error {
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("hone.Folders.Delete: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if moveNotesToRoot {
		_, err = tx.Exec(ctx,
			`UPDATE hone_notes SET folder_id=NULL, updated_at=now()
			  WHERE folder_id=$1 AND user_id=$2`,
			sharedpg.UUID(folderID), sharedpg.UUID(userID),
		)
		if err != nil {
			return fmt.Errorf("hone.Folders.Delete: move notes: %w", err)
		}
		// Re-parent дочерних папок в root (parent_id=NULL). Без этого
		// дети остаются orphan'ами с висячим parent_id → frontend
		// FolderTreeBranch их не находит при обходе с root и они
		// перестают отображаться. Поведение «folder + всё внутри
		// уезжает в root» симметрично notes-flow выше.
		_, err = tx.Exec(ctx,
			`UPDATE hone_note_folders SET parent_id=NULL, updated_at=now()
			  WHERE parent_id=$1 AND user_id=$2`,
			sharedpg.UUID(folderID), sharedpg.UUID(userID),
		)
		if err != nil {
			return fmt.Errorf("hone.Folders.Delete: reparent children: %w", err)
		}
	} else {
		var count int
		if scanErr := tx.QueryRow(ctx,
			`SELECT COUNT(*) FROM hone_notes WHERE folder_id=$1 AND user_id=$2`,
			sharedpg.UUID(folderID), sharedpg.UUID(userID),
		).Scan(&count); scanErr != nil {
			return fmt.Errorf("hone.Folders.Delete: count notes: %w", scanErr)
		}
		if count > 0 {
			return domain.ErrFolderNotEmpty
		}
	}

	cmd, err := tx.Exec(ctx,
		`DELETE FROM hone_note_folders WHERE id=$1 AND user_id=$2`,
		sharedpg.UUID(folderID), sharedpg.UUID(userID),
	)
	if err != nil {
		return fmt.Errorf("hone.Folders.Delete: delete: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("hone.Folders.Delete: commit: %w", err)
	}
	return nil
}
