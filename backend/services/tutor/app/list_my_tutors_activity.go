// Package app — student-side social-proof tutor activity.
//
// Returns one row per active tutor
// with privacy-aware aggregates (no other-student names, no event titles,
// no per-student breakdowns). Drives the «Тебя сегодня учат: N tutors
// recently active» card on /today + Hone Home rail.
//
// Caching: 5-min in-process TTL per (studentID, windowDays) — keeps the
// hot path off Postgres when many students share popular tutors. Cache
// is best-effort (no Redis dependency for this surface); a node restart
// just warms it back up. Eviction is lazy on read.
package app

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
)

// ListMyTutorsActivity — student lists their active tutors with
// social-proof aggregates. Privacy contract enforced
// at the repo layer (TutorsActivitySummary returns aggregate counts
// only — no other-student names / ids / event details).
type ListMyTutorsActivity struct {
	Repo  domain.Repo      // ListStudentTutors
	Stats domain.EventRepo // TutorsActivitySummary
	Now   func() time.Time

	// In-process TTL cache. 5-minute TTL — short enough that a new
	// tutor invite / event lands within the user's session, long enough
	// to keep the hot path off Postgres. nil-safe: zero value works
	// (cache effectively disabled).
	cache sync.Map // key: cacheKey, value: cacheEntry
}

// MyTutorActivityItem — output row. Public-shaped (callers map directly
// to proto). TutorDisplay fields filled by the ports layer (handler
// reuses the existing user-display bulk resolver).
type MyTutorActivityItem struct {
	TutorID                 uuid.UUID
	LastActiveAt            time.Time // zero == never
	ActiveStudentCountOther int
	RecentEventsCount       int
}

type cacheKey struct {
	studentID  uuid.UUID
	windowDays int
}

type cacheEntry struct {
	items   []MyTutorActivityItem
	expires time.Time
}

const myTutorsActivityCacheTTL = 5 * time.Minute

// Do — list with sane defaults. windowDays clamped to [1, 30]; default 7.
// Returns empty slice when student has zero active tutors (caller hides
// the surface; no awkward empty state).
func (uc *ListMyTutorsActivity) Do(
	ctx context.Context,
	studentID uuid.UUID,
	windowDays int,
) ([]MyTutorActivityItem, error) {
	if studentID == uuid.Nil {
		return nil, fmt.Errorf("tutor.ListMyTutorsActivity: %w", domain.ErrInvalidInput)
	}
	if windowDays <= 0 {
		windowDays = 7
	}
	if windowDays > 30 {
		windowDays = 30
	}

	now := nowOr(uc.Now)
	key := cacheKey{studentID: studentID, windowDays: windowDays}

	// Cache read — lazy eviction.
	if cached, ok := uc.cache.Load(key); ok {
		if entry, ok := cached.(cacheEntry); ok {
			if now.Before(entry.expires) {
				return entry.items, nil
			}
			uc.cache.Delete(key)
		}
	}

	// 1) Active tutor relationships.
	rels, err := uc.Repo.ListStudentTutors(ctx, studentID)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListMyTutorsActivity: %w", err)
	}
	if len(rels) == 0 {
		// No tutors → empty result. Don't bother hitting the activity
		// aggregator. Cache the empty slice so repeat calls стая cheap.
		uc.cache.Store(key, cacheEntry{
			items:   nil,
			expires: now.Add(myTutorsActivityCacheTTL),
		})
		return nil, nil
	}

	// 2) Activity summary in one round-trip.
	tutorIDs := make([]uuid.UUID, 0, len(rels))
	for _, r := range rels {
		tutorIDs = append(tutorIDs, r.TutorID)
	}
	summary, err := uc.Stats.TutorsActivitySummary(ctx, studentID, tutorIDs, windowDays, now)
	if err != nil {
		return nil, fmt.Errorf("tutor.ListMyTutorsActivity: %w", err)
	}

	out := make([]MyTutorActivityItem, 0, len(rels))
	for _, r := range rels {
		s, ok := summary[r.TutorID]
		if !ok {
			// Tutor with zero events / zero co-students — surface row with
			// zero counts rather than dropping (UI still wants to display
			// the relationship with a «recently inactive» badge).
			out = append(out, MyTutorActivityItem{TutorID: r.TutorID})
			continue
		}
		out = append(out, MyTutorActivityItem{
			TutorID:                 r.TutorID,
			LastActiveAt:            s.LastActiveAt,
			ActiveStudentCountOther: s.ActiveStudentCountOther,
			RecentEventsCount:       s.RecentEventsCount,
		})
	}

	// 3) Sort: most-recently-active first; ties by tutor_id (stable).
	slices.SortStableFunc(out, func(a, b MyTutorActivityItem) int {
		if a.LastActiveAt.Equal(b.LastActiveAt) {
			return cmp.Compare(a.TutorID.String(), b.TutorID.String())
		}
		return cmp.Compare(b.LastActiveAt.UnixNano(), a.LastActiveAt.UnixNano())
	})

	uc.cache.Store(key, cacheEntry{
		items:   out,
		expires: now.Add(myTutorsActivityCacheTTL),
	})
	return out, nil
}
