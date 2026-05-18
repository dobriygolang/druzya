// Tutor-side CRUD for curated atlas-node sequences. Use cases enforce
// per-row auth via tutor_id at the SQL gate so a client bug can't
// accidentally touch another tutor's path.

package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// ── List ──────────────────────────────────────────────────────────────

// ListReadingPaths — read-side для /tutor/paths surface.
type ListReadingPaths struct {
	Repo domain.ReadingPathRepo
}

// ListReadingPathsOutput — items + opaque next cursor (empty = end).
type ListReadingPathsOutput struct {
	Items      []domain.ReadingPath
	NextCursor string
}

func (uc *ListReadingPaths) Do(ctx context.Context, tutorID uuid.UUID, limit int, cursor string) (ListReadingPathsOutput, error) {
	if tutorID == uuid.Nil {
		return ListReadingPathsOutput{}, fmt.Errorf("tutor.ListReadingPaths: %w", domain.ErrInvalidInput)
	}
	if uc.Repo == nil {
		// Wirer skipped repo (e.g. degraded boot) — fail-closed empty list
		// instead of panicking on a nil deref.
		return ListReadingPathsOutput{}, nil
	}
	out, next, err := uc.Repo.ListReadingPathsByTutorPaged(ctx, tutorID, limit, cursor)
	if err != nil {
		return ListReadingPathsOutput{}, fmt.Errorf("tutor.ListReadingPaths: %w", err)
	}
	return ListReadingPathsOutput{Items: out, NextCursor: next}, nil
}

// ── Create ────────────────────────────────────────────────────────────

// CreateReadingPath — tutor mints a new curated sequence.
type CreateReadingPath struct {
	Repo domain.ReadingPathRepo
	Now  func() time.Time
}

type CreateReadingPathInput struct {
	TutorID       uuid.UUID
	Name          string
	Description   string
	AtlasNodeKeys []string
	ResourceIDs   []uuid.UUID
}

func (uc *CreateReadingPath) Do(ctx context.Context, in CreateReadingPathInput) (domain.ReadingPath, error) {
	name := strings.TrimSpace(in.Name)
	if in.TutorID == uuid.Nil {
		return domain.ReadingPath{}, fmt.Errorf("tutor.CreateReadingPath: %w: tutor_id required", domain.ErrInvalidInput)
	}
	if name == "" {
		return domain.ReadingPath{}, fmt.Errorf("tutor.CreateReadingPath: %w: name required", domain.ErrInvalidInput)
	}
	if len(in.AtlasNodeKeys) > domain.ReadingPathMaxNodes {
		return domain.ReadingPath{}, fmt.Errorf("tutor.CreateReadingPath: %w: too many atlas nodes (max %d)", domain.ErrInvalidInput, domain.ReadingPathMaxNodes)
	}
	if len(in.ResourceIDs) > domain.ReadingPathMaxNodes {
		return domain.ReadingPath{}, fmt.Errorf("tutor.CreateReadingPath: %w: too many resources (max %d)", domain.ErrInvalidInput, domain.ReadingPathMaxNodes)
	}
	now := nowOr(uc.Now)
	p := domain.ReadingPath{
		TutorID:       in.TutorID,
		Name:          name,
		Description:   strings.TrimSpace(in.Description),
		AtlasNodeKeys: dedupeStrings(in.AtlasNodeKeys),
		ResourceIDs:   dedupeUUIDs(in.ResourceIDs),
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	saved, err := uc.Repo.CreateReadingPath(ctx, p)
	if err != nil {
		return domain.ReadingPath{}, fmt.Errorf("tutor.CreateReadingPath: %w", err)
	}
	return saved, nil
}

// ── Update ────────────────────────────────────────────────────────────

// UpdateReadingPath — overwrite name/description/keys/ids in place.
type UpdateReadingPath struct {
	Repo domain.ReadingPathRepo
	Now  func() time.Time
}

type UpdateReadingPathInput struct {
	TutorID       uuid.UUID
	PathID        uuid.UUID
	Name          string
	Description   string
	AtlasNodeKeys []string
	ResourceIDs   []uuid.UUID
}

func (uc *UpdateReadingPath) Do(ctx context.Context, in UpdateReadingPathInput) (domain.ReadingPath, error) {
	name := strings.TrimSpace(in.Name)
	if in.TutorID == uuid.Nil || in.PathID == uuid.Nil {
		return domain.ReadingPath{}, fmt.Errorf("tutor.UpdateReadingPath: %w", domain.ErrInvalidInput)
	}
	if name == "" {
		return domain.ReadingPath{}, fmt.Errorf("tutor.UpdateReadingPath: %w: name required", domain.ErrInvalidInput)
	}
	if len(in.AtlasNodeKeys) > domain.ReadingPathMaxNodes {
		return domain.ReadingPath{}, fmt.Errorf("tutor.UpdateReadingPath: %w: too many atlas nodes (max %d)", domain.ErrInvalidInput, domain.ReadingPathMaxNodes)
	}
	if len(in.ResourceIDs) > domain.ReadingPathMaxNodes {
		return domain.ReadingPath{}, fmt.Errorf("tutor.UpdateReadingPath: %w: too many resources (max %d)", domain.ErrInvalidInput, domain.ReadingPathMaxNodes)
	}
	p := domain.ReadingPath{
		ID:            in.PathID,
		TutorID:       in.TutorID,
		Name:          name,
		Description:   strings.TrimSpace(in.Description),
		AtlasNodeKeys: dedupeStrings(in.AtlasNodeKeys),
		ResourceIDs:   dedupeUUIDs(in.ResourceIDs),
		UpdatedAt:     nowOr(uc.Now),
	}
	saved, err := uc.Repo.UpdateReadingPath(ctx, p)
	if err != nil {
		return domain.ReadingPath{}, fmt.Errorf("tutor.UpdateReadingPath: %w", err)
	}
	return saved, nil
}

// ── Archive ───────────────────────────────────────────────────────────

// ArchiveReadingPath — soft-delete. Idempotent.
type ArchiveReadingPath struct {
	Repo domain.ReadingPathRepo
	Now  func() time.Time
}

type ArchiveReadingPathInput struct {
	TutorID uuid.UUID
	PathID  uuid.UUID
}

func (uc *ArchiveReadingPath) Do(ctx context.Context, in ArchiveReadingPathInput) error {
	if in.TutorID == uuid.Nil || in.PathID == uuid.Nil {
		return fmt.Errorf("tutor.ArchiveReadingPath: %w", domain.ErrInvalidInput)
	}
	if err := uc.Repo.ArchiveReadingPath(ctx, in.TutorID, in.PathID, nowOr(uc.Now)); err != nil {
		return fmt.Errorf("tutor.ArchiveReadingPath: %w", err)
	}
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────

// dedupeStrings preserves order, drops empties + duplicates. Tutors
// drag-drop atlas nodes; a path with two copies of "go.routines" is a
// bug, not a feature.
func dedupeStrings(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	return out
}

func dedupeUUIDs(in []uuid.UUID) []uuid.UUID {
	if len(in) == 0 {
		return []uuid.UUID{}
	}
	seen := make(map[uuid.UUID]struct{}, len(in))
	out := make([]uuid.UUID, 0, len(in))
	for _, u := range in {
		if u == uuid.Nil {
			continue
		}
		if _, ok := seen[u]; ok {
			continue
		}
		seen[u] = struct{}{}
		out = append(out, u)
	}
	return out
}
