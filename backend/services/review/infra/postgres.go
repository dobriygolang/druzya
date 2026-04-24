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

// defaultListLimit caps the public per-interviewer feed.
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

// Create inserts a review. A duplicate booking_id (PK) maps to ErrAlreadyReviewed.
func (p *Postgres) Create(ctx context.Context, r domain.Review) (domain.Review, error) {
	row, err := p.q.CreateReview(ctx, reviewdb.CreateReviewParams{
		BookingID:     pgUUID(r.BookingID),
		ReviewerID:    pgUUID(r.ReviewerID),
		InterviewerID: pgUUID(r.InterviewerID),
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
		ReviewerID:    fromPgUUID(row.ReviewerID),
		InterviewerID: fromPgUUID(row.InterviewerID),
		Rating:        int(row.Rating),
		Feedback:      row.Feedback.String,
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}

// GetByBooking — ErrNotFound when the candidate hasn't reviewed yet.
func (p *Postgres) GetByBooking(ctx context.Context, bookingID uuid.UUID) (domain.Review, error) {
	row, err := p.q.GetReviewByBooking(ctx, pgUUID(bookingID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Review{}, domain.ErrNotFound
		}
		return domain.Review{}, fmt.Errorf("review.pg.GetByBooking: %w", err)
	}
	return domain.Review{
		BookingID:     fromPgUUID(row.BookingID),
		ReviewerID:    fromPgUUID(row.ReviewerID),
		InterviewerID: fromPgUUID(row.InterviewerID),
		Rating:        int(row.Rating),
		Feedback:      row.Feedback.String,
		CreatedAt:     row.CreatedAt.Time,
		UpdatedAt:     row.UpdatedAt.Time,
	}, nil
}

// ListByInterviewer returns the latest `limit` reviews. limit ≤ 0 falls back
// to defaultListLimit.
func (p *Postgres) ListByInterviewer(ctx context.Context, interviewerID uuid.UUID, limit int) ([]domain.Review, error) {
	if limit <= 0 {
		limit = defaultListLimit
	}
	rows, err := p.q.ListReviewsByInterviewer(ctx, reviewdb.ListReviewsByInterviewerParams{
		InterviewerID: pgUUID(interviewerID),
		Limit:         int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("review.pg.ListByInterviewer: %w", err)
	}
	out := make([]domain.Review, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.Review{
			BookingID:     fromPgUUID(r.BookingID),
			ReviewerID:    fromPgUUID(r.ReviewerID),
			InterviewerID: fromPgUUID(r.InterviewerID),
			Rating:        int(r.Rating),
			Feedback:      r.Feedback.String,
			CreatedAt:     r.CreatedAt.Time,
			UpdatedAt:     r.UpdatedAt.Time,
		})
	}
	return out, nil
}

// InterviewerStats returns avg rating + count.
func (p *Postgres) InterviewerStats(ctx context.Context, interviewerID uuid.UUID) (domain.Stats, error) {
	row, err := p.q.GetInterviewerStats(ctx, pgUUID(interviewerID))
	if err != nil {
		return domain.Stats{}, fmt.Errorf("review.pg.InterviewerStats: %w", err)
	}
	return domain.Stats{
		InterviewerID: interviewerID,
		AvgRating:     float32(row.AvgRating),
		ReviewsCount:  int(row.ReviewsCount),
	}, nil
}

// HasReview — single-row existence check used by slot.ListMyBookings to set
// the has_review flag without doing a separate join in slot's SQL.
func (p *Postgres) HasReview(ctx context.Context, bookingID uuid.UUID) (bool, error) {
	_, err := p.q.GetReviewByBooking(ctx, pgUUID(bookingID))
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
