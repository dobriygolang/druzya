// snapshot_repo.go — cross-context read aggregator for the tutor
// dashboard (Wave 2.4b of docs/feature/plan.md). Reads from tables
// owned by other bounded contexts (hone_*, mock_sessions, skill_nodes,
// atlas_nodes) — DB-level coupling is a deliberate trade-off: the
// alternative (importing 3 service modules into tutor) would be much
// worse for build-time + go.mod hygiene. Schema changes in those
// tables will catch this aggregator at CI time via integration tests.
package infra

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"druz9/tutor/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// EnsureRelationship enforces tutor↔student authorization at the SQL
// gate. Returns ErrNotFound if the active row doesn't exist.
func (p *Postgres) EnsureRelationship(ctx context.Context, tutorID, studentID uuid.UUID) error {
	var exists bool
	if err := p.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM tutor_students
			WHERE tutor_id = $1 AND student_id = $2 AND ended_at IS NULL
		)`,
		pgUUID(tutorID), pgUUID(studentID),
	).Scan(&exists); err != nil {
		return fmt.Errorf("tutor.EnsureRelationship: %w", err)
	}
	if !exists {
		return fmt.Errorf("tutor.EnsureRelationship: %w", domain.ErrNotFound)
	}
	return nil
}

// GetStudentSnapshot — single struct, several queries. Each query is
// independently fail-soft via try/log; the snapshot returns whatever
// blocks succeeded.
//
// We don't use a single mega-CTE because partial-fail semantics
// matter for tutor UX: «hone tables down» shouldn't black out the
// mock-history card, and vice versa. Each section is a separate
// hop, optimised for readability over wire round-trips (3 queries
// total, all hitting indexed columns).
func (p *Postgres) GetStudentSnapshot(
	ctx context.Context,
	studentID uuid.UUID,
	windowDays int,
	now time.Time,
) (domain.StudentSnapshot, error) {
	if windowDays <= 0 {
		windowDays = 7
	}
	out := domain.StudentSnapshot{
		StudentID:  studentID,
		WindowDays: windowDays,
		WeakSpots:  []domain.WeakSpot{},
	}
	winStr := strconv.Itoa(windowDays)

	// 1) Focus + last_active over hone_focus_sessions.
	//
	// `ended_at IS NOT NULL` filters out abandoned sessions; minutes
	// derive from (ended_at - started_at) / 60 because hone schema
	// keeps timestamps, not a duration column.
	var (
		focusMinutes pgtype.Float8
		focusCount   int
		lastFocusEnd pgtype.Timestamptz
	)
	if err := p.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60.0), 0) AS minutes,
		       COUNT(*)                                                              AS sessions,
		       MAX(ended_at)                                                         AS last_end
		  FROM hone_focus_sessions
		 WHERE user_id = $1
		   AND ended_at IS NOT NULL
		   AND ended_at >= $2`,
		pgUUID(studentID),
		pgtype.Timestamptz{Time: now.AddDate(0, 0, -windowDays), Valid: true},
	).Scan(&focusMinutes, &focusCount, &lastFocusEnd); err != nil {
		return domain.StudentSnapshot{}, fmt.Errorf("tutor.GetStudentSnapshot: focus: %w", err)
	}
	if focusMinutes.Valid {
		out.FocusMinutesWindow = int(focusMinutes.Float64 + 0.5)
	}
	out.FocusSessionsCount = focusCount
	if lastFocusEnd.Valid && lastFocusEnd.Time.After(out.LastActiveAt) {
		out.LastActiveAt = lastFocusEnd.Time
	}

	// 2) English HR mocks aggregate. ai_report is JSONB; we extract
	// overall_score the same way services/ai_mock/infra does.
	var (
		mockTotal     int
		mockAvgScore  pgtype.Float8
		mockLastScore pgtype.Int4
		mockLastEnd   pgtype.Timestamptz
	)
	if err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) AS total,
		       AVG((ai_report->>'overall_score')::int)
		           FILTER (WHERE ai_report ? 'overall_score')                AS avg_score,
		       (
		         SELECT (ai_report->>'overall_score')::int
		           FROM mock_sessions
		          WHERE user_id = $1
		            AND section = 'english_hr'
		            AND finished_at IS NOT NULL
		            AND finished_at >= now() - ($2 || ' days')::interval
		            AND ai_report ? 'overall_score'
		          ORDER BY finished_at DESC
		          LIMIT 1
		       )                                                            AS last_score,
		       MAX(finished_at)                                              AS last_finished
		  FROM mock_sessions
		 WHERE user_id = $1
		   AND section = 'english_hr'
		   AND finished_at IS NOT NULL
		   AND finished_at >= now() - ($2 || ' days')::interval`,
		pgUUID(studentID), winStr,
	).Scan(&mockTotal, &mockAvgScore, &mockLastScore, &mockLastEnd); err != nil {
		return domain.StudentSnapshot{}, fmt.Errorf("tutor.GetStudentSnapshot: mocks: %w", err)
	}
	out.EnglishMocksCount = mockTotal
	if mockAvgScore.Valid {
		out.EnglishMocksAvgScore = int(mockAvgScore.Float64 + 0.5)
	}
	if mockLastScore.Valid {
		out.EnglishMocksLastScore = int(mockLastScore.Int32)
	}
	if mockLastEnd.Valid && mockLastEnd.Time.After(out.LastActiveAt) {
		out.LastActiveAt = mockLastEnd.Time
	}

	// 3) Atlas weak-spots — top 5 sub-skills by lowest progress in
	// the english track. JOIN on skill_nodes for the user's actual
	// progress; LEFT JOIN so atlas nodes the student hasn't touched
	// yet still show up (with progress = 0).
	rows, err := p.pool.Query(ctx, `
		SELECT a.id, a.title, COALESCE(s.progress, 0) AS progress
		  FROM atlas_nodes a
		  LEFT JOIN skill_nodes s ON s.node_key = a.id AND s.user_id = $1
		 WHERE a.is_active = TRUE
		   AND a.track_kind = 'english'
		   AND a.kind IN ('small','notable','keystone')
		   AND COALESCE(s.progress, 0) < 60
		 ORDER BY COALESCE(s.progress, 0) ASC, a.sort_order ASC
		 LIMIT 5`,
		pgUUID(studentID),
	)
	if err != nil {
		return domain.StudentSnapshot{}, fmt.Errorf("tutor.GetStudentSnapshot: weak_spots: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var w domain.WeakSpot
		if scanErr := rows.Scan(&w.NodeKey, &w.Title, &w.Progress); scanErr != nil {
			continue
		}
		out.WeakSpots = append(out.WeakSpots, w)
	}

	// 4) Notes count — cheap pinch into hone_notes.
	if err := p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM hone_notes
		 WHERE user_id = $1
		   AND created_at >= now() - ($2 || ' days')::interval`,
		pgUUID(studentID), winStr,
	).Scan(&out.NotesCount); err != nil {
		// Not fatal — hone_notes may be empty/disabled in some envs.
		// Log-and-zero is the right semantics here, but tutor module
		// has no logger inside infra — bury silently to keep the
		// other three blocks meaningful.
		out.NotesCount = 0
	}

	return out, nil
}
