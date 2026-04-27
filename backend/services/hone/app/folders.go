package app

import (
	"context"
	"fmt"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// ─── CreateFolder ──────────────────────────────────────────────────────────

type CreateFolder struct {
	Folders domain.FolderRepo
	Now     func() time.Time
}

type CreateFolderInput struct {
	UserID   uuid.UUID
	Name     string
	ParentID *uuid.UUID
}

func (uc *CreateFolder) Do(ctx context.Context, in CreateFolderInput) (domain.Folder, error) {
	now := uc.Now().UTC()
	f := domain.Folder{
		UserID:    in.UserID,
		Name:      in.Name,
		ParentID:  in.ParentID,
		CreatedAt: now,
		UpdatedAt: now,
	}
	created, err := uc.Folders.Create(ctx, f)
	if err != nil {
		return domain.Folder{}, fmt.Errorf("hone.CreateFolder.Do: %w", err)
	}
	return created, nil
}

// ─── ListFolders ──────────────────────────────────────────────────────────

type ListFolders struct {
	Folders domain.FolderRepo
}

func (uc *ListFolders) Do(ctx context.Context, userID uuid.UUID) ([]domain.Folder, error) {
	folders, err := uc.Folders.List(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("hone.ListFolders.Do: %w", err)
	}
	return folders, nil
}

// ─── DeleteFolder ─────────────────────────────────────────────────────────

type DeleteFolder struct {
	Folders domain.FolderRepo
}

type DeleteFolderInput struct {
	UserID          uuid.UUID
	FolderID        uuid.UUID
	MoveNotesToRoot bool
}

func (uc *DeleteFolder) Do(ctx context.Context, in DeleteFolderInput) error {
	if err := uc.Folders.Delete(ctx, in.UserID, in.FolderID, in.MoveNotesToRoot); err != nil {
		return fmt.Errorf("hone.DeleteFolder.Do: %w", err)
	}
	return nil
}

// ─── MoveNote ─────────────────────────────────────────────────────────────

type MoveNote struct {
	Notes domain.NoteRepo
}

type MoveNoteInput struct {
	UserID   uuid.UUID
	NoteID   uuid.UUID
	FolderID *uuid.UUID
}

func (uc *MoveNote) Do(ctx context.Context, in MoveNoteInput) (domain.Note, error) {
	note, err := uc.Notes.Move(ctx, in.UserID, in.NoteID, in.FolderID)
	if err != nil {
		return domain.Note{}, fmt.Errorf("hone.MoveNote.Do: %w", err)
	}
	return note, nil
}
