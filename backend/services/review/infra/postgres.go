// Package infra holds the Postgres adapter for the review domain.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/review/domain"
	reviewdb "druz9/review/infra/db"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultListLimit caps the public per-subject feed.
const defaultListLimit = 50

// Postgres implements domain.ReviewRepo on a *pgxpool.Pool via the sqlc
// queries in services/review/infra/db.
type Postgres struct {
	pool *pgxpool.Pool
	q    *reviewdb.Queries
}

// NewPostgres wires a Postgres repo.
func NewPostgres(pool *pgxpool.Pool) *Postgres {
	return &Postgres{pool: pool, q: reviewdb.New(pool)}
}

// Create inserts a review. Duplicate (booking_id, direction) → ErrAlreadyReviewed.
func (p *Postgres) Create(ctx context.Context, r domain.Review) (domain.Review, error) {
	row, err := p.q.CreateReview(ctx, reviewdb.CreateReviewParams{
		BookingID:     pgUUID(r.BookingID),
		Direction:     string(r.Direction),
		ReviewerID:    pgUUID(r.ReviewerID),
		InterviewerID: pgUUID(r.InterviewerID),
		SubjectID:     pgUUID(r.SubjectID),
		Rating:        int32(r.Rating),
		Feedback:      pgText(r.Feedback),
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.Review{}, domain.ErrAlreadyReviewed
		}
		return domain.Review{}, fmt.Errorf("review.pg.Create: %w", err)
	}
	return domain.Review{
		BookingID:     fromPgUUID(row.BookingID),
		Direction:     domain.Direction(row.Direction),
		ReviewerID:    fromPgUUID(row.ReviewerID),
		InterviewerID: fromPgUUID(row.InterviewerID),
		SubjectID:     fromPgUUID(row.SubjectID),
		Rating:        int(row.Rating),
		Feedback:      row.Feedback.String,
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}

// GetByBookingDirection — ErrNotFound when the side hasn't reviewed yet.
func (p *Postgres) GetByBookingDirection(ctx context.Context, bookingID uuid.UUID, dir domain.Direction) (domain.Review, error) {
	row, err := p.q.GetReviewByBookingDirection(ctx, reviewdb.GetReviewByBookingDirectionParams{
		BookingID: pgUUID(bookingID),
		Direction: string(dir),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Review{}, domain.ErrNotFound
		}
		return domain.Review{}, fmt.Errorf("review.pg.GetByBookingDirection: %w", err)
	}
	return domain.Review{
		BookingID:     fromPgUUID(row.BookingID),
		Direction:     domain.Direction(row.Direction),
		ReviewerID:    fromPgUUID(row.ReviewerID),
		InterviewerID: fromPgUUID(row.InterviewerID),
		SubjectID:     fromPgUUID(row.SubjectID),
		Rating:        int(row.Rating),
		Feedback:      row.Feedback.String,
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}

// ListBySubject returns the latest `limit` reviews about a user.
func (p *Postgres) ListBySubject(ctx context.Context, subjectID uuid.UUID, limit int) ([]domain.Review, error) {
	if limit <= 0 {
		limit = defaultListLimit
	}
	rows, err := p.q.ListReviewsBySubject(ctx, reviewdb.ListReviewsBySubjectParams{
		SubjectID: pgUUID(subjectID),
		Limit:     int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("review.pg.ListBySubject: %w", err)
	}
	out := make([]domain.Review, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.Review{
			BookingID:     fromPgUUID(r.BookingID),
			Direction:     domain.Direction(r.Direction),
			ReviewerID:    fromPgUUID(r.ReviewerID),
			InterviewerID: fromPgUUID(r.InterviewerID),
			SubjectID:     fromPgUUID(r.SubjectID),
			Rating:        int(r.Rating),
			Feedback:      r.Feedback.String,
			CreatedAt:     r.CreatedAt.Time,
			UpdatedAt:     r.UpdatedAt.Time,
		})
	}
	return out, nil
}

// SubjectStats returns avg rating + count across both review directions.
func (p *Postgres) SubjectStats(ctx context.Context, subjectID uuid.UUID) (domain.Stats, error) {
	row, err := p.q.GetSubjectStats(ctx, pgUUID(subjectID))
	if err != nil {
		return domain.Stats{}, fmt.Errorf("review.pg.SubjectStats: %w", err)
	}
	return domain.Stats{
		SubjectID:    subjectID,
		AvgRating:    float32(row.AvgRating),
		ReviewsCount: int(row.ReviewsCount),
	}, nil
}

// HasReview — existence check for one side of a booking.
func (p *Postgres) HasReview(ctx context.Context, bookingID uuid.UUID, dir domain.Direction) (bool, error) {
	_, err := p.q.GetReviewByBookingDirection(ctx, reviewdb.GetReviewByBookingDirectionParams{
		BookingID: pgUUID(bookingID),
		Direction: string(dir),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("review.pg.HasReview: %w", err)
	}
	return true, nil
}

// ── helpers ───────────────────────────────────────────────────────────────

func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: id != uuid.Nil}
}

func fromPgUUID(p pgtype.UUID) uuid.UUID {
	if !p.Valid {
		return uuid.Nil
	}
	return uuid.UUID(p.Bytes)
}

func pgText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}
