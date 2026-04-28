package domain

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// ErrNotFound — каноническая ошибка для read'ов.
var ErrNotFound = errors.New("quiz: not found")

// ErrSessionExpired — session-token истёк или сессия закрыта.
var ErrSessionExpired = errors.New("quiz: session expired")

// QuestionPool — read-only выборка вопросов из одного из трёх источников.
// Реализация (infra/postgres.go) отдельная per-source, но интерфейс один,
// чтобы StartSession.Do мог попросить N вопросов независимо от того откуда.
type QuestionPool interface {
	// Random возвращает до `count` рандомизированных вопросов с
	// учётом topic-фильтра (если непустой). topic semantics для каждого
	// pool'а:
	//   codex: matches codex_categories.slug
	//   mock:  matches mock_tasks.section
	//   mixed: pool сам разделяет N между источниками
	Random(ctx context.Context, source QuestionSource, topic string, count int) ([]Question, error)
}

// SessionStore хранит активные quiz-сессии. Реализация — Redis с TTL.
type SessionStore interface {
	Save(ctx context.Context, s Session) error
	Get(ctx context.Context, id uuid.UUID) (Session, error)
	Delete(ctx context.Context, id uuid.UUID) error
}

// Grader — семантическая проверка ответа. LLM-impl в infra/llm_grader.go;
// для тестов есть exact-string-match grader как floor.
type Grader interface {
	Grade(ctx context.Context, question Question, given string) (AnswerJudgement, error)
}

// Bus — узкая абстракция шины над shared/domain.Bus.Publish, чтобы quiz
// домен не тащил всю shared/domain.Bus в свои интерфейсы.
type Bus interface {
	PublishSessionCompleted(ctx context.Context, r Result) error
}
