package app

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"druz9/intelligence/domain"
	mocks "druz9/intelligence/domain/mocks"

	"github.com/google/uuid"
	"go.uber.org/mock/gomock"
)

// memoryEntriesStore — in-memory state-машина для MemoryEntryReader.
type memoryEntriesStore struct {
	mu   sync.Mutex
	rows []domain.Episode
}

func wireMockMemoryEntryReader(ctrl *gomock.Controller, s *memoryEntriesStore) *mocks.MockMemoryEntryReader {
	m := mocks.NewMockMemoryEntryReader(ctrl)
	m.EXPECT().List(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, filter domain.MemoryEntryFilter) (domain.MemoryEntryPage, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			candidates := make([]domain.Episode, 0, len(s.rows))
			for _, ep := range s.rows {
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
		},
	).AnyTimes()
	m.EXPECT().SoftDelete(gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID, episodeID uuid.UUID) error {
			s.mu.Lock()
			defer s.mu.Unlock()
			for i, ep := range s.rows {
				if ep.ID == episodeID && ep.UserID == userID {
					s.rows = append(s.rows[:i], s.rows[i+1:]...)
					return nil
				}
			}
			return domain.ErrNotFound
		},
	).AnyTimes()
	m.EXPECT().Edit(gomock.Any(), gomock.Any(), gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, userID, episodeID uuid.UUID, content string) (domain.Episode, error) {
			s.mu.Lock()
			defer s.mu.Unlock()
			for i := range s.rows {
				if s.rows[i].ID == episodeID && s.rows[i].UserID == userID {
					s.rows[i].Summary = content
					t := time.Now().UTC()
					s.rows[i].EditedAt = &t
					return s.rows[i], nil
				}
			}
			return domain.Episode{}, domain.ErrNotFound
		},
	).AnyTimes()
	return m
}

func TestListMemoryEntries_HappyPath(t *testing.T) {
	uid := uuid.New()
	now := time.Now().UTC()
	ctrl := gomock.NewController(t)
	store := &memoryEntriesStore{
		rows: []domain.Episode{
			{ID: uuid.New(), UserID: uid, Kind: domain.EpisodeBriefEmitted, Summary: "brief", OccurredAt: now},
			{ID: uuid.New(), UserID: uid, Kind: domain.EpisodeFocusSessionDone, Summary: "focus", OccurredAt: now.Add(-1 * time.Hour)},
			{ID: uuid.New(), UserID: uuid.New(), Kind: domain.EpisodeBriefEmitted, Summary: "other-user", OccurredAt: now},
		},
	}
	uc := &ListMemoryEntries{Reader: wireMockMemoryEntryReader(ctrl, store)}
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
	ctrl := gomock.NewController(t)
	store := &memoryEntriesStore{
		rows: []domain.Episode{
			{ID: uuid.New(), UserID: uid, Kind: domain.EpisodeBriefEmitted, OccurredAt: now},
			{ID: uuid.New(), UserID: uid, Kind: domain.EpisodeFocusSessionDone, OccurredAt: now},
		},
	}
	uc := &ListMemoryEntries{Reader: wireMockMemoryEntryReader(ctrl, store)}
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
	ctrl := gomock.NewController(t)
	uc := &ListMemoryEntries{Reader: wireMockMemoryEntryReader(ctrl, &memoryEntriesStore{})}
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
	ctrl := gomock.NewController(t)
	store := &memoryEntriesStore{rows: rows}
	uc := &ListMemoryEntries{Reader: wireMockMemoryEntryReader(ctrl, store)}
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
	ctrl := gomock.NewController(t)
	store := &memoryEntriesStore{
		rows: []domain.Episode{
			{ID: eid, UserID: uid, Kind: domain.EpisodeBriefEmitted, OccurredAt: time.Now()},
		},
	}
	uc := &DeleteMemoryEntry{Reader: wireMockMemoryEntryReader(ctrl, store)}
	if err := uc.Do(context.Background(), uid, eid); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.rows) != 0 {
		t.Fatalf("expected row removed, got %d remaining", len(store.rows))
	}
}

func TestDeleteMemoryEntry_NotFound(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &DeleteMemoryEntry{Reader: wireMockMemoryEntryReader(ctrl, &memoryEntriesStore{})}
	err := uc.Do(context.Background(), uuid.New(), uuid.New())
	if err == nil || !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestDeleteMemoryEntry_ValidationErrors(t *testing.T) {
	ctrl := gomock.NewController(t)
	uc := &DeleteMemoryEntry{Reader: wireMockMemoryEntryReader(ctrl, &memoryEntriesStore{})}
	if err := uc.Do(context.Background(), uuid.Nil, uuid.New()); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for zero user, got %v", err)
	}
	if err := uc.Do(context.Background(), uuid.New(), uuid.Nil); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for zero id, got %v", err)
	}
}
