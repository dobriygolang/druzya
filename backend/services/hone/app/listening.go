// listening.go — Hone Listening-модуль use cases (Wave 6.1 of
// docs/feature/plan.md). Four thin orchestrators paralleling Reading's
// material methods. Vocab clicks reuse AddVocab from reading.go (the
// vocab queue is shared across both surfaces).
package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/hone/domain"

	"github.com/google/uuid"
)

// AddListeningMaterial — user added an audio item with a transcript.
// Frontend has already validated the URL is directly playable; we
// only persist + cap the transcript size.
type AddListeningMaterial struct {
	Repo domain.ListeningRepo
}

type AddListeningMaterialInput struct {
	UserID       uuid.UUID
	Title        string
	AudioURL     string
	TranscriptMD string
}

// listeningTranscriptMax — same 2 MB cap as Reading body. Plenty for a
// 90-min podcast transcript (~10–12k words).
const listeningTranscriptMax = 2_000_000

func (uc *AddListeningMaterial) Do(ctx context.Context, in AddListeningMaterialInput) (domain.ListeningMaterial, error) {
	if in.UserID == uuid.Nil {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.AddListeningMaterial: user_id required")
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.AddListeningMaterial: title required")
	}
	audioURL := strings.TrimSpace(in.AudioURL)
	if audioURL == "" {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.AddListeningMaterial: audio_url required")
	}
	transcript := strings.TrimSpace(in.TranscriptMD)
	if len(transcript) > listeningTranscriptMax {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.AddListeningMaterial: transcript too large (>2MB)")
	}
	saved, err := uc.Repo.CreateMaterial(ctx, domain.ListeningMaterial{
		UserID:       in.UserID,
		Title:        title,
		AudioURL:     audioURL,
		TranscriptMD: transcript,
	})
	if err != nil {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.AddListeningMaterial: %w", err)
	}
	return saved, nil
}

// GetListeningMaterial — load one material with transcript.
type GetListeningMaterial struct {
	Repo domain.ListeningRepo
}

func (uc *GetListeningMaterial) Do(ctx context.Context, userID, materialID uuid.UUID) (domain.ListeningMaterial, error) {
	if userID == uuid.Nil || materialID == uuid.Nil {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.GetListeningMaterial: ids required")
	}
	out, err := uc.Repo.GetMaterial(ctx, userID, materialID)
	if err != nil {
		return domain.ListeningMaterial{}, fmt.Errorf("hone.GetListeningMaterial: %w", err)
	}
	return out, nil
}

// ListListeningMaterials — library, most-recent first.
type ListListeningMaterials struct {
	Repo domain.ListeningRepo
}

func (uc *ListListeningMaterials) Do(ctx context.Context, userID uuid.UUID, limit int) ([]domain.ListeningMaterial, error) {
	if userID == uuid.Nil {
		return nil, fmt.Errorf("hone.ListListeningMaterials: user_id required")
	}
	out, err := uc.Repo.ListMaterials(ctx, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("hone.ListListeningMaterials: %w", err)
	}
	return out, nil
}

// ArchiveListeningMaterial — soft-delete from library. Reuses the
// `nowOr` helper from reading.go.
type ArchiveListeningMaterial struct {
	Repo domain.ListeningRepo
	Now  func() time.Time
}

func (uc *ArchiveListeningMaterial) Do(ctx context.Context, userID, materialID uuid.UUID) error {
	if userID == uuid.Nil || materialID == uuid.Nil {
		return fmt.Errorf("hone.ArchiveListeningMaterial: ids required")
	}
	if err := uc.Repo.ArchiveMaterial(ctx, userID, materialID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("hone.ArchiveListeningMaterial: %w", err)
	}
	return nil
}
