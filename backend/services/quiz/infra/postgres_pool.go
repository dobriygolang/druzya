// Package infra — Postgres + Redis adapters for the quiz domain.
package infra

import (
	"context"
	"errors"
	"fmt"

	"druz9/quiz/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresPool implements domain.QuestionPool over codex_articles +
// mock_pipeline question banks. Random selection uses ORDER BY random()
// which is fine for the small (<= a few thousand rows) catalogue.
type PostgresPool struct {
	pool *pgxpool.Pool
}

// NewPostgresPool wires the pool.
func NewPostgresPool(pool *pgxpool.Pool) *PostgresPool {
	return &PostgresPool{pool: pool}
}

// Random returns up to `count` questions from the requested source.
func (p *PostgresPool) Random(ctx context.Context, source domain.QuestionSource, topic string, count int) ([]domain.Question, error) {
	switch source {
	case domain.SourceCodex:
		return p.fromCodex(ctx, topic, count)
	case domain.SourceMock:
		return p.fromMock(ctx, topic, count)
	case domain.SourceMixed:
		// Half-and-half so neither pool dominates a session.
		half := count / 2
		if half == 0 {
			half = 1
		}
		left, err := p.fromCodex(ctx, topic, half)
		if err != nil {
			return nil, err
		}
		right, err := p.fromMock(ctx, topic, count-half)
		if err != nil {
			return nil, err
		}
		return append(left, right...), nil
	}
	return nil, fmt.Errorf("quiz.PostgresPool.Random: invalid source %q", source)
}

// fromCodex pulls quiz_question/quiz_answer rows from codex_articles.
// Articles without quiz_question are silently filtered out by the WHERE.
func (p *PostgresPool) fromCodex(ctx context.Context, topic string, count int) ([]domain.Question, error) {
	args := []any{count}
	where := "active = TRUE AND quiz_question IS NOT NULL AND quiz_question <> ''"
	if topic != "" {
		where += " AND category = $2"
		args = append(args, topic)
	}
	rows, err := p.pool.Query(ctx, `
        SELECT slug, COALESCE(category, ''),
               COALESCE(quiz_question, ''),
               COALESCE(quiz_answer, ''),
               '/codex/' || slug
          FROM codex_articles
         WHERE `+where+`
         ORDER BY random()
         LIMIT $1`, args...)
	if err != nil {
		return nil, fmt.Errorf("quiz.PostgresPool.fromCodex: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Question, 0, count)
	for rows.Next() {
		var q domain.Question
		q.Source = domain.SourceCodex
		if err := rows.Scan(&q.ID, &q.Topic, &q.QuestionMD, &q.ExpectedAnswer, &q.ReadingLink); err != nil {
			return nil, fmt.Errorf("quiz.PostgresPool.fromCodex: scan: %w", err)
		}
		out = append(out, q)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("quiz.PostgresPool.fromCodex: %w", err)
	}
	return out, nil
}

// fromMock pulls task_questions joined with mock_tasks for the section
// filter. The mock_pipeline schema stores generic prep questions on
// task_questions; we surface them as quiz items with
// expected_answer = answer_hint (the hint *is* the canonical answer in
// pipeline phase 1).
func (p *PostgresPool) fromMock(ctx context.Context, topic string, count int) ([]domain.Question, error) {
	args := []any{count}
	where := "1=1"
	if topic != "" {
		where = "mt.section = $2"
		args = append(args, topic)
	}
	rows, err := p.pool.Query(ctx, `
        SELECT tq.id::text, COALESCE(mt.section, ''),
               tq.question_md, COALESCE(tq.answer_hint, '')
          FROM task_questions tq
          JOIN mock_tasks mt ON mt.id = tq.mock_task_id
         WHERE `+where+`
         ORDER BY random()
         LIMIT $1`, args...)
	if err != nil {
		// task_questions may be empty in fresh installs — surface ErrNotFound
		// so StartSession returns a clean "no quiz pool yet" 404.
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("quiz.PostgresPool.fromMock: %w", domain.ErrNotFound)
		}
		return nil, fmt.Errorf("quiz.PostgresPool.fromMock: %w", err)
	}
	defer rows.Close()
	out := make([]domain.Question, 0, count)
	for rows.Next() {
		var q domain.Question
		q.Source = domain.SourceMock
		if err := rows.Scan(&q.ID, &q.Topic, &q.QuestionMD, &q.ExpectedAnswer); err != nil {
			return nil, fmt.Errorf("quiz.PostgresPool.fromMock: scan: %w", err)
		}
		out = append(out, q)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("quiz.PostgresPool.fromMock: %w", err)
	}
	return out, nil
}

// Compile-time guard.
var _ domain.QuestionPool = (*PostgresPool)(nil)
