package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"druz9/intelligence/domain"

	"github.com/google/uuid"
)

// fakeMemoryEntriesReader — in-memory store + soft-delete bookkeeping.
type fakeMemoryEntriesReader struct {
	rows []domain.Episode
}

func (r *fakeMemoryEntriesReader) List(_ context.Context, filter domain.MemoryEntryFilter) (domain.MemoryEntryPage, error) {
	candidates := make([]domain.Episode, 0, len(r.rows))
	for _, ep := range r.rows {
		if ep.UserID != filter.UserID {
			continue
		}
		if filter.Kind != "" && ep.Kind != filter.Kind {
			continue
		}
		if filter.Since != nil && ep.OccurredAt.Before(*filter.Since) {
			continue
		}
		candidates = append(candidates, ep)
	}
	total := len(candidates)
	from := filter.Offset
	if from > total {
		from = total
	}
	to := from + filter.Limit
	if to > total {
		to = total
	}
	return domain.MemoryEntryPage{Items: candidates[from:to], Total: total}, nil
}

func (r *fakeMemoryEntriesReader) SoftDelete(_ context.Context, userID, episodeID uuid.UUID) error {
	for i, ep := range r.rows {
		if ep.ID == episodeID && ep.UserID == userID {
			// In real adapter SoftDelete stamps deleted_at. Test fake just removes from slice.
			r.rows = append(r.rows[:i], r.rows[i+1:]...)
			return nil
		}
	}
	return domain.ErrNotFound
}

func (r *fakeMemoryEntriesReader) Edit(_ context.Context, userID, episodeID uuid.UUID, content string) (domain.Episode, error) {
	for i := range r.rows {
		if r.rows[i].ID == episodeID && r.rows[i].UserID == userID {
			r.rows[i].Summary = content
			t := time.Now().UTC()
			r.rows[i].EditedAt = &t
			return r.rows[i], nil
		}
	}
	return domain.Episode{}, domain.ErrNotFound
}

func TestListMemoryEntries_HappyPath(t *testing.T) {
	uid := uuid.New()
	now := time.Now().UTC()
	reader := &fakeMemoryEntriesReader{
		rows: []domain.Episode{
			{ID: uuid.New(), UserID: uid, Kind: domain.EpisodeBriefEmitted, Summary: "brief", OccurredAt: now},
			{ID: uuid.New(), UserID: uid, Kind: domain.EpisodeFocusSessionDone, Summary: "focus", OccurredAt: now.Add(-1 * time.Hour)},
			{ID: uuid.New(), UserID: uuid.New(), Kind: domain.EpisodeBriefEmitted, Summary: "other-user", OccurredAt: now},
		},
	}
	uc := &ListMemoryEntries{Reader: reader}
	res, err := uc.Do(context.Background(), ListMemoryEntriesInput{UserID: uid, Limit: 10})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if res.Total != 2 {
		t.Fatalf("expected total=2, got %d", res.Total)
	}
	if len(res.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(res.Items))
	}
}

func TestListMemoryEntries_KindFilter(t *testing.T) {
	uid := uuid.New()
	now := time.Now().UTC()
	reader := &fakeMemoryEntriesReader{
		rows: []domain.Episode{
			{ID: uuid.New(), UserID: uid, Kind: domain.EpisodeBriefEmitted, OccurredAt: now},
			{ID: uuid.New(), UserID: uid, Kind: domain.EpisodeFocusSessionDone, OccurredAt: now},
		},
	}
	uc := &ListMemoryEntries{Reader: reader}
	res, err := uc.Do(context.Background(), ListMemoryEntriesInput{
		UserID: uid, Kind: string(domain.EpisodeBriefEmitted), Limit: 10,
	})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if res.Total != 1 {
		t.Fatalf("expected 1, got %d", res.Total)
	}
	if res.Items[0].Kind != domain.EpisodeBriefEmitted {
		t.Fatalf("wrong kind in result: %s", res.Items[0].Kind)
	}
}

func TestListMemoryEntries_InvalidKindErrors(t *testing.T) {
	uc := &ListMemoryEntries{Reader: &fakeMemoryEntriesReader{}}
	_, err := uc.Do(context.Background(), ListMemoryEntriesInput{
		UserID: uuid.New(), Kind: "imaginary",
	})
	if err == nil || !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestListMemoryEntries_DefaultsAndCap(t *testing.T) {
	uid := uuid.New()
	rows := make([]domain.Episode, 250)
	now := time.Now().UTC()
	for i := range rows {
		rows[i] = domain.Episode{
			ID: uuid.New(), UserID: uid,
			Kind:       domain.EpisodeBriefEmitted,
			OccurredAt: now.Add(-time.Duration(i) * time.Minute),
		}
	}
	reader := &fakeMemoryEntriesReader{rows: rows}
	uc := &ListMemoryEntries{Reader: reader}
	res, err := uc.Do(context.Background(), ListMemoryEntriesInput{UserID: uid, Limit: 0})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(res.Items) != 50 {
		t.Fatalf("default limit 50 expected, got %d", len(res.Items))
	}
	res, err = uc.Do(context.Background(), ListMemoryEntriesInput{UserID: uid, Limit: 500})
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(res.Items) != 200 {
		t.Fatalf("cap 200 expected, got %d", len(res.Items))
	}
}

// ─── DeleteMemoryEntry ────────────────────────────────────────────────────

func TestDeleteMemoryEntry_HappyPath(t *testing.T) {
	uid := uuid.New()
	eid := uuid.New()
	reader := &fakeMemoryEntriesReader{
		rows: []domain.Episode{
			{ID: eid, UserID: uid, Kind: domain.EpisodeBriefEmitted, OccurredAt: time.Now()},
		},
	}
	uc := &DeleteMemoryEntry{Reader: reader}
	if err := uc.Do(context.Background(), uid, eid); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(reader.rows) != 0 {
		t.Fatalf("expected row removed, got %d remaining", len(reader.rows))
	}
}

func TestDeleteMemoryEntry_NotFound(t *testing.T) {
	uc := &DeleteMemoryEntry{Reader: &fakeMemoryEntriesReader{}}
	err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if err == nil || !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestDeleteMemoryEntry_ValidationErrors(t *testing.T) {
	uc := &DeleteMemoryEntry{Reader: &fakeMemoryEntriesReader{}}
	if err := uc.Do(context.Background(), uuid.Nil, uuid.New()); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for zero user, got %v", err)
	}
	if err := uc.Do(context.Background(), uuid.New(), uuid.Nil); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for zero id, got %v", err)
	}
}
