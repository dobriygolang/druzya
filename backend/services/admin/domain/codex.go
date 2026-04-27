package domain

import (
	"context"

	"github.com/google/uuid"
)

// CodexArticle mirrors a codex_articles row.
type CodexArticle struct {
	ID          string
	Slug        string
	Title       string
	Description string
	Category    string
	Href        string
	Source      string
	ReadMin     int
	SortOrder   int
	Active      bool
}

// CodexArticleUpsert is the curator-supplied payload.
type CodexArticleUpsert struct {
	Slug        string
	Title       string
	Description string
	Category    string
	Href        string
	Source      string
	ReadMin     int
	SortOrder   int
	Active      *bool
}

// CodexCategory mirrors a codex_categories row.
type CodexCategory struct {
	Slug        string
	Label       string
	Description string
	SortOrder   int
	Active      bool
}

// CodexArticleMeta — minimal article projection used by the open-tap
// endpoint to write a coach-memory episode.
type CodexArticleMeta struct {
	Slug     string
	Title    string
	Category string
}

// CodexRepo persists codex_articles + codex_categories.
type CodexRepo interface {
	ListArticles(ctx context.Context, activeOnly bool) ([]CodexArticle, error)
	CreateArticle(ctx context.Context, in CodexArticleUpsert) (CodexArticle, error)
	UpdateArticle(ctx context.Context, id uuid.UUID, in CodexArticleUpsert) (CodexArticle, error)
	SetArticleActive(ctx context.Context, id uuid.UUID, active bool) error
	DeleteArticle(ctx context.Context, id uuid.UUID) error
	GetArticleMetaIfActive(ctx context.Context, id uuid.UUID) (CodexArticleMeta, error)

	ListCategories(ctx context.Context, activeOnly bool) ([]CodexCategory, error)
	CreateCategory(ctx context.Context, in CodexCategory) error
	UpdateCategory(ctx context.Context, slug string, in CodexCategory) error
	DeleteCategory(ctx context.Context, slug string) error
	CountArticlesByCategory(ctx context.Context, slug string) (int, error)
}
